/**
 * One-time migration utility for #552.
 *
 * It snapshots Zod wire schemas from the exact released SDK into the producer
 * package. Normal generation consumes only the checked-in snapshot and never
 * reaches the SDK checkout or package at runtime.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'

const expectedCommit = 'aafd5ae1a4a92288032b880f6b7d299ada3e80a9'
const expectedVersion = '0.36.0'
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sdkCheckout = path.resolve(repositoryRoot, '../sparxie')
const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: sdkCheckout,
  encoding: 'utf8',
}).trim()
if (actualCommit !== expectedCommit) {
  throw new Error(`Expected SDK source ${expectedCommit}; found ${actualCommit}`)
}

const sdkManifestPath = path.resolve(
  fileURLToPath(import.meta.resolve('@sparxie/sdk')),
  '../../package.json',
)
const sdkManifest = JSON.parse(fs.readFileSync(sdkManifestPath, 'utf8'))
if (sdkManifest.version !== expectedVersion) {
  throw new Error(`Expected @sparxie/sdk ${expectedVersion}; found ${sdkManifest.version}`)
}

const sdkDist = path.join(path.dirname(sdkManifestPath), 'dist')
const moduleFiles = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(entryPath)
    else if (entry.name.endsWith('.js') && !entry.name.includes('.test.')) moduleFiles.push(entryPath)
  }
}
collect(sdkDist)

const schemas = {}
const inputSchemas = {}
for (const modulePath of moduleFiles.sort((left, right) => left.localeCompare(right))) {
  const exports = await import(pathToFileURL(modulePath).href)
  for (const [name, value] of Object.entries(exports)) {
    if (!name.endsWith('Schema') || !value || typeof value !== 'object' || !('safeParse' in value)) {
      continue
    }
    const schema = z.toJSONSchema(value, {
      io: 'output',
      target: 'openapi-3.0',
      unrepresentable: 'any',
    })
    delete schema.$schema
    const existing = schemas[name]
    if (!existing) schemas[name] = schema
    if (!inputSchemas[name]) {
      const inputSchema = z.toJSONSchema(value, {
        io: 'input',
        target: 'openapi-3.0',
        unrepresentable: 'any',
      })
      delete inputSchema.$schema
      inputSchemas[name] = inputSchema
    }
  }
}

const objectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})
const releasedSdk = await import('@sparxie/sdk')
for (const [schemaName, bodiesName] of [
  ['localSecretResolutionErrorBodySchema', 'localSecretResolutionErrorBodies'],
  ['connectorScheduleErrorBodySchema', 'connectorScheduleErrorBodies'],
  ['connectorCreateErrorBodySchema', 'connectorCreateErrorBodies'],
  ['connectorOptionQueryErrorBodySchema', 'connectorOptionQueryErrorBodies'],
]) {
  const bodies = Object.values(releasedSdk[bodiesName])
  schemas[schemaName] = {
    oneOf: bodies.map((body) => objectSchema({
      code: { const: body.code },
      message: { const: body.message },
    }, ['code', 'message'])),
  }
  inputSchemas[schemaName] = schemas[schemaName]
}
// The released query schema is a safe-plain-record pipe whose input and
// output structures are identical; Zod cannot emit the custom input stage.
inputSchemas.connectorOptionQueryBodySchema = schemas.connectorOptionQueryBodySchema
const nullable = (schema) => ({ oneOf: [schema, { type: 'null' }] })
const string = { type: 'string' }
const number = { type: 'number' }
const integer = { type: 'integer' }
const boolean = { type: 'boolean' }
const policyEvidenceTags = [
  'apply_cutoff_override', 'explicit_approval_required', 'explicit_user_approval',
  'final_review_verification_receipt', 'official_path_verified', 'high_risk_form',
  'high_risk_form_verified', 'profile_retry_completed', 'headed_profile_retry_completed',
  'second_pass_verified', 'yc_company', 'small_startup', 'pre_series_b',
  'requires_second_pass', 'do_not_submit',
]
const policySubjectTypes = ['application', 'opportunity', 'workflow_run', 'global']
const pursuitApplicationStatuses = [
  'interested', 'researching', 'ready_to_apply', 'applying', 'applied',
  'interviewing', 'offered', 'accepted', 'rejected', 'withdrawn', 'closed',
]
const runTypes = [
  'application_attempt', 'sourcing', 'merge', 'manual_review_pickup',
  'stale_lock_pickup', 'import',
]
const runStatuses = ['in_progress', 'completed', 'failed']
const actorTypes = ['agent', 'automation', 'user', 'system']

schemas.emptyObjectSchema = objectSchema({})
schemas.workspaceOpenInputSchema = objectSchema(
  { path: string, rekey: boolean },
  ['path'],
)
schemas.workspaceCreateInputSchema = schemas.workspaceOpenInputSchema
schemas.actionQueueListQuerySchema = objectSchema({
  actionBucket: {
    enum: [
      'apply_now', 'manual_review_pickup', 'needs_user_info', 'stale_lock_recovery',
      'user_review_required', 'blocked', 'skip_below_cutoff',
    ],
    type: 'string',
  },
  limit: integer,
  offset: integer,
})
schemas.scoreInputSchema = objectSchema({
  applicationId: string,
  band: string,
  careerSignal: number,
  cityWorkMode: number,
  compensationLogistics: number,
  penalties: { type: 'array', items: number },
  rationale: string,
  roleRelevance: number,
  rubricVersion: string,
  score: number,
}, [
  'applicationId', 'score', 'band', 'roleRelevance', 'careerSignal',
  'cityWorkMode', 'compensationLogistics', 'penalties', 'rationale', 'rubricVersion',
])
schemas.workflowRunsListInputSchema = objectSchema({
  limit: integer,
  offset: integer,
  runType: { type: 'string', enum: runTypes },
  source: string,
  sourceId: string,
  status: { type: 'string', enum: runStatuses },
  subjectApplicationId: string,
})
schemas.startWorkflowRunInputSchema = objectSchema({
  actorName: nullable(string),
  actorType: { type: 'string', enum: actorTypes },
  coverageEndedAt: nullable(string),
  coverageStartedAt: nullable(string),
  input: {},
  metadata: {},
  runType: { type: 'string', enum: runTypes },
  sourceId: nullable(string),
  sourceName: nullable(string),
  subjectApplicationId: nullable(string),
  summary: nullable(string),
  timezone: nullable(string),
}, ['runType', 'actorType'])
schemas.createWorkflowRunStepInputSchema = objectSchema({
  actor: string,
  message: string,
  payload: {},
  type: string,
  workflowRunId: string,
}, ['workflowRunId', 'type', 'message'])
schemas.completeWorkflowRunInputSchema = objectSchema({
  blocker: nullable(string),
  metadata: {},
  outcome: nullable({ type: 'string', enum: pursuitApplicationStatuses }),
  status: { type: 'string', enum: runStatuses },
  summary: nullable(string),
  workflowRunId: string,
}, ['workflowRunId'])
schemas.connectorCheckpointsListInputSchema = objectSchema({
  connectorInstanceId: string,
  filterSignature: string,
}, ['connectorInstanceId'])
schemas.connectorObservationsListInputSchema = objectSchema({
  connectorInstanceId: string,
  connectorRunId: string,
  limit: integer,
  offset: integer,
}, ['connectorInstanceId'])
schemas.policyEvidenceInputSchema = objectSchema({
  note: nullable(string),
  payload: {},
  source: string,
  subjectId: string,
  subjectType: { type: 'string', enum: policySubjectTypes },
  tag: { type: 'string', enum: policyEvidenceTags },
}, ['subjectType', 'subjectId', 'tag'])
schemas.policyEvidenceListInputSchema = objectSchema({
  limit: integer,
  offset: integer,
  subjectId: string,
  subjectType: { type: 'string', enum: policySubjectTypes },
  tag: { type: 'string', enum: policyEvidenceTags },
})
schemas.evaluateApplicationPolicyInputSchema = objectSchema({
  applicationId: string,
  attemptId: nullable(string),
  outcome: nullable({ type: 'string', enum: pursuitApplicationStatuses }),
}, ['applicationId'])
schemas.evaluateOpportunityPolicyInputSchema = objectSchema(
  { opportunityId: string },
  ['opportunityId'],
)
schemas.evaluateRunWindowPolicyInputSchema = objectSchema({
  now: nullable(string),
  previousRunCompletedAt: nullable(string),
  sourceId: nullable(string),
  sourceName: nullable(string),
  timezone: nullable(string),
})
function deepPartial(schema) {
  if (!schema || typeof schema !== 'object') return schema
  if (schema.type === 'object') {
    return {
      ...schema,
      properties: Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, value]) => [key, deepPartial(value)]),
      ),
      required: undefined,
    }
  }
  return schema
}
schemas.policyConfigPatchSchema = deepPartial(schemas.policyConfigSchema)
schemas.upsertProfileSecretInputSchema = objectSchema({
  key: string,
  kind: { type: 'string', enum: ['password', 'token', 'identity', 'other'] },
  label: string,
  value: string,
}, ['key', 'kind', 'label', 'value'])
schemas.workspaceReceiptLookupSchema = objectSchema({
  authorityEpoch: integer,
  idempotencyKey: string,
  operation: string,
  workspaceId: string,
}, ['workspaceId', 'authorityEpoch', 'operation', 'idempotencyKey'])
schemas.workspaceReceiptSchema = objectSchema({
  actor: string,
  authorityEpoch: integer,
  authorityId: string,
  evidenceDigests: { type: 'array', items: string },
  idempotencyKey: string,
  issuedAt: { type: 'string', format: 'date-time' },
  operation: string,
  outcome: {},
  requestFingerprint: string,
  revisionOrPhase: string,
  transferId: nullable(string),
  workspaceId: string,
}, [
  'actor', 'authorityEpoch', 'authorityId', 'evidenceDigests', 'idempotencyKey',
  'issuedAt', 'operation', 'outcome', 'requestFingerprint', 'revisionOrPhase',
  'transferId', 'workspaceId',
])

for (const [name, schema] of Object.entries(schemas)) {
  inputSchemas[name] ??= schema
}

const output = `${JSON.stringify({
  source: {
    commit: expectedCommit,
    package: '@sparxie/sdk',
    version: expectedVersion,
  },
  schemas: Object.fromEntries(
    Object.entries(schemas).sort(([left], [right]) => left.localeCompare(right)),
  ),
  inputSchemas: Object.fromEntries(
    Object.entries(inputSchemas).sort(([left], [right]) => left.localeCompare(right)),
  ),
}, null, 2)}\n`
const outputPath = path.join(
  repositoryRoot,
  'packages/workspace/server/src/released-sdk-schemas.json',
)
fs.writeFileSync(outputPath, output)
process.stdout.write(`Snapshotted ${Object.keys(schemas).length} released SDK schemas.\n`)
