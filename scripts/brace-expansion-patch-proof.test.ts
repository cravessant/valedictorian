import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXPANSION_MAX_LENGTH,
  LOCALLY_PATCHED_VERSIONS,
  OFFICIAL_FIXED_RANGE,
  PATCH_MARKER,
  PERMITTED_AUDIT_CONFIG_KEYS,
  PERMITTED_GHSAS,
  PROBE_SCENARIOS,
  checkAdvisoryIgnores,
  checkPatchedDependencies,
  checkProbeIsBounded,
  checkUntrackedPatchMappings,
  compareVersions,
  discoverBraceExpansionCopies,
  findConsumerReachableCopies,
  findVulnerableConsumerLinks,
  isOfficiallyFixedVersion,
  isVulnerableVersion,
  proveBraceExpansionPatches,
  reverseApplyUnifiedDiff,
  runExpansionProbe,
} from './brace-expansion-patch-proof.mjs'

const storeRoot = path.resolve('node_modules', '.pnpm')
const patchesDir = path.resolve('patches')
const trackedConfig = `patchedDependencies:\n${LOCALLY_PATCHED_VERSIONS.map(
  (version) => `  brace-expansion@${version}: patches/brace-expansion@${version}.patch\n`,
).join('')}`

function patchedCopies() {
  return discoverBraceExpansionCopies(storeRoot).filter((copy) => copy.patchHash)
}

/** The consumer-reachable copies upstream itself fixed, so we carry no patch. */
function officialFixedCopies() {
  return findConsumerReachableCopies(storeRoot).filter((copy) =>
    isOfficiallyFixedVersion(copy.version),
  )
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A throwaway store holding a real copy of the installed patched package, so a
 * mutation can be proved to change the gate's verdict while the tracked patch,
 * mapping and marker all stay exactly as committed.
 */
function clonePatchedStore(mutate: (source: string) => string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brace-expansion-clone-'))
  tempRoots.push(root)
  const store = path.join(root, 'node_modules', '.pnpm')
  const [copy] = patchedCopies()
  const entry = path.basename(path.dirname(path.dirname(copy.packageDir)))

  const modules = path.join(store, entry, 'node_modules')
  fs.cpSync(path.dirname(copy.packageDir), modules, { recursive: true, dereference: true })
  const indexPath = path.join(modules, 'brace-expansion', 'index.js')
  fs.writeFileSync(indexPath, mutate(fs.readFileSync(indexPath, 'utf8')))

  // Nothing is proved about a copy no consumer resolves, so link one.
  const consumer = path.join(store, 'minimatch@3.1.5', 'node_modules')
  fs.mkdirSync(consumer, { recursive: true })
  fs.symlinkSync(path.join(modules, 'brace-expansion'), path.join(consumer, 'brace-expansion'), 'dir')
  return { store, version: copy.version }
}

function fixtureStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brace-expansion-store-'))
  tempRoots.push(root)
  const store = path.join(root, 'node_modules', '.pnpm')

  const addCopy = (entry: string, version: string, source: string) => {
    const dir = path.join(store, entry, 'node_modules', 'brace-expansion')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
    fs.writeFileSync(path.join(dir, 'index.js'), source)
    return dir
  }
  const addConsumer = (name: string, target: string) => {
    const consumerModules = path.join(store, name, 'node_modules')
    fs.mkdirSync(consumerModules, { recursive: true })
    fs.symlinkSync(target, path.join(consumerModules, 'brace-expansion'), 'dir')
  }

  return { store, addCopy, addConsumer }
}

function ignoreConfig(...ghsas: string[]) {
  return `auditConfig:\n  ignoreGhsas:\n${ghsas.map((g) => `    - ${g}\n`).join('')}`
}

