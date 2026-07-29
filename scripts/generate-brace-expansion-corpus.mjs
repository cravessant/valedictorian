import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const CORPUS_PATH = 'scripts/brace-expansion-corpus.json'

/**
 * Upstream ships its bash-comparison corpus as one blob of `pattern\n[result]...`
 * records joined by this marker, with a trailing marker acting as EOF.
 */
const BASH_RESULT_SEPARATOR = '><><><><'

/**
 * Bash cannot express the `${...}` literal cases, so upstream keeps them in
 * test/dollar.js instead of the bash corpus. The published lines deliberately
 * disagree here — 1.x returns the whole remaining string literally once it sees
 * a `$`-prefixed group, 2.x keeps expanding the tail — so these patterns are
 * recorded per line, with a null bash oracle, and only compared against the
 * line that recorded them.
 */
export const SUPPLEMENTAL_PATTERNS = Object.freeze([
  '${1..3}',
  '${a,b}${c,d}',
  'x${a,b}x',
  '${a,b}${c,d}{e,f}',
  '{a,b}${c,d}${e,f}',
  '${a,b}${c,d}{1..3}',
  'a${b}c',
  'x{{a,b}}y',
  '{01..5}',
  '{1..10..2}',
  '{10..1..-2}',
  '{a..e..2}',
  '{-1..-5}',
  '{Z..a}',
  '{a,b}{c,d}{e,f}',
])

/**
 * @param {string} bashResults contents of upstream test/bash-results.txt
 * @returns {Array<{ pattern: string, expansions: string[] }>}
 */
export function parseBashResults(bashResults) {
  const records = bashResults.split(BASH_RESULT_SEPARATOR)
  records.pop()
  return records.map((record) => {
    const lines = record.split('\n')
    const pattern = /** @type {string} */ (lines.shift())
    // Bash has no empty list, so upstream brackets each result to keep a lone
    // '' distinguishable from "expanded to nothing".
    const expansions =
      lines.length === 1 && lines[0] === ''
        ? []
        : lines.map((line) => line.replace(/^\[|\]$/g, ''))
    return { pattern, expansions }
  })
}

/**
 * @param {string} packageDir a pristine (unpatched) brace-expansion checkout
 * @param {string[]} patterns
 * @returns {string[][]}
 */
export function expandAll(packageDir, patterns) {
  const require = createRequire(path.join(path.resolve(packageDir), 'index.js'))
  const expand = require(path.join(path.resolve(packageDir), 'index.js'))
  return patterns.map((pattern) => expand(pattern))
}

/**
 * @param {{ bashResultsPath: string, sources: Record<string, string> }} options
 * @returns {{ patterns: string[], bash: (string[] | null)[], expected: Record<string, string[][]> }}
 */
export function buildCorpus(options) {
  const records = parseBashResults(fs.readFileSync(options.bashResultsPath, 'utf8'))
  const patterns = [...records.map((record) => record.pattern), ...SUPPLEMENTAL_PATTERNS]
  /** @type {Record<string, string[][]>} */
  const expected = {}
  for (const [version, packageDir] of Object.entries(options.sources)) {
    expected[version] = expandAll(packageDir, patterns)
  }
  return {
    patterns,
    bash: [...records.map((record) => record.expansions), ...SUPPLEMENTAL_PATTERNS.map(() => null)],
    expected,
  }
}

/** @returns {void} */
function run() {
  const args = process.argv.slice(2)
  const valueOf = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  const bashResultsPath = valueOf('--bash-results')
  const sources = {}
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--source') continue
    const [version, packageDir] = (args[index + 1] ?? '').split('=')
    if (!version || !packageDir) {
      process.stderr.write('Usage: --source <version>=<pristine package dir>\n')
      process.exitCode = 1
      return
    }
    sources[version] = packageDir
  }

  if (!bashResultsPath || Object.keys(sources).length === 0) {
    process.stderr.write(
      'Usage: node scripts/generate-brace-expansion-corpus.mjs --bash-results <file> --source <version>=<dir> ...\n',
    )
    process.exitCode = 1
    return
  }

  const corpus = buildCorpus({ bashResultsPath, sources })
  fs.writeFileSync(path.resolve(CORPUS_PATH), `${JSON.stringify(corpus, null, 2)}\n`)
  process.stdout.write(`Wrote ${corpus.patterns.length} patterns to ${CORPUS_PATH}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
