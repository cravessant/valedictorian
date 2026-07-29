import path from 'node:path'

import { findSourceExecutionOwnershipViolations } from './source-execution-ownership-rules.mjs'

/**
 * Runs the source-execution write-ownership proof over a repository (issue #491).
 *
 * Kept in the single lint path beside the architecture check, which models imports
 * only. What each rule decides, and why the parser rather than the text answers it,
 * is described in source-execution-ownership-rules.mjs.
 */

/** @returns {string} */
function readRootArgument() {
  const index = process.argv.indexOf('--root')
  if (index === -1) return process.cwd()
  const root = process.argv[index + 1]
  if (!root) throw new Error('--root requires a path')
  return path.resolve(root)
}

const { scanned, violations } = findSourceExecutionOwnershipViolations(readRootArgument())
for (const violation of violations) process.stderr.write(`${violation}\n`)
if (violations.length > 0) {
  process.exitCode = 1
} else {
  process.stdout.write(
    `source-execution write ownership: ${scanned} connectors production file(s), 0 violation(s)\n`,
  )
}