describe('brace-expansion CVE-2026-14257 backport', () => {
  it('keeps every installed vulnerable-version copy patched and consumer-reachable', () => {
    expect(proveBraceExpansionPatches()).toEqual([])
  }, 15_000)

  it('tracks a pnpm patch only for the line with no fixed upstream release', () => {
    const workspaceConfig = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    const tracked = [...workspaceConfig.matchAll(/^ {2}(\S+): (patches\/\S+)$/gm)].map((m) => m[1])

    expect(tracked).toEqual(LOCALLY_PATCHED_VERSIONS.map((version) => `brace-expansion@${version}`))
    expect(tracked).toEqual(['brace-expansion@1.1.16'])
    for (const version of LOCALLY_PATCHED_VERSIONS) {
      const patch = fs.readFileSync(path.resolve(`patches/brace-expansion@${version}.patch`), 'utf8')
      expect(patch).toContain('a1bd339')
      expect(patch).toContain(PATCH_MARKER)
    }
    // The retired 2.x backport must leave nothing behind.
    expect(fs.readdirSync(path.resolve('patches'))).toEqual(['brace-expansion@1.1.16.patch'])
  })

  it('resolves the 2.x line to an official fixed release carrying no local patch', () => {
    const official = officialFixedCopies()

    expect(official.length).toBeGreaterThan(0)
    for (const copy of official) {
      expect(isVulnerableVersion(copy.version), copy.version).toBe(true)
      expect(copy.packageDir).not.toContain('patch_hash=')
      expect(fs.readFileSync(path.join(copy.packageDir, 'index.js'), 'utf8')).toContain(PATCH_MARKER)
    }
  })

  it('runs the proof before the advisory scan in the stable quality command', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const auditHigh = packageJson.scripts?.['audit:high'] ?? ''

    expect(packageJson.scripts?.['proof:brace-expansion-patch']).toBe(
      'node scripts/brace-expansion-patch-proof.mjs',
    )
    expect(auditHigh).toBe('pnpm run proof:brace-expansion-patch && pnpm audit --audit-level high')
    expect(auditHigh.indexOf('proof:brace-expansion-patch')).toBeLessThan(auditHigh.indexOf('audit'))
  })

  it('reconstructs the published pre-patch source from each tracked patch', () => {
    for (const copy of patchedCopies()) {
      const patched = fs.readFileSync(path.join(copy.packageDir, 'index.js'), 'utf8')
      const patch = fs.readFileSync(
        path.resolve(`patches/brace-expansion@${copy.version}.patch`),
        'utf8',
      )

      expect(patched).toContain(PATCH_MARKER)
      expect(reverseApplyUnifiedDiff(patched, patch)).not.toContain(PATCH_MARKER)
    }
  })

  // Both installed lines stay load-bearing here: the 1.x copy because a local
  // patch is the only thing bounding it, the 2.x copy because an official fixed
  // release is still a release this repository has to keep proving.
  it('bounds the chained-group expansion that used to exhaust the heap', () => {
    const advisoryCopies = findConsumerReachableCopies(storeRoot).filter((copy) =>
      isVulnerableVersion(copy.version),
    )

    expect(advisoryCopies.map((copy) => copy.version).sort()).toEqual(['1.1.16', '2.1.3'])
    for (const copy of advisoryCopies) {
      const outcome = runExpansionProbe({
        modulePath: path.join(copy.packageDir, 'index.js'),
        groups: PROBE_SCENARIOS.length,
      })

      expect(checkProbeIsBounded(outcome, copy.version)).toEqual([])
      expect(outcome.result?.total).toBeLessThanOrEqual(EXPANSION_MAX_LENGTH)
    }
  }, 15_000)

  it('survives the deep chaining that used to overflow the native stack', () => {
    for (const copy of findConsumerReachableCopies(storeRoot)) {
      if (!isVulnerableVersion(copy.version)) continue
      const outcome = runExpansionProbe({
        modulePath: path.join(copy.packageDir, 'index.js'),
        groups: PROBE_SCENARIOS.deep,
      })

      expect(checkProbeIsBounded(outcome, copy.version)).toEqual([])
    }
  }, 15_000)

  it('leaves ordinary expansion untouched on both lines', () => {
    const corpus = JSON.parse(
      fs.readFileSync(path.resolve('scripts/brace-expansion-corpus.json'), 'utf8'),
    ) as { patterns: string[]; bash: (string[] | null)[]; expected: Record<string, string[][]> }
    const require = createRequire(import.meta.url)

    expect(corpus.patterns.length).toBeGreaterThan(150)
    // The patched line is compared against its own recorded pre-patch output,
    // which is what proves the backport changed nothing but the bound.
    for (const copy of patchedCopies()) {
      const expand = require(path.join(copy.packageDir, 'index.js')) as (p: string) => string[]
      expect(typeof expand).toBe('function')

      corpus.patterns.forEach((pattern, index) => {
        expect(expand(pattern), pattern).toEqual(corpus.expected[copy.version][index])
      })
    }

    // The official line has no recorded pre-patch output of its own — comparing
    // it against itself would prove nothing — so bash is the oracle.
    for (const copy of officialFixedCopies()) {
      const expand = require(path.join(copy.packageDir, 'index.js')) as (p: string) => string[]
      expect(typeof expand).toBe('function')

      corpus.patterns.forEach((pattern, index) => {
        const bash = corpus.bash[index]
        if (bash) expect(expand(pattern), `${copy.version} ${pattern} vs bash`).toEqual(bash)
      })
    }
    expect(corpus.bash.filter(Boolean).length).toBeGreaterThan(140)
    expect(Object.keys(corpus.expected)).toEqual([...LOCALLY_PATCHED_VERSIONS])
  })

  it('reports a crashed or unbounded probe as a failure', () => {
    expect(checkProbeIsBounded({ ok: false, status: null, signal: 'SIGABRT' }, 'x')).toEqual([
      'x: crashed (status=null, signal=SIGABRT)',
    ])
    expect(
      checkProbeIsBounded(
        { ok: true, status: 0, signal: null, result: { count: 1, total: 8_000_000, sane: true } },
        'x',
      ),
    ).toEqual([`x: total expansion length 8000000 exceeds ${EXPANSION_MAX_LENGTH}`])
  })

  it('ignores a store entry linking only to its own package', () => {
    const workspaceConfig = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')

    expect(findVulnerableConsumerLinks(storeRoot, { patchesDir, workspaceConfig })).toEqual([])
  })
})

