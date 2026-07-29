import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { FAILSAFE_SCHEMA, load as loadYaml } from 'js-yaml'
import semver from 'semver'

/**
 * npm audit keys GHSA-mh99-v99m-4gvg on upstream version numbers, and the
 * advisory's published range (`<=5.0.7`) is coarser than the actual fix. Two
 * installed copies still match it, for different reasons:
 *
 *   - 2.x reaches the tree through electron-builder's minimatch 5.x/9.x and is
 *     the official fixed 2.1.3 release, which the advisory metadata has simply
 *     not been narrowed to exclude.
 *   - 1.1.16 reaches it through minimatch 3.x, has no fixed upstream release,
 *     and cannot move to brace-expansion 5 (it exports a named `expand` rather
 *     than a callable module), so the fix is backported through a tracked pnpm
 *     patch instead.
 *
 * This proof is what makes the advisory ignore honest, so it is the gate rather
 * than a companion test. It fails if any consumer resolves a copy in the
 * advisory range that is neither an official fixed release nor the tracked
 * backport, if the 2.x copy is older than the official fix or carries a local
 * patch this repository no longer owns, if the backport loses its mapping,
 * patch or marker, if the bound stops working at runtime on either line, or if
 * the ignore list stops being exactly the one permitted advisory.
 */
export const LOCALLY_PATCHED_VERSIONS = Object.freeze(['1.1.16'])
export const PERMITTED_GHSAS = Object.freeze(['GHSA-mh99-v99m-4gvg'])
/** The advisory covers every published version below this one. */
export const FIRST_PATCHED_UPSTREAM_VERSION = '5.0.8'
/**
 * Upstream backported the fix to the 2.x maintenance line in 2.1.3, below the
 * advisory's coarse floor. A copy in this range is accepted unpatched; #489
 * retired this repository's own 2.x backport in favour of it.
 */
export const OFFICIAL_FIXED_RANGE = '>=2.1.3 <3.0.0'
export const EXPANSION_MAX_LENGTH = 4_000_000
export const PATCH_MARKER = 'EXPANSION_MAX_LENGTH'
export const CORPUS_PATH = 'scripts/brace-expansion-corpus.json'
export const PROBE_HEAP_MB = 256
export const PREIMAGE_PACKAGE_NAME = 'brace-expansion-preimage'

/**
 * Inputs whose expansion count stays under `max` while every result grows with
 * the number of chained groups. `length` exhausted the heap; `deep` overflowed
 * the native stack once the tail recursed per group.
 */
export const PROBE_SCENARIOS = Object.freeze({
  length: 1_500,
  deep: 50_000,
})

const PROBE_SOURCE = `
const expand = require(process.argv[1])
if (typeof expand !== 'function') {
  throw new TypeError('brace-expansion must stay a callable CommonJS export')
}
const expansions = expand('{a,b}'.repeat(Number(process.argv[2])))
process.stdout.write(JSON.stringify({
  count: expansions.length,
  total: expansions.reduce((sum, value) => sum + value.length, 0),
  sane: expansions.every((value) => /^[ab]*$/.test(value)),
}))
`

/**
 * @typedef {{ ok: boolean, status: number | null, signal: string | null, result?: { count: number, total: number, sane: boolean } }} ProbeOutcome
 */

/**
 * Reverse a single-file unified diff, reconstructing the pre-patch text. Used
 * only to build the negative control, so the probe is proved able to fail.
 *
 * @param {string} patchedText
 * @param {string} patchText
 * @returns {string}
 */
