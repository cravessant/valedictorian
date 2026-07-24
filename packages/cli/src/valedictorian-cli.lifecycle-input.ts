import type { RawFlags } from './valedictorian-cli.command-runtime.js'
import { optionValue } from './valedictorian-cli.command-runtime.js'
import { CliUsageError } from './valedictorian-cli.failures.js'
import {
  parseStrictJsonArray,
  parseStrictJsonObject,
  parseStrictJsonValue,
  readRequiredText,
} from './valedictorian-cli.parser-options.js'

type ContractSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

export function parseContractInput<T>(
  flags: RawFlags,
  schema: ContractSchema<T>,
  options: {
    id?: readonly [string, string]
    ids?: readonly (readonly [string, string])[]
    optional?: boolean
    workspaceId?: string
  } = {},
): T {
  const inputJson = optionValue(flags, 'input-json')
  const input = inputJson === undefined
    ? options.optional === true
      ? {}
      : missingInput()
    : parseStrictJsonObject(inputJson, '--input-json')

  const identities = options.ids ?? (options.id ? [options.id] : [])
  for (const [field, value] of identities) {
    rejectEmbeddedIdentity(input, field)
    input[field] = value
  }
  if (options.workspaceId) {
    rejectEmbeddedIdentity(input, 'workspaceId')
    input.workspaceId = options.workspaceId
  }
  return validateContract(schema, input)
}

export function parseRemovalInput<T>(
  flags: RawFlags,
  schema: ContractSchema<T>,
  id: string,
): T {
  return validateContract(schema, {
    id,
    choice: requiredFlag(flags, 'choice'),
    actor: parseActor(flags),
    rationale: requiredFlag(flags, 'rationale'),
  })
}

export function parseRestoreInput<T>(
  flags: RawFlags,
  schema: ContractSchema<T>,
  id: string,
): T {
  return validateContract(schema, {
    id,
    actor: parseActor(flags),
    rationale: requiredFlag(flags, 'rationale'),
  })
}

export function parsePromotionInput<T>(
  flags: RawFlags,
  schema: ContractSchema<T>,
  identity: readonly [string, string],
): T {
  const input = parseStrictJsonObject(requiredFlag(flags, 'input-json'), '--input-json')
  rejectEmbeddedIdentity(input, identity[0])
  input[identity[0]] = identity[1]

  const idempotencyKey = optionValue(flags, 'idempotency-key')
  if (idempotencyKey !== undefined) input.idempotencyKey = readRequiredText(idempotencyKey, '--idempotency-key')

  applyOverrideFlags(input, flags)
  applyDuplicateFlags(input, flags)
  return validateContract(schema, input)
}

export function parseCaptureCreateInput<T>(flags: RawFlags, schema: ContractSchema<T>): T {
  const payloadJson = optionValue(flags, 'payload-json')
  const evidenceJson = optionValue(flags, 'evidence-json')
  const providerRecordId = optionValue(flags, 'provider-record-id')
  const providerSchema = optionValue(flags, 'provider-schema')

  return validateContract(schema, {
    evidenceMode: requiredFlag(flags, 'evidence-mode'),
    adapter: {
      id: requiredFlag(flags, 'adapter-id'),
      kind: requiredFlag(flags, 'adapter-kind'),
      version: requiredFlag(flags, 'adapter-version'),
    },
    observedAt: requiredFlag(flags, 'observed-at'),
    providerRecordId: providerRecordId ?? null,
    providerSchema: providerSchema ?? null,
    payload: payloadJson === undefined ? null : parseStrictJsonValue(payloadJson, '--payload-json'),
    evidence: evidenceJson === undefined ? [] : parseStrictJsonArray(evidenceJson, '--evidence-json'),
  })
}

export const inputJsonFlags = ['input-json', 'workspace']
export const listInputFlags = ['input-json', 'workspace']
export const historyInputFlags = ['input-json', 'workspace']
export const removalRequiredFlags = ['actor-id', 'actor-type', 'choice', 'rationale']
export const restoreRequiredFlags = ['actor-id', 'actor-type', 'rationale']
export const actorOptionalFlags = ['actor-display-name', 'workspace']
export const promotionOptionalFlags = [
  'duplicate-action',
  'duplicate-target-id',
  'idempotency-key',
  'override-actor-display-name',
  'override-actor-id',
  'override-actor-type',
  'override-rationale',
  'override-warning-codes-json',
  'workspace',
]

function parseActor(flags: RawFlags) {
  const displayName = optionValue(flags, 'actor-display-name')
  return {
    id: requiredFlag(flags, 'actor-id'),
    type: requiredFlag(flags, 'actor-type'),
    ...(displayName === undefined ? {} : { displayName }),
  }
}

function applyOverrideFlags(input: Record<string, unknown>, flags: RawFlags) {
  const displayName = optionValue(flags, 'override-actor-display-name')
  const values = [
    optionValue(flags, 'override-actor-id'),
    optionValue(flags, 'override-actor-type'),
    optionValue(flags, 'override-rationale'),
    optionValue(flags, 'override-warning-codes-json'),
  ]
  if (values.every((value) => value === undefined)) {
    if (displayName === undefined) return
    const existingOverride = asRecord(input.override)
    const existingActor = asRecord(existingOverride?.actor)
    if (!existingOverride || !existingActor) {
      throw new CliUsageError('Override flags require actor id/type, rationale, and warning codes')
    }
    input.override = {
      ...existingOverride,
      actor: { ...existingActor, displayName },
    }
    return
  }
  if (values.some((value) => value === undefined)) {
    throw new CliUsageError('Override flags require actor id/type, rationale, and warning codes')
  }
  input.override = {
    actor: {
      id: values[0],
      type: values[1],
      ...(displayName === undefined ? {} : { displayName }),
    },
    rationale: values[2],
    warningCodes: parseStrictJsonArray(String(values[3]), '--override-warning-codes-json'),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function applyDuplicateFlags(input: Record<string, unknown>, flags: RawFlags) {
  const action = optionValue(flags, 'duplicate-action')
  const targetResourceId = optionValue(flags, 'duplicate-target-id')
  if (action === undefined && targetResourceId === undefined) return
  if (action === undefined || targetResourceId === undefined) {
    throw new CliUsageError('Duplicate resolution requires --duplicate-action and --duplicate-target-id')
  }
  input.duplicateResolution = { action, targetResourceId }
}

function validateContract<T>(schema: ContractSchema<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new CliUsageError('Input does not match the sparxie lifecycle contract')
}

function requiredFlag(flags: RawFlags, name: string): string {
  return readRequiredText(optionValue(flags, name), `--${name}`)
}

function missingInput(): never {
  throw new CliUsageError('--input-json is required')
}

function rejectEmbeddedIdentity(input: Record<string, unknown>, field: string) {
  if (Object.prototype.hasOwnProperty.call(input, field)) {
    throw new CliUsageError(`${field} is positional and must be omitted from --input-json`)
  }
}
