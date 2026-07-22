import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const defaultRoot = path.resolve(import.meta.dirname, '..')
const manifestArgument = process.argv.slice(2).find((argument) => argument.startsWith('--manifest='))
const manifestPath = manifestArgument
  ? path.resolve(manifestArgument.slice('--manifest='.length))
  : path.join(defaultRoot, 'drizzle', 'clean-cutover-selector-manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const printObserved = process.argv.includes('--print-observed')
const expectedHeadArgs = process.argv.slice(2).filter((argument) => argument.startsWith('--expected-head='))
const expectedHeads = new Map(expectedHeadArgs.map(parseExpectedHeadArgument))
const repoArgs = process.argv.slice(2).filter((argument) => argument.startsWith('--repo='))
const exactMode = repoArgs.length > 0 && !printObserved
const repos = repoArgs.length === 0
  ? [{ name: 'app', root: defaultRoot }]
  : repoArgs.map(parseRepoArgument)

const tokenGroups = {
  raw_record: /\b(?:raw[_-]?records?|rawRecords?|rawRecordId|rawRevisionId)\b/g,
  raw_source: /\b(?:raw[_-]?sources?|rawSources?)\b/g,
  canonical_candidate: /\b(?:canonical[_-]?candidates?|canonicalCandidates?|canonicalCandidateId)\b/g,
  sourcing_finding: /\b(?:sourcing[_-]?findings?|sourcingFindings?|sourcingFindingId)\b/g,
  normalization_projection: /\b(?:normalization[_-]?attempts?|normalizationAttempts?|canonical[_-]?projections?|canonicalProjections?|projection[_-]?attempts?|projectionAttempts?)\b/g,
  legacy_capture_root: /\b(?:capture[_-]?lineages?|captureLineages?|capture[_-]?evidence[_-]?versions?|captureEvidenceVersions?)\b/g,
  temporary_lifecycle_root: /\b(?:lifecycleCaptures?|lifecycleJobs?|lifecycleOpportunities?|lifecycleApplications?|lifecycle_(?:captures|jobs|opportunities|applications))\b/g,
  collapsed_retry_work: /\b(?:retry[_-]?work|retryWork(?:Id)?)\b/g,
  retired_sourcing_path: /(?:\/v1\/[^\s'"`]*sourcing(?:\/|\b)|\bmodules\/sourcing\b)/g,
}

const observed = []
const provenances = []
for (const repo of repos) {
  provenances.push(assertRepositoryProvenance(repo))
  const counts = new Map()
  visit(repo, repo.root, counts)
  for (const [key, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    const [file, category] = key.split('\0')
    observed.push({ repo: repo.name, file, category, count })
  }
}

if (printObserved) {
  process.stdout.write(`${JSON.stringify(observed, null, 2)}\n`)
  process.exit(0)
}

const expected = manifest.dispositions.filter((entry) => repos.some((repo) => repo.name === entry.repo))
const observedKeys = new Map(observed.map((entry) => [entryKey(entry), entry.count]))
const expectedKeys = new Map(expected.map((entry) => [entryKey(entry), entry.count]))
const failures = []
for (const entry of observed) {
  const expectedCount = expectedKeys.get(entryKey(entry))
  if (expectedCount === undefined) failures.push(`unclassified ${entry.repo}:${entry.file} [${entry.category}] x${entry.count}`)
  else if (expectedCount !== entry.count) failures.push(`count drift ${entry.repo}:${entry.file} [${entry.category}] expected ${expectedCount}, found ${entry.count}`)
}
for (const entry of expected) {
  if (!observedKeys.has(entryKey(entry))) failures.push(`stale disposition ${entry.repo}:${entry.file} [${entry.category}]`)
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`))
  process.exitCode = 1
} else {
  const mode = exactMode ? 'exact committed-tree validation' : 'working-tree count validation (not exact-head provenance)'
  process.stdout.write(`Lifecycle cutover selectors OK (${repos.map((repo) => repo.name).join(', ')}; ${mode})\n`)
  for (const provenance of provenances) {
    process.stdout.write(`${provenance.repo}: commit ${provenance.head}, tree ${provenance.tree}, ${provenance.exact ? 'clean/exact' : 'working tree'}\n`)
  }
}

function parseRepoArgument(argument) {
  const match = /^--repo=(app|sparxie|cli)=(.+)$/.exec(argument)
  if (!match) throw new Error(`Expected --repo=<app|sparxie|cli>=<path>, received ${argument}`)
  return { name: match[1], root: path.resolve(match[2]) }
}

function parseExpectedHeadArgument(argument) {
  const match = /^--expected-head=(app|sparxie|cli)=([0-9a-f]{40})$/.exec(argument)
  if (!match) throw new Error(`Expected --expected-head=<app|sparxie|cli>=<40-char SHA>, received ${argument}`)
  return [match[1], match[2]]
}

function assertRepositoryProvenance(repo) {
  const expectedHead = expectedHeads.get(repo.name) ?? manifest.heads[repo.name]
  const actualHead = execFileSync('git', ['-C', repo.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const actualTree = execFileSync('git', ['-C', repo.root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
  if (!exactMode) return { repo: repo.name, head: actualHead, tree: actualTree, exact: false }
  const status = execFileSync(
    'git', ['-C', repo.root, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' },
  ).trim()
  if (status) {
    throw new Error(`${repo.name} exact-head inspection requires a clean repository; git status is nonempty`)
  }
  if (expectedHead === 'runtime') throw new Error('Multi-repository inspection requires --expected-head=app=<40-char SHA>')
  if (actualHead !== expectedHead) throw new Error(`${repo.name} HEAD ${actualHead} does not match inspected head ${expectedHead}`)
  const claimedTree = execFileSync('git', ['-C', repo.root, 'rev-parse', `${expectedHead}^{tree}`], { encoding: 'utf8' }).trim()
  if (actualTree !== claimedTree) throw new Error(`${repo.name} tree ${actualTree} does not match claimed commit tree ${claimedTree}`)
  const manifestTree = manifest.trees[repo.name]
  if (manifestTree !== 'runtime' && manifestTree !== claimedTree) {
    throw new Error(`${repo.name} claimed tree ${claimedTree} does not match manifest tree ${manifestTree}`)
  }
  return { repo: repo.name, head: actualHead, tree: actualTree, exact: true }
}

function visit(repo, currentPath, counts) {
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.local'
      || entry.name === 'dist' || entry.name === 'dist-electron' || entry.name === 'release') continue
    const absolutePath = path.join(currentPath, entry.name)
    if (entry.isDirectory()) visit(repo, absolutePath, counts)
    else if (isAuditedFile(repo, absolutePath)) auditFile(repo, absolutePath, counts)
  }
}

function isAuditedFile(repo, absolutePath) {
  const relative = relativePath(repo, absolutePath)
  if (repo.name === 'app' && [
    'scripts/lifecycle-cutover-selectors.mjs',
    'drizzle/clean-cutover-selector-manifest.json',
    'drizzle/clean-cutover-dispositions.md',
  ].includes(relative)) return false
  return /\.(?:cjs|cts|js|json|jsx|md|mjs|mts|sql|ts|tsx|yaml|yml)$/.test(relative)
}

function auditFile(repo, absolutePath, counts) {
  const relative = relativePath(repo, absolutePath)
  const contents = fs.readFileSync(absolutePath, 'utf8')
  for (const [category, pattern] of Object.entries(tokenGroups)) {
    pattern.lastIndex = 0
    const count = [...contents.matchAll(pattern)].length
    if (count > 0) counts.set(`${relative}\0${category}`, count)
  }
  for (const [category, pattern] of Object.entries(tokenGroups)) {
    pattern.lastIndex = 0
    const count = [...relative.matchAll(pattern)].length
    if (count > 0) {
      const key = `${relative}\0${category}`
      counts.set(key, (counts.get(key) ?? 0) + count)
    }
  }
}

function relativePath(repo, absolutePath) {
  return path.relative(repo.root, absolutePath).split(path.sep).join('/')
}

function entryKey(entry) {
  return `${entry.repo}\0${entry.file}\0${entry.category}`
}