export function reverseApplyUnifiedDiff(patchedText, patchText) {
  const patchedLines = patchedText.split('\n')
  const patchLines = patchText.split('\n')
  /** @type {string[]} */
  const out = []
  let cursor = 0

  for (let index = 0; index < patchLines.length; index += 1) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(patchLines[index])
    if (!header) continue

    const start = Number(header[1]) - 1
    const span = header[2] === undefined ? 1 : Number(header[2])
    if (start < cursor) throw new Error('unified diff hunks are out of order')
    out.push(...patchedLines.slice(cursor, start))

    let consumed = 0
    for (index += 1; index < patchLines.length && consumed < span; index += 1) {
      const line = patchLines[index]
      if (line.startsWith('+')) {
        consumed += 1
      } else if (line.startsWith('-')) {
        out.push(line.slice(1))
      } else if (line.startsWith(' ') || line === '') {
        out.push(line.slice(1))
        consumed += 1
      } else {
        throw new Error(`unsupported unified diff line: ${line}`)
      }
    }
    index -= 1
    cursor = start + span
  }

  out.push(...patchedLines.slice(cursor))
  return out.join('\n')
}

/**
 * Every brace-expansion copy pnpm actually materialised, keyed by the directory
 * name it gives patched packages (`<name>@<version>_patch_hash=<hash>`).
 *
 * @param {string} storeRoot usually node_modules/.pnpm
 * @returns {Array<{ version: string, patchHash: string | null, packageDir: string }>}
 */
export function discoverBraceExpansionCopies(storeRoot) {
  if (!fs.existsSync(storeRoot)) return []
  return fs
    .readdirSync(storeRoot)
    .map((entry) => /^brace-expansion@([^_]+)(?:_patch_hash=(.+))?$/.exec(entry))
    .filter((match) => match !== null)
    .map((match) => ({
      version: match[1],
      patchHash: match[2] ?? null,
      packageDir: path.join(storeRoot, match[0], 'node_modules', 'brace-expansion'),
    }))
}

/**
 * Order two versions with SemVer semantics. Returns NaN when either side is not
 * strictly valid SemVer — including `5.0.9-`, `5.0.9-..` and leading-zero forms
 * such as `05.0.9` — so callers fail closed instead of guessing.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareVersions(left, right) {
  const a = semver.parse(left, { loose: false })
  const b = semver.parse(right, { loose: false })
  if (!a || !b) return Number.NaN
  return semver.compare(a, b)
}

/**
 * GHSA-mh99-v99m-4gvg covers every published brace-expansion at or below 5.0.7,
 * across the 1.x, 2.x, 3.x, 4.x and 5.0.x lines — not just the two the tree
 * happens to install today. `includePrerelease` keeps prereleases of the first
 * fixed release, which predate its fix, inside the range.
 *
 * @param {string} version
 * @returns {boolean}
 */
export function isVulnerableVersion(version) {
  const parsed = semver.parse(version, { loose: false })
  // `semver` tolerates surrounding whitespace and drops build metadata, so also
  // require the raw string to already be the canonical version.
  if (!parsed || parsed.version !== version) return true
  return semver.satisfies(parsed, `<${FIRST_PATCHED_UPSTREAM_VERSION}`, { includePrerelease: true })
}

/**
 * Whether a version inside the advisory's coarse range nonetheless carries the
 * official upstream fix, because upstream patched that maintenance line after
 * the advisory was published.
 *
 * @param {string} version
 * @returns {boolean}
 */
export function isOfficiallyFixedVersion(version) {
  const parsed = semver.parse(version, { loose: false })
  if (!parsed || parsed.version !== version) return false
  return semver.satisfies(parsed, OFFICIAL_FIXED_RANGE)
}

/**
 * Why a consumer-resolved copy is unacceptable, or null when it is fine. A copy
 * in the advisory range is accepted only as an official fixed release carrying
 * no local patch, or as one of the tracked patch-hashed backports still
 * carrying the marker and still backed by a tracked patch.
 *
 * @param {string} target realpath of the resolved package directory
 * @param {{ patchesDir: string, workspaceConfig: string }} options
 * @returns {string | null}
 */
