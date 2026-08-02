import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Regenerates the local-runtime package's baseline from its canonical schema.
 *
 * There is one journal entry by design: no installation has ever run an earlier
 * one, so the baseline is regenerated in place rather than amended. Drizzle Kit
 * decides the entry index from the package's drizzle/meta, so the previous artifacts are removed
 * before generating; an existing local development database cannot be carried
 * across a regeneration and must be deleted.
 *
 * Drizzle Kit 0.31 has no trigger or function primitive, so the retained
 * safeguards in packages/local-runtime/src/db/baseline-triggers.sql are appended verbatim to the
 * generated baseline. Everything above that boundary is generator output.
 */
export const BASELINE_TAG = '0000_pglite_operational_baseline'
export const TRIGGER_SOURCE_PATH = 'packages/local-runtime/src/db/baseline-triggers.sql'
export const DRIZZLE_DIRECTORY_PATH = 'packages/local-runtime/drizzle'
const STATEMENT_BREAKPOINT = '--> statement-breakpoint'

export function composeBaseline(generatedSql: string, triggerSql: string) {
  return `${generatedSql.trimEnd()}\n${STATEMENT_BREAKPOINT}\n${triggerSql.trimEnd()}\n`
}

function run(repoRoot: string) {
  const drizzleDir = path.join(repoRoot, DRIZZLE_DIRECTORY_PATH)
  for (const entry of fs.readdirSync(drizzleDir)) {
    if (entry.endsWith('.sql')) fs.rmSync(path.join(drizzleDir, entry))
  }
  fs.rmSync(path.join(drizzleDir, 'meta'), { force: true, recursive: true })

  execFileSync(
    'pnpm',
    ['exec', 'drizzle-kit', 'generate', `--name=${BASELINE_TAG.slice('0000_'.length)}`],
    { cwd: repoRoot, stdio: 'inherit' },
  )

  const journalPath = path.join(drizzleDir, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: Array<{ tag: string }> }
  if (journal.entries.length !== 1 || journal.entries[0]?.tag !== BASELINE_TAG) {
    throw new Error(
      `Expected exactly one journal entry tagged ${BASELINE_TAG}, found ${JSON.stringify(journal.entries)}`,
    )
  }

  const baselinePath = path.join(drizzleDir, `${BASELINE_TAG}.sql`)
  fs.writeFileSync(baselinePath, composeBaseline(
    fs.readFileSync(baselinePath, 'utf8'),
    fs.readFileSync(path.join(repoRoot, TRIGGER_SOURCE_PATH), 'utf8'),
  ))
  process.stdout.write(
    `Appended ${TRIGGER_SOURCE_PATH} to ${DRIZZLE_DIRECTORY_PATH}/${BASELINE_TAG}.sql\n`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  run(path.resolve(import.meta.dirname, '..'))
}
