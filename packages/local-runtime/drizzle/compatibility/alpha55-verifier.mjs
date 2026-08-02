import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { pgTable, text } from 'drizzle-orm/pg-core'

const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
})
const captures = pgTable('captures', {
  id: text('id').primaryKey(),
})
const workspaceSecrets = pgTable('workspace_secrets', {
  encryptedValue: text('encrypted_value').notNull(),
  key: text('key').primaryKey(),
  kind: text('kind').notNull(),
})

const workspaceRoot = process.argv[2]
if (!workspaceRoot) throw new Error('alpha.55 verifier requires a restored workspace root')
const manifest = JSON.parse(fs.readFileSync(
  path.join(workspaceRoot, '.valedictorian', 'manifest.json'),
  'utf8',
))
if (manifest.workspaceVersion !== 1) {
  throw new Error('alpha.55 verifier only accepts workspace version 1')
}

const require = createRequire(import.meta.url)
const runtimeDirectory = path.dirname(require.resolve('@electric-sql/pglite'))
const client = new PGlite(
  path.join(workspaceRoot, '.valedictorian', 'pglite'),
  {
    fsBundle: new Blob([fs.readFileSync(path.join(runtimeDirectory, 'pglite.data'))]),
    initdbWasmModule: await WebAssembly.compile(
      fs.readFileSync(path.join(runtimeDirectory, 'initdb.wasm')),
    ),
    pgliteWasmModule: await WebAssembly.compile(
      fs.readFileSync(path.join(runtimeDirectory, 'pglite.wasm')),
    ),
  },
)

try {
  const database = drizzle(client)
  const workspaceRows = await database.select({ id: workspaces.id }).from(workspaces)
  const captureRows = await database.select({ id: captures.id }).from(captures)
  const secretRows = await database.select({
    encryptedValue: workspaceSecrets.encryptedValue,
    key: workspaceSecrets.key,
    kind: workspaceSecrets.kind,
  }).from(workspaceSecrets)
  const logicalRecordCounts = {
    captures: captureRows.length,
    workspaceSecrets: secretRows.length,
    workspaces: workspaceRows.length,
  }
  const envelopes = secretRows
    .map((row) => ({ ...row }))
    .sort((left, right) => left.key.localeCompare(right.key))
  const secretEnvelopeDigest = sha256(canonicalJson(envelopes))
  const inspection = {
    logicalRecordCounts,
    requiredCapabilities: [
      'workspace.authority.transfer',
      'workspace.secrets.byokTransfer',
      'workspace.snapshot.export',
      'workspace.snapshot.import',
    ],
    revisionToken: sha256(canonicalJson({
      logicalRecordCounts,
      secretEnvelopeDigest,
      workspaceId: manifest.id,
    })),
    schemaVersion: 'workspace:1/drizzle:7',
    secretEnvelopeCount: envelopes.length,
    secretEnvelopeDigest,
    workspaceId: manifest.id,
  }
  process.stdout.write(`${JSON.stringify(inspection)}\n`)
} finally {
  await client.close()
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort((left, right) => left.localeCompare(right)).map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