export function describeUnacceptableCopy(target, options) {
  const manifestPath = path.join(target, 'package.json')
  if (!fs.existsSync(manifestPath)) return `has no package.json at ${target}`
  const version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version
  if (!isVulnerableVersion(version)) return null

  const storeEntry = path.basename(path.dirname(path.dirname(target)))
  const hashed = /^brace-expansion@([^_]+)_patch_hash=.+$/.exec(storeEntry)

  // An officially fixed release must stay official. Re-patching one would put
  // this repository back in the ownership #489 handed to upstream, and the
  // patch marker cannot tell the two apart: 2.1.3 ships EXPANSION_MAX_LENGTH
  // itself, so only the absent patch hash distinguishes them.
  if (isOfficiallyFixedVersion(version)) {
    if (!hashed) return null
    return (
      `resolves brace-expansion@${version} from ${storeEntry}, but the official fixed ` +
      'release must not carry a local patch'
    )
  }

  if (!LOCALLY_PATCHED_VERSIONS.includes(version)) {
    return `resolves brace-expansion@${version}, covered by ${PERMITTED_GHSAS[0]} with no tracked backport`
  }

  if (!hashed || hashed[1] !== version) {
    return `resolves brace-expansion@${version} from ${storeEntry}, which pnpm did not patch`
  }

  const indexPath = path.join(target, 'index.js')
  if (!fs.existsSync(indexPath) || !fs.readFileSync(indexPath, 'utf8').includes(PATCH_MARKER)) {
    return `resolves brace-expansion@${version} without the backported ${PATCH_MARKER} bound`
  }

  const patchRelative = `patches/brace-expansion@${version}.patch`
  if (!fs.existsSync(path.join(options.patchesDir, `brace-expansion@${version}.patch`))) {
    return `resolves brace-expansion@${version} with no tracked ${patchRelative}`
  }
  const untracked = checkPatchedDependencies(options.workspaceConfig, [version])
  if (untracked.length > 0) {
    return `resolves brace-expansion@${version}, which pnpm-workspace.yaml does not track`
  }
  return null
}

/**
 * Resolve what each consumer's `require('brace-expansion')` actually reaches.
 * A stale unreferenced directory in the store is harmless; one that a consumer
 * still links to is not.
 *
 * @param {string} storeRoot
 * @returns {Array<{ consumer: string, target: string }>}
 */
export function findConsumerLinks(storeRoot) {
  if (!fs.existsSync(storeRoot)) return []

  /** @type {Array<{ consumer: string, link: string }>} */
  const links = fs
    .readdirSync(storeRoot)
    // A store entry always contains its own package; only links from other
    // packages say anything about what consumers resolve.
    .filter((entry) => !entry.startsWith('brace-expansion@'))
    .map((entry) => ({
      consumer: entry,
      link: path.join(storeRoot, entry, 'node_modules', 'brace-expansion'),
    }))
  // A hoisted copy beside the store is resolved by the app itself.
  links.push({
    consumer: '<root>',
    link: path.join(path.dirname(storeRoot), 'brace-expansion'),
  })

  return links
    .filter(({ link }) => fs.existsSync(link))
    .map(({ consumer, link }) => ({ consumer, target: fs.realpathSync(link) }))
}

/**
 * @param {string} storeRoot
 * @param {{ patchesDir?: string, workspaceConfig?: string }} [options]
 * @returns {Array<{ consumer: string, target: string, reason: string }>}
 */
export function findVulnerableConsumerLinks(storeRoot, options = {}) {
  const resolved = {
    patchesDir: path.resolve(options.patchesDir ?? 'patches'),
    workspaceConfig: options.workspaceConfig ?? '',
  }

  /** @type {Array<{ consumer: string, target: string, reason: string }>} */
  const rejected = []
  for (const { consumer, target } of findConsumerLinks(storeRoot)) {
    const reason = describeUnacceptableCopy(target, resolved)
    if (reason) rejected.push({ consumer, target, reason })
  }
  return rejected
}