describe('brace-expansion advisory coverage', () => {
  it('treats the whole published advisory range as vulnerable', () => {
    for (const version of ['1.1.15', '1.1.16', '2.1.2', '3.0.4', '4.0.1', '5.0.7', '5.0.8-rc.1']) {
      expect(isVulnerableVersion(version), version).toBe(true)
    }
    for (const version of ['5.0.8', '5.1.0', '6.0.0']) {
      expect(isVulnerableVersion(version), version).toBe(false)
    }
    // Every stable release at or above the first fixed one stays safe.
    for (const version of ['5.0.9', '10.0.0']) {
      expect(isVulnerableVersion(version), version).toBe(false)
    }
    // Prereleases of the first fixed release predate its fix.
    for (const version of ['5.0.8-0', '5.0.8-rc.1']) {
      expect(isVulnerableVersion(version), version).toBe(true)
    }
  })

  // Malformed strings that look newer than the fix must not read as safe: a
  // hand-rolled comparison accepted '5.0.8foo', '05.0.9' and '5.0.9-..'.
  it('fails closed for every version string that is not canonical SemVer', () => {
    for (const version of [
      'not-a-version',
      '5.0.8foo',
      '5.0.8.1',
      '5.0',
      ' 5.0.8 ',
      '',
      '5.0.9-',
      '5.0.9-..',
      '5.0.9-💥',
      '5.0.9-rc..1',
      '05.0.9',
      '5.0.8+build',
      'v5.0.9',
    ]) {
      expect(isVulnerableVersion(version), JSON.stringify(version)).toBe(true)
    }
    for (const version of ['not-a-version', '5.0.8foo', '5.0.9-..', '05.0.9', '5.0']) {
      expect(compareVersions(version, '5.0.8'), JSON.stringify(version)).toBeNaN()
    }
    expect(compareVersions('5.0.7', '5.0.8')).toBeLessThan(0)
    expect(compareVersions('5.0.9', '5.0.8')).toBeGreaterThan(0)
    expect(compareVersions('5.0.8', '5.0.8')).toBe(0)
  })

  it('rejects a consumer resolving an unpatched copy whose version is malformed', () => {
    const { store, addCopy, addConsumer } = fixtureStore()
    addConsumer('g@1.0.0', addCopy('brace-expansion@05.0.9', '05.0.9', 'module.exports = []'))

    expect(
      findVulnerableConsumerLinks(store, { patchesDir, workspaceConfig: trackedConfig }),
    ).toHaveLength(1)
  })

  it('rejects a consumer resolving an unpatched 3.x copy the tracked patches do not cover', () => {
    const { store, addCopy, addConsumer } = fixtureStore()
    addConsumer('minimatch@8.0.0', addCopy('brace-expansion@3.0.0', '3.0.0', 'module.exports = []'))

    const rejected = findVulnerableConsumerLinks(store, {
      patchesDir,
      workspaceConfig: trackedConfig,
    })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].consumer).toBe('minimatch@8.0.0')
    expect(rejected[0].reason).toContain('brace-expansion@3.0.0')
    expect(rejected[0].reason).toContain(PERMITTED_GHSAS[0])
  })

  it('rejects unpatched 4.x and 5.0.7 copies but accepts 5.0.8, 2.1.3 and the backport', () => {
    const { store, addCopy, addConsumer } = fixtureStore()
    addConsumer('a@1.0.0', addCopy('brace-expansion@4.0.1', '4.0.1', 'module.exports = []'))
    addConsumer('b@1.0.0', addCopy('brace-expansion@5.0.7', '5.0.7', 'exports.expand = 1'))
    addConsumer('c@1.0.0', addCopy('brace-expansion@5.0.8', '5.0.8', 'exports.expand = 1'))
    addConsumer(
      'd@1.0.0',
      addCopy('brace-expansion@1.1.16_patch_hash=abc', '1.1.16', `var ${PATCH_MARKER} = 4000000`),
    )
    // Official and unpatched is exactly what #489 moved the 2.x line to.
    addConsumer('e@1.0.0', addCopy('brace-expansion@2.1.3', '2.1.3', 'module.exports = []'))

    const rejected = findVulnerableConsumerLinks(store, {
      patchesDir,
      workspaceConfig: trackedConfig,
    })

    expect(rejected.map((entry) => entry.consumer).sort()).toEqual(['a@1.0.0', 'b@1.0.0'])
  })

  it('accepts the 2.x line only from the official fixed floor upward', () => {
    for (const version of ['2.1.3', '2.1.4', '2.2.0', '2.9.9']) {
      expect(isOfficiallyFixedVersion(version), version).toBe(true)
    }
    // Below the floor, a prerelease of it, or off the 2.x line entirely.
    for (const version of ['2.1.2', '2.1.0', '2.0.3', '2.1.3-rc.1', '3.0.0', '1.1.16', '5.0.8']) {
      expect(isOfficiallyFixedVersion(version), version).toBe(false)
    }
    expect(OFFICIAL_FIXED_RANGE).toBe('>=2.1.3 <3.0.0')
  })

  it('rejects a residual 2.1.2 copy whether or not it still carries a patch', () => {
    for (const entry of ['brace-expansion@2.1.2', 'brace-expansion@2.1.2_patch_hash=abc']) {
      const { store, addCopy, addConsumer } = fixtureStore()
      addConsumer('minimatch@5.1.9', addCopy(entry, '2.1.2', `var ${PATCH_MARKER} = 4000000`))

      const rejected = findVulnerableConsumerLinks(store, {
        patchesDir,
        workspaceConfig: trackedConfig,
      })

      expect(rejected, entry).toHaveLength(1)
      expect(rejected[0].reason, entry).toContain('brace-expansion@2.1.2')
    }
  })

  // #489 handed the 2.x line back to upstream. Taking local ownership of it
  // again must fail, and the marker cannot detect that: official 2.1.3 ships
  // EXPANSION_MAX_LENGTH itself, so only the patch hash tells them apart.
  it('rejects renewed local patch ownership of the official 2.1.3 release', () => {
    const { store, addCopy, addConsumer } = fixtureStore()
    addConsumer(
      'minimatch@9.0.9',
      addCopy('brace-expansion@2.1.3_patch_hash=abc', '2.1.3', `var ${PATCH_MARKER} = 4000000`),
    )

    const rejected = findVulnerableConsumerLinks(store, {
      patchesDir,
      workspaceConfig: trackedConfig,
    })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toContain('must not carry a local patch')
  })

  it('rejects a patchedDependencies mapping beyond the tracked backport', () => {
    expect(checkUntrackedPatchMappings(trackedConfig)).toEqual([])
    expect(
      checkUntrackedPatchMappings(
        `${trackedConfig}  brace-expansion@2.1.3: patches/brace-expansion@2.1.3.patch\n`,
      ),
    ).toEqual([
      'patchedDependencies must not track brace-expansion@2.1.3; permitted: [brace-expansion@1.1.16]',
    ])
    expect(
      checkUntrackedPatchMappings(fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')),
    ).toEqual([])
  })

  it('leaves a stale vulnerable store entry alone while no consumer links to it', () => {
    const { store, addCopy, addConsumer } = fixtureStore()
    addCopy('brace-expansion@3.0.0', '3.0.0', 'module.exports = []')
    addConsumer(
      'e@1.0.0',
      addCopy('brace-expansion@1.1.16_patch_hash=def', '1.1.16', `var ${PATCH_MARKER} = 4000000`),
    )

    expect(findVulnerableConsumerLinks(store, { patchesDir, workspaceConfig: trackedConfig }))
      .toEqual([])
  })

  it('rejects a tracked version that lost its patch hash, marker, or workspace entry', () => {
    const cases: Array<[string, string, string, string]> = [
      ['brace-expansion@1.1.16', '1.1.16', `var ${PATCH_MARKER} = 4000000`, trackedConfig],
      ['brace-expansion@1.1.16_patch_hash=abc', '1.1.16', 'var unpatched = 1', trackedConfig],
      ['brace-expansion@1.1.16_patch_hash=abc', '1.1.16', `var ${PATCH_MARKER} = 4000000`, ''],
    ]

    for (const [entry, version, source, workspaceConfig] of cases) {
      const { store, addCopy, addConsumer } = fixtureStore()
      addConsumer('f@1.0.0', addCopy(entry, version, source))

      expect(
        findVulnerableConsumerLinks(store, { patchesDir, workspaceConfig }),
        `${entry} ${source}`,
      ).toHaveLength(1)
    }
  })

  it('accepts only the single permitted advisory ignore', () => {
    expect(checkAdvisoryIgnores(ignoreConfig(...PERMITTED_GHSAS))).toEqual([])

    for (const config of [
      ignoreConfig(PERMITTED_GHSAS[0], 'GHSA-0000-0000-0000'),
      ignoreConfig(PERMITTED_GHSAS[0], PERMITTED_GHSAS[0]),
      ignoreConfig('GHSA-0000-0000-0000'),
      'auditConfig:\n  ignoreGhsas: []\n',
      '',
    ]) {
      expect(checkAdvisoryIgnores(config), config).not.toEqual([])
    }
  })

  // Every spelling of a second suppression key must fail closed. A regex over
  // the raw text missed flow style, an empty key, and both quoted-key forms.
  it('rejects any auditConfig key beyond the permitted ignore list', () => {
    const permitted = ignoreConfig(...PERMITTED_GHSAS)

    for (const value of [
      '  ignoreCves:\n    - CVE-2026-14257\n',
      '  ignoreCves: [CVE-2026-14257]\n',
      '  ignoreCves: []\n',
      '  ignoreCves:\n',
      "  'ignoreCves': [CVE-2026-14257]\n",
      '  "ignoreCves": [CVE-2026-14257]\n',
      '  ? ignoreCves\n  : [CVE-2026-14257]\n',
      '  someFutureSuppression: [anything]\n',
    ]) {
      expect(checkAdvisoryIgnores(`${permitted}${value}`), value).toEqual([
        `auditConfig may only set ${PERMITTED_AUDIT_CONFIG_KEYS.join(', ')}, found [${
          value.includes('ignoreCves') ? 'ignoreCves' : 'someFutureSuppression'
        }]`,
      ])
    }
  })

  it('reads quoted keys and flow style the way pnpm does', () => {
    expect(checkAdvisoryIgnores(`${ignoreConfig(...PERMITTED_GHSAS)}  # ignoreCves: [CVE-1]\n`))
      .toEqual([])
    expect(checkAdvisoryIgnores(`auditConfig:\n  'ignoreGhsas': ['${PERMITTED_GHSAS[0]}']\n`))
      .toEqual([])
    expect(checkAdvisoryIgnores(`auditConfig:\n  ignoreGhsas: [${PERMITTED_GHSAS[0]}]\n`)).toEqual([])
    expect(checkAdvisoryIgnores('auditConfig:\n')).not.toEqual([])
  })

  // A commented-out mapping is absent to pnpm, so a substring check that still
  // saw it was reporting patches the installer never applied.
  it('counts only active parsed patchedDependencies mappings', () => {
    const real = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')

    expect(checkPatchedDependencies(real)).toEqual([])
    expect(
      checkPatchedDependencies(real.replace(/^( {2}brace-expansion@.*)$/gm, '#$1')),
    ).toHaveLength(LOCALLY_PATCHED_VERSIONS.length)
    expect(
      checkPatchedDependencies(real.replace(/^patchedDependencies:$/m, '#patchedDependencies:')),
    ).toHaveLength(LOCALLY_PATCHED_VERSIONS.length)
    expect(
      checkPatchedDependencies(
        real.replace('patches/brace-expansion@1.1.16.patch', 'patches/other.patch'),
      ),
    ).toHaveLength(1)
  })

  it('fails the gate when the tracked patch mapping is commented out', () => {
    const real = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brace-expansion-ws-'))
    tempRoots.push(root)
    const workspaceConfigPath = path.join(root, 'pnpm-workspace.yaml')
    fs.writeFileSync(workspaceConfigPath, real.replace(/^( {2}brace-expansion@.*)$/gm, '#$1'))

    const problems = proveBraceExpansionPatches({ workspaceConfigPath })

    expect(problems.length).toBeGreaterThan(0)
    for (const version of LOCALLY_PATCHED_VERSIONS) {
      expect(
        problems.some((problem) => problem.includes(`no active patchedDependencies entry for brace-expansion@${version}`)),
        version,
      ).toBe(true)
    }
  }, 20_000)

  // The mutation nothing static can catch: mapping, patch file, patch hash and
  // marker all survive, and only the bound's actual effect is removed. If the
  // runtime probe ever stops being load-bearing, this is what notices.
  it('fails the gate when the backport is present but no longer bounds anything', () => {
    const control = clonePatchedStore((source) => source)
    expect(proveBraceExpansionPatches({ storeRoot: control.store })).toEqual([])

    const { store, version } = clonePatchedStore((source) => {
      const disabled = source.replace(`var ${PATCH_MARKER} = 4000000;`, `var ${PATCH_MARKER} = Infinity;`)
      expect(disabled).not.toBe(source)
      return disabled
    })

    const problems = proveBraceExpansionPatches({ storeRoot: store })

    // Still mapped, still patched, still marked — and still caught.
    expect(checkPatchedDependencies(fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')))
      .toEqual([])
    expect(fs.existsSync(path.resolve(`patches/brace-expansion@${version}.patch`))).toBe(true)
    expect(problems.some((problem) => problem.startsWith(`brace-expansion@${version} length`))).toBe(
      true,
    )
  }, 60_000)

  it('fails the gate itself for both mutations, not just a companion test', () => {
    const { store, addCopy, addConsumer } = fixtureStore()
    addConsumer('minimatch@8.0.0', addCopy('brace-expansion@3.0.0', '3.0.0', 'module.exports = []'))
    const workspaceConfigPath = path.join(path.dirname(store), 'pnpm-workspace.yaml')
    fs.writeFileSync(workspaceConfigPath, ignoreConfig(PERMITTED_GHSAS[0], 'GHSA-0000-0000-0000'))

    const problems = proveBraceExpansionPatches({ storeRoot: store, workspaceConfigPath })

    expect(problems.some((problem) => problem.includes('brace-expansion@3.0.0'))).toBe(true)
    expect(problems.some((problem) => problem.includes('GHSA-0000-0000-0000'))).toBe(true)
  })
})
