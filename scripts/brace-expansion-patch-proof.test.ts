import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXPANSION_MAX_LENGTH,
  PATCHED_VERSIONS,
  PATCH_MARKER,
  PERMITTED_AUDIT_CONFIG_KEYS,
  PERMITTED_GHSAS,
  PROBE_SCENARIOS,
  checkAdvisoryIgnores,
  checkPatchedDependencies,
  checkProbeIsBounded,
  compareVersions,
  discoverBraceExpansionCopies,
  findVulnerableConsumerLinks,
  isVulnerableVersion,
  proveBraceExpansionPatches,
  reverseApplyUnifiedDiff,
  runExpansionProbe,
} from './brace-expansion-patch-proof.mjs'

const storeRoot = path.resolve('node_modules', '.pnpm')
const patchesDir = path.resolve('patches')
const trackedConfig = `patchedDependencies:\n${PATCHED_VERSIONS.map(
  (version) => `  brace-expansion@${version}: patches/brace-expansion@${version}.patch\n`,
).join('')}`

function patchedCopies() {
  return discoverBraceExpansionCopies(storeRoot).filter((copy) => copy.patchHash)
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

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

  it('tracks one pnpm patch per vulnerable version', () => {
    const workspaceConfig = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    const tracked = [...workspaceConfig.matchAll(/^ {2}(\S+): (patches\/\S+)$/gm)].map((m) => m[1])

    expect(tracked).toEqual(PATCHED_VERSIONS.map((version) => `brace-expansion@${version}`))
    for (const version of PATCHED_VERSIONS) {
      const patch = fs.readFileSync(path.resolve(`patches/brace-expansion@${version}.patch`), 'utf8')
      expect(patch).toContain('a1bd339')
      expect(patch).toContain(PATCH_MARKER)
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

  it('bounds the chained-group expansion that used to exhaust the heap', () => {
    for (const copy of patchedCopies()) {
      const outcome = runExpansionProbe({
        modulePath: path.join(copy.packageDir, 'index.js'),
        groups: PROBE_SCENARIOS.length,
      })

      expect(checkProbeIsBounded(outcome, copy.version)).toEqual([])
      expect(outcome.result?.total).toBeLessThanOrEqual(EXPANSION_MAX_LENGTH)
    }
  })

  it('survives the deep chaining that used to overflow the native stack', () => {
    for (const copy of patchedCopies()) {
      const outcome = runExpansionProbe({
        modulePath: path.join(copy.packageDir, 'index.js'),
        groups: PROBE_SCENARIOS.deep,
      })

      expect(checkProbeIsBounded(outcome, copy.version)).toEqual([])
    }
  })

  it('leaves ordinary expansion untouched on both lines', () => {
    const corpus = JSON.parse(
      fs.readFileSync(path.resolve('scripts/brace-expansion-corpus.json'), 'utf8'),
    ) as { patterns: string[]; bash: (string[] | null)[]; expected: Record<string, string[][]> }

    expect(corpus.patterns.length).toBeGreaterThan(150)
    for (const copy of patchedCopies()) {
      const expand = createRequire(import.meta.url)(
        path.join(copy.packageDir, 'index.js'),
      ) as (pattern: string) => string[]
      expect(typeof expand).toBe('function')

      corpus.patterns.forEach((pattern, index) => {
        expect(expand(pattern), pattern).toEqual(corpus.expected[copy.version][index])
        const bash = corpus.bash[index]
        if (bash) expect(expand(pattern), `${pattern} vs bash`).toEqual(bash)
      })
    }
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

  it('rejects unpatched 4.x and 5.0.7 copies but accepts 5.0.8 and patched backports', () => {
    const { store, addCopy, addConsumer } = fixtureStore()
    addConsumer('a@1.0.0', addCopy('brace-expansion@4.0.1', '4.0.1', 'module.exports = []'))
    addConsumer('b@1.0.0', addCopy('brace-expansion@5.0.7', '5.0.7', 'exports.expand = 1'))
    addConsumer('c@1.0.0', addCopy('brace-expansion@5.0.8', '5.0.8', 'exports.expand = 1'))
    addConsumer(
      'd@1.0.0',
      addCopy('brace-expansion@2.1.2_patch_hash=abc', '2.1.2', `var ${PATCH_MARKER} = 4000000`),
    )

    const rejected = findVulnerableConsumerLinks(store, {
      patchesDir,
      workspaceConfig: trackedConfig,
    })

    expect(rejected.map((entry) => entry.consumer).sort()).toEqual(['a@1.0.0', 'b@1.0.0'])
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
      ['brace-expansion@2.1.2', '2.1.2', `var ${PATCH_MARKER} = 4000000`, trackedConfig],
      ['brace-expansion@2.1.2_patch_hash=abc', '2.1.2', 'var unpatched = 1', trackedConfig],
      ['brace-expansion@2.1.2_patch_hash=abc', '2.1.2', `var ${PATCH_MARKER} = 4000000`, ''],
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
    ).toHaveLength(PATCHED_VERSIONS.length)
    expect(
      checkPatchedDependencies(real.replace(/^( {2}brace-expansion@2\.1\.2.*)$/gm, '#$1')),
    ).toHaveLength(1)
    expect(
      checkPatchedDependencies(real.replace(/^patchedDependencies:$/m, '#patchedDependencies:')),
    ).toHaveLength(PATCHED_VERSIONS.length)
    expect(
      checkPatchedDependencies(
        real.replace('patches/brace-expansion@2.1.2.patch', 'patches/other.patch'),
      ),
    ).toHaveLength(1)
  })

  it('fails the gate when both expected patch mappings are commented out', () => {
    const real = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brace-expansion-ws-'))
    tempRoots.push(root)
    const workspaceConfigPath = path.join(root, 'pnpm-workspace.yaml')
    fs.writeFileSync(workspaceConfigPath, real.replace(/^( {2}brace-expansion@.*)$/gm, '#$1'))

    const problems = proveBraceExpansionPatches({ workspaceConfigPath })

    expect(problems.length).toBeGreaterThan(0)
    for (const version of PATCHED_VERSIONS) {
      expect(
        problems.some((problem) => problem.includes(`no active patchedDependencies entry for brace-expansion@${version}`)),
        version,
      ).toBe(true)
    }
  }, 15_000)

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