/**
 * The distinct copies consumers actually resolve, deduplicated by directory.
 * Runtime probes run over these rather than over every store entry, so a stale
 * unreferenced directory stays harmless while every reachable copy is proved.
 *
 * @param {string} storeRoot
 * @returns {Array<{ version: string, packageDir: string }>}
 */
export function findConsumerReachableCopies(storeRoot) {
  /** @type {Map<string, { version: string, packageDir: string }>} */
  const byDirectory = new Map()
  for (const { target } of findConsumerLinks(storeRoot)) {
    if (byDirectory.has(target)) continue
    const manifestPath = path.join(target, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const { version } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    byDirectory.set(target, { version, packageDir: target })
  }
  return [...byDirectory.values()]
}

/** The only `auditConfig` key this repository is allowed to set. */
export const PERMITTED_AUDIT_CONFIG_KEYS = Object.freeze(['ignoreGhsas'])

/**
 * Parse pnpm-workspace.yaml. Quoted keys, flow style and comments are all valid
 * YAML that a regex reads differently from pnpm, so every check below works off
 * the parsed document.
 *
 * @param {string} workspaceConfig
 * @returns {{ document: Record<string, unknown> | null, problem: string | null }}
 */
export function parseWorkspaceConfig(workspaceConfig) {
  try {
    // FAILSAFE_SCHEMA keeps every scalar a string, so no YAML type coercion can
    // turn a suppression value into something these checks read differently.
    const document = loadYaml(workspaceConfig, { schema: FAILSAFE_SCHEMA })
    if (document === null || document === undefined) return { document: {}, problem: null }
    if (typeof document !== 'object' || Array.isArray(document)) {
      return { document: null, problem: 'pnpm-workspace.yaml is not a YAML mapping' }
    }
    return { document: /** @type {Record<string, unknown>} */ (document), problem: null }
  } catch (error) {
    return { document: null, problem: `pnpm-workspace.yaml is not valid YAML: ${String(error)}` }
  }
}

/**
 * A key whose children are all commented out parses as an empty scalar, which
 * means the same thing as an absent mapping and must read that way here.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown> | null} null when the value is not a mapping
 */
function asMapping(value) {
  if (value === undefined || value === null || value === '') return {}
  if (typeof value !== 'object' || Array.isArray(value)) return null
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * The gate cannot delegate this to a companion test: `pnpm run audit:high` runs
 * this proof and then hands `pnpm audit` an ignore list, so a second ignore
 * slipped in beside the permitted one would suppress an unproved advisory.
 *
 * @param {string} workspaceConfig
 * @returns {string[]}
 */
export function checkAdvisoryIgnores(workspaceConfig) {
  const { document, problem } = parseWorkspaceConfig(workspaceConfig)
  if (!document) return [/** @type {string} */ (problem)]

  /** @type {string[]} */
  const problems = []
  const config = asMapping(document.auditConfig)
  if (!config) {
    return [`auditConfig must be a mapping, found ${JSON.stringify(document.auditConfig)}`]
  }

  // Any key beyond the permitted one is a suppression channel this proof has
  // not reasoned about, so it fails closed rather than being ignored.
  const unexpected = Object.keys(config).filter(
    (key) => !PERMITTED_AUDIT_CONFIG_KEYS.includes(key),
  )
  if (unexpected.length > 0) {
    problems.push(`auditConfig may only set ${PERMITTED_AUDIT_CONFIG_KEYS.join(', ')}, found [${unexpected.join(', ')}]`)
  }

  const ignored = config.ignoreGhsas
  const list = Array.isArray(ignored) ? ignored.map((entry) => String(entry)) : null
  if (
    list === null ||
    list.length !== PERMITTED_GHSAS.length ||
    list.some((ghsa, index) => ghsa !== PERMITTED_GHSAS[index])
  ) {
    problems.push(
      `auditConfig.ignoreGhsas must be exactly [${PERMITTED_GHSAS.join(', ')}], found ` +
        `${JSON.stringify(ignored ?? null)}`,
    )
  }

  return problems
}

/**
 * The tracked backports are the only patches this repository may own. #489
 * handed the 2.x line back to upstream, so reintroducing any mapping beyond the
 * tracked ones — most obviously a renewed patch over the official 2.1.3 — has
 * to fail the gate rather than quietly re-enter local ownership.
 *
 * @param {string} workspaceConfig
 * @returns {string[]}
 */
export function checkUntrackedPatchMappings(workspaceConfig) {
  const { document, problem } = parseWorkspaceConfig(workspaceConfig)
  if (!document) return [/** @type {string} */ (problem)]

  const mappings = asMapping(document.patchedDependencies)
  if (!mappings) return []

  const permitted = LOCALLY_PATCHED_VERSIONS.map((version) => `brace-expansion@${version}`)
  return Object.keys(mappings)
    .filter((key) => !permitted.includes(key))
    .map((key) => `patchedDependencies must not track ${key}; permitted: [${permitted.join(', ')}]`)
}

/**
 * Confirm each expected patch is an active parsed mapping with the exact path.
 * A commented-out mapping is absent to pnpm, so it must be absent here too.
 *
 * @param {string} workspaceConfig
 * @param {string[]} [versions]
 * @returns {string[]}
 */
export function checkPatchedDependencies(workspaceConfig, versions = LOCALLY_PATCHED_VERSIONS) {
  const { document, problem } = parseWorkspaceConfig(workspaceConfig)
  if (!document) return [/** @type {string} */ (problem)]

  const mappings = asMapping(document.patchedDependencies)
  if (!mappings) {
    return [
      `patchedDependencies must be a mapping, found ${JSON.stringify(document.patchedDependencies)}`,
    ]
  }

  /** @type {string[]} */
  const problems = []
  for (const version of versions) {
    const key = `brace-expansion@${version}`
    const expected = `patches/brace-expansion@${version}.patch`
    if (!Object.hasOwn(mappings, key)) {
      problems.push(`pnpm-workspace.yaml has no active patchedDependencies entry for ${key}`)
    } else if (mappings[key] !== expected) {
      problems.push(
        `patchedDependencies["${key}"] must be ${expected}, found ${JSON.stringify(mappings[key])}`,
      )
    }
  }
  return problems
}

/**
 * Run one expansion in a child process with a small heap. A vulnerable copy
 * aborts (heap OOM) or exits non-zero (stack overflow) instead of returning, so
 * the main process is never at risk.
 *
 * @param {{ modulePath: string, groups: number, heapMb?: number }} options
 * @returns {ProbeOutcome}
 */
export function runExpansionProbe(options) {
  const child = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${options.heapMb ?? PROBE_HEAP_MB}`,
      '-e',
      PROBE_SOURCE,
      options.modulePath,
      String(options.groups),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  if (child.status !== 0 || child.signal) {
    return { ok: false, status: child.status, signal: child.signal }
  }
  return { ok: true, status: 0, signal: null, result: JSON.parse(child.stdout) }
}

/**
 * @param {ProbeOutcome} outcome
 * @param {string} label
 * @returns {string[]}
 */
export function checkProbeIsBounded(outcome, label) {
  if (!outcome.ok) {
    return [`${label}: crashed (status=${outcome.status}, signal=${outcome.signal})`]
  }
  /** @type {string[]} */
  const problems = []
  const { count, total, sane } = /** @type {{ count: number, total: number, sane: boolean }} */ (
    outcome.result
  )
  if (total > EXPANSION_MAX_LENGTH) {
    problems.push(`${label}: total expansion length ${total} exceeds ${EXPANSION_MAX_LENGTH}`)
  }
  if (count <= 0) problems.push(`${label}: returned no expansions`)
  if (!sane) problems.push(`${label}: returned malformed expansions`)
  return problems
}

/**
 * Expand the whole corpus inside `packageDir` and compare against `expected`.
 * A null entry means "no oracle for this pattern" and is skipped, which is how
 * the bash oracle covers the patterns bash itself cannot express.
 *
 * @param {string} packageDir
 * @param {string} label
 * @param {{ patterns: string[] }} corpus
 * @param {(string[] | null)[] | undefined} expected
 * @returns {string[]}
 */
export function checkCorpusCompatibility(packageDir, label, corpus, expected) {
  if (!expected) return [`${label}: no recorded expansions to compare against`]

  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `
      const expand = require(process.argv[1])
      const corpus = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'))
      process.stdout.write(JSON.stringify(corpus.patterns.map((pattern) => expand(pattern))))
      `,
      path.join(packageDir, 'index.js'),
      path.resolve(CORPUS_PATH),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (child.status !== 0) {
    return [`${label}: corpus expansion failed: ${child.stderr.trim().split('\n').pop()}`]
  }

  /** @type {string[]} */
  const problems = []
  const actual = JSON.parse(child.stdout)
  for (const [index, pattern] of corpus.patterns.entries()) {
    if (expected[index] === null) continue
    if (JSON.stringify(actual[index]) === JSON.stringify(expected[index])) continue
    problems.push(
      `${label}: expansion of ${JSON.stringify(pattern)} changed — ` +
        `got ${JSON.stringify(actual[index])}, expected ${JSON.stringify(expected[index])}`,
    )
  }
  return problems
}

/**
 * Rebuild the unpatched source beside the patched one so it resolves the same
 * dependencies, proving the probe reports a vulnerable copy as vulnerable.
 *
 * @param {{ packageDir: string, patchPath: string }} options
 * @returns {string} path to the reconstructed pre-patch module
 */
export function writePreimageModule(options) {
  const patched = fs.readFileSync(path.join(options.packageDir, 'index.js'), 'utf8')
  const preimage = reverseApplyUnifiedDiff(patched, fs.readFileSync(options.patchPath, 'utf8'))
  if (preimage.includes(PATCH_MARKER)) {
    throw new Error('reverse-applied source still contains the patch marker')
  }
  const preimageDir = path.join(path.dirname(options.packageDir), PREIMAGE_PACKAGE_NAME)
  fs.rmSync(preimageDir, { recursive: true, force: true })
  fs.mkdirSync(preimageDir, { recursive: true })
  fs.writeFileSync(path.join(preimageDir, 'index.js'), preimage)
  return path.join(preimageDir, 'index.js')
}

/**
 * @param {string} packageDir
 * @returns {void}
 */
export function removePreimageModule(packageDir) {
  fs.rmSync(path.join(path.dirname(packageDir), PREIMAGE_PACKAGE_NAME), {
    recursive: true,
    force: true,
  })
}

/**
 * @param {{ storeRoot?: string, patchesDir?: string, workspaceConfigPath?: string }} [options]
 * @returns {string[]}
 */
export function proveBraceExpansionPatches(options = {}) {
  const storeRoot = path.resolve(options.storeRoot ?? path.join('node_modules', '.pnpm'))
  const patchesDir = path.resolve(options.patchesDir ?? 'patches')
  const workspaceConfigPath = path.resolve(options.workspaceConfigPath ?? 'pnpm-workspace.yaml')
  /** @type {string[]} */
  const problems = []

  const workspaceConfig = fs.readFileSync(workspaceConfigPath, 'utf8')
  const corpus = JSON.parse(fs.readFileSync(path.resolve(CORPUS_PATH), 'utf8'))
  const copies = discoverBraceExpansionCopies(storeRoot)

  problems.push(...checkAdvisoryIgnores(workspaceConfig))
  problems.push(...checkPatchedDependencies(workspaceConfig))
  problems.push(...checkUntrackedPatchMappings(workspaceConfig))

  for (const link of findVulnerableConsumerLinks(storeRoot, { patchesDir, workspaceConfig })) {
    problems.push(`${link.consumer} ${link.reason} (${link.target})`)
  }

  // Every consumer-reachable copy the advisory still matches has to be proved
  // non-exploitable at runtime, whichever line it is on and whoever fixed it.
  // This is the only check that catches a backport which is present, mapped and
  // marked but no longer actually bounds anything.
  for (const copy of findConsumerReachableCopies(storeRoot)) {
    if (!isVulnerableVersion(copy.version)) continue
    for (const [scenario, groups] of Object.entries(PROBE_SCENARIOS)) {
      problems.push(
        ...checkProbeIsBounded(
          runExpansionProbe({ modulePath: path.join(copy.packageDir, 'index.js'), groups }),
          `brace-expansion@${copy.version} ${scenario}`,
        ),
      )
    }
    // The official fixed release has no recorded pre-patch oracle of its own,
    // so bash is what proves upstream's fix left ordinary expansion alone.
    if (isOfficiallyFixedVersion(copy.version)) {
      problems.push(
        ...checkCorpusCompatibility(copy.packageDir, copy.version, corpus, corpus.bash),
      )
    }
  }

  for (const version of LOCALLY_PATCHED_VERSIONS) {
    const patchPath = path.join(patchesDir, `brace-expansion@${version}.patch`)
    if (!fs.existsSync(patchPath)) {
      problems.push(`missing tracked patch ${path.relative(process.cwd(), patchPath)}`)
      continue
    }

    const patched = copies.filter((copy) => copy.version === version && copy.patchHash)
    if (patched.length === 0) {
      problems.push(`no patched brace-expansion@${version} installed under ${storeRoot}`)
      continue
    }

    for (const copy of patched) {
      const source = fs.readFileSync(path.join(copy.packageDir, 'index.js'), 'utf8')
      if (!source.includes(PATCH_MARKER)) {
        problems.push(`${version}: installed copy is missing the backported ${PATCH_MARKER} bound`)
      }
      problems.push(
        ...checkCorpusCompatibility(copy.packageDir, version, corpus, corpus.expected[version]),
      )

      // Negative control: the same probe must report the pre-patch source as
      // vulnerable, otherwise a passing run would prove nothing.
      try {
        const preimagePath = writePreimageModule({ packageDir: copy.packageDir, patchPath })
        // A crash from a failed require would make the control vacuous, so
        // first prove the reconstructed source loads and expands normally.
        const healthy = runExpansionProbe({ modulePath: preimagePath, groups: 2 })
        if (!healthy.ok) {
          problems.push(
            `brace-expansion@${version}: the reconstructed pre-patch source does not run ` +
              `(status=${healthy.status}, signal=${healthy.signal}), so the negative control is vacuous`,
          )
        } else {
          for (const [scenario, groups] of Object.entries(PROBE_SCENARIOS)) {
            const outcome = runExpansionProbe({ modulePath: preimagePath, groups })
            if (checkProbeIsBounded(outcome, 'preimage').length === 0) {
              problems.push(
                `brace-expansion@${version} ${scenario}: pre-patch source stayed bounded, ` +
                  'so this proof cannot detect the vulnerability',
              )
            }
          }
        }
      } catch (error) {
        problems.push(
          `brace-expansion@${version}: could not build the negative control: ${String(error)}`,
        )
      } finally {
        removePreimageModule(copy.packageDir)
      }
    }
  }

  return problems
}

/** @returns {void} */
function run() {
  const problems = proveBraceExpansionPatches()
  if (problems.length === 0) {
    process.stdout.write(
      'brace-expansion CVE-2026-14257 verified: official fix accepted for ' +
        `${OFFICIAL_FIXED_RANGE}, tracked backport verified for ` +
        `${LOCALLY_PATCHED_VERSIONS.join(', ')}\n`,
    )
    return
  }
  for (const problem of problems) process.stderr.write(`${problem}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
