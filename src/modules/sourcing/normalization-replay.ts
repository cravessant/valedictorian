import crypto from 'node:crypto'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type {
  CanonicalCandidateField,
  CompletedRawSourceReplayItem,
  JsonValue,
  RawSourceFieldDirective,
  RawSourceReplayFailure,
  RawSourceReplayItem,
  RawSourceReplayReceipt,
  ReplayRawSourceRecordsInput,
} from 'sparxie'
import { canonicalCandidateFields } from 'sparxie'
import {
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationReplayItems,
  normalizationReplayRequests,
  normalizationRuns,
  captures,
  captureEvidenceVersions,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  CANONICAL_CANDIDATE_SCHEMA_VERSION,
  createNormalizationOrchestrator,
  isValidCanonicalFieldValue,
  NORMALIZATION_GATE_POLICY_VERSION,
} from './normalization.orchestrator'
import { hashJson, type NormalizationResolverRegistry } from './normalization.registry'

export function createNormalizationReplayService(options: {
  database: DrizzleDatabase
  orchestrator: ReturnType<typeof createNormalizationOrchestrator>
  registry: NormalizationResolverRegistry
  now?: () => Date
  onNormalized?: (result: Awaited<ReturnType<ReturnType<typeof createNormalizationOrchestrator>['normalize']>>) => Promise<unknown>
}) {
  const now = options.now ?? (() => new Date())

  async function replayWithId(
    input: ReplayRawSourceRecordsInput,
    replayId: string,
    validateInput: boolean,
  ): Promise<RawSourceReplayReceipt> {
    if (validateInput) validateReplayInput(input)
    validateTargetVersions(input, options.registry)
    const matches = selectMatches(options.database, input)
    initializeReplay(options.database, { input, matches, replayId, acceptedAt: now().toISOString() })
    const existing = options.database.select({ status: normalizationReplayRequests.status })
      .from(normalizationReplayRequests)
      .where(eq(normalizationReplayRequests.id, replayId)).get()
    if (existing?.status === 'completed' || existing?.status === 'completed_with_failures') {
      return readReplayReceipt(options.database, replayId)
    }
    options.database.update(normalizationReplayRequests).set({ status: 'in_progress' })
      .where(eq(normalizationReplayRequests.id, replayId)).run()

    const pending = options.database.select().from(normalizationReplayItems)
      .where(and(
        eq(normalizationReplayItems.replayId, replayId),
        eq(normalizationReplayItems.status, 'pending'),
      ))
      .orderBy(asc(normalizationReplayItems.sequence)).all()
    for (const match of pending) {
      if (settleReplayItemFromPersistedRun(options.database, replayId, match.id, match.captureEvidenceVersionId, now)) {
        continue
      }
      try {
        const effectiveDirectives = selectEffectiveDirectives(
          options.database,
          match.captureEvidenceVersionId,
        )
        const result = await options.orchestrator.normalize(match.captureLineageId, match.captureEvidenceVersionId, {
          kind: 'replay', replayId, fieldDirectives: effectiveDirectives,
          targetResolverVersions: input.targetVersions?.resolvers ?? [],
        })
        await options.onNormalized?.(result)
        const run = options.database.select({ id: normalizationRuns.id }).from(normalizationRuns)
          .where(and(
            eq(normalizationRuns.captureEvidenceVersionId, match.captureEvidenceVersionId),
            eq(normalizationRuns.triggerId, replayId),
          )).get()
        const resultFailed = result.status === 'failed'
        const failure: RawSourceReplayFailure | null = resultFailed
          ? { code: 'normalization_failed', retryable: false }
          : null
        const completedAt = now().toISOString()
        options.database.update(normalizationReplayItems).set({
          status: resultFailed ? 'failed' : 'completed', normalizationRunId: run?.id ?? null,
          failureJson: failure ? JSON.stringify(failure) : null,
          completedAt,
        }).where(and(
          eq(normalizationReplayItems.replayId, replayId),
          eq(normalizationReplayItems.captureEvidenceVersionId, match.captureEvidenceVersionId),
        )).run()
      } catch (error) {
        const failure = classifyReplayFailure(error)
        const completedAt = now().toISOString()
        options.database.update(normalizationReplayItems).set({
          status: 'failed',
          failureJson: JSON.stringify(failure),
          completedAt,
        }).where(and(
          eq(normalizationReplayItems.replayId, replayId),
          eq(normalizationReplayItems.captureEvidenceVersionId, match.captureEvidenceVersionId),
        )).run()
      }
    }

    const failed = options.database.select({ id: normalizationReplayItems.id })
      .from(normalizationReplayItems)
      .where(and(
        eq(normalizationReplayItems.replayId, replayId),
        eq(normalizationReplayItems.status, 'failed'),
      )).get()
    options.database.update(normalizationReplayRequests).set({
      status: failed ? 'completed_with_failures' : 'completed',
      completedAt: now().toISOString(),
    }).where(eq(normalizationReplayRequests.id, replayId)).run()
    return readReplayReceipt(options.database, replayId)
  }

  return {
    replay(input: ReplayRawSourceRecordsInput) {
      return replayWithId(input, crypto.randomUUID(), true)
    },
    replayConnectorUpgrade(input: {
      connectorInstanceId: string
      fromConnectorVersion: string
      instanceUpdatedAt: string
      toConnectorVersion: string
    }) {
      const rawRevisionIds = currentConnectorRawRevisionIds(
        options.database,
        input.connectorInstanceId,
      )
      const replayId = connectorUpgradeReplayId(input)
      return replayWithId({
        selector: { rawRevisionIds },
        invalidate: {},
      }, replayId, false)
    },
  }
}

function settleReplayItemFromPersistedRun(
  database: DrizzleDatabase,
  replayId: string,
  replayItemId: string,
  rawRevisionId: string,
  now: () => Date,
) {
  const run = database.select({ id: normalizationRuns.id, status: normalizationRuns.status })
    .from(normalizationRuns)
    .where(and(
      eq(normalizationRuns.triggerId, replayId),
      eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId),
    ))
    .orderBy(desc(normalizationRuns.createdAt), desc(normalizationRuns.id)).get()
  if (!run || !['completed', 'blocked', 'failed'].includes(run.status)) return false
  const failed = run.status === 'failed'
  database.update(normalizationReplayItems).set({
    status: failed ? 'failed' : 'completed',
    normalizationRunId: run.id,
    failureJson: failed
      ? JSON.stringify({ code: 'normalization_failed', retryable: false })
      : null,
    completedAt: now().toISOString(),
  }).where(eq(normalizationReplayItems.id, replayItemId)).run()
  return true
}

function initializeReplay(
  database: DrizzleDatabase,
  input: {
    acceptedAt: string
    input: ReplayRawSourceRecordsInput
    matches: ReturnType<typeof selectMatches>
    replayId: string
  },
) {
  database.transaction((transaction) => {
    const inserted = transaction.insert(normalizationReplayRequests).values({
      id: input.replayId,
      selectorJson: JSON.stringify(input.input.selector),
      invalidationJson: JSON.stringify(input.input.invalidate),
      targetVersionsJson: input.input.targetVersions
        ? JSON.stringify(input.input.targetVersions)
        : null,
      fieldDirectivesJson: JSON.stringify(input.input.fieldDirectives ?? []),
      status: input.matches.length ? 'in_progress' : 'accepted',
      acceptedAt: input.acceptedAt,
      completedAt: null,
    }).onConflictDoNothing().run()
    if (inserted.changes === 0) return
    input.matches.forEach((match, sequence) => {
      transaction.insert(normalizationReplayItems).values({
        id: crypto.randomUUID(), replayId: input.replayId, captureLineageId: match.rawRecordId,
        captureEvidenceVersionId: match.rawRevisionId, inputHash: match.inputHash,
        sequence, status: 'pending', normalizationRunId: null,
        failureJson: null, completedAt: null,
      }).run()
    })
  })
}

function readReplayReceipt(database: DrizzleDatabase, replayId: string): RawSourceReplayReceipt {
  const request = database.select().from(normalizationReplayRequests)
    .where(eq(normalizationReplayRequests.id, replayId)).get()
  if (!request) throw new Error(`Normalization replay request not found: ${replayId}`)
  const persistedItems = database.select().from(normalizationReplayItems)
    .where(eq(normalizationReplayItems.replayId, replayId))
    .orderBy(asc(normalizationReplayItems.sequence)).all()
  const items = persistedItems.flatMap((item): RawSourceReplayItem[] => {
    if (item.status === 'pending') return []
    const run = item.normalizationRunId ? { normalizationRunId: item.normalizationRunId } : {}
    if (item.status === 'completed') return [{
      status: 'completed', rawRecordId: item.captureLineageId,
      rawRevisionId: item.captureEvidenceVersionId, ...run,
    }]
    return [{
      status: 'failed', rawRecordId: item.captureLineageId, rawRevisionId: item.captureEvidenceVersionId,
      ...run,
      failure: item.failureJson
        ? JSON.parse(item.failureJson) as RawSourceReplayFailure
        : { code: 'internal_error', retryable: false },
    }]
  })
  if (!request.completedAt) throw new Error(`Normalization replay request is incomplete: ${replayId}`)
  const receipt = {
    replayId,
    acceptedAt: request.acceptedAt,
    completedAt: request.completedAt,
    matchedRawRevisionIds: persistedItems.map(({ captureEvidenceVersionId }) => captureEvidenceVersionId),
  }
  if (request.status === 'completed_with_failures') {
    return { ...receipt, status: 'completed_with_failures', items }
  }
  if (request.status === 'completed') {
    return {
      ...receipt,
      status: 'completed',
      items: items.filter((item): item is CompletedRawSourceReplayItem => item.status === 'completed'),
    }
  }
  throw new Error(`Normalization replay request has invalid terminal status: ${request.status}`)
}

function currentConnectorRawRevisionIds(database: DrizzleDatabase, connectorInstanceId: string) {
  const rawRecordIds = new Set(database.select({ rawRecordId: captures.captureLineageId })
    .from(captures)
    .where(eq(captures.connectorInstanceId, connectorInstanceId))
    .all().map(({ rawRecordId }) => rawRecordId))
  const current = new Map<string, { id: string; revision: number }>()
  for (const revision of database.select({
    id: captureEvidenceVersions.id,
    rawRecordId: captureEvidenceVersions.captureLineageId,
    revision: captureEvidenceVersions.revision,
  }).from(captureEvidenceVersions).orderBy(asc(captureEvidenceVersions.createdAt), asc(captureEvidenceVersions.id)).all()) {
    if (!rawRecordIds.has(revision.rawRecordId)) continue
    const prior = current.get(revision.rawRecordId)
    if (!prior || revision.revision > prior.revision) current.set(revision.rawRecordId, revision)
  }
  return [...current.values()].map(({ id }) => id)
}

function connectorUpgradeReplayId(input: {
  connectorInstanceId: string
  fromConnectorVersion: string
  instanceUpdatedAt: string
  toConnectorVersion: string
}) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return `connector-upgrade:${digest}`
}

function classifyReplayFailure(error: unknown): RawSourceReplayFailure {
  if (isRecord(error) && typeof error.code === 'string' && error.code.startsWith('SQLITE_')) {
    return {
      code: 'persistence_failed',
      retryable: error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED',
    }
  }
  return { code: 'internal_error', retryable: false }
}

function validateReplayInput(input: unknown): asserts input is ReplayRawSourceRecordsInput {
  if (!isRecord(input) || !hasOnlyKeys(input, ['selector', 'invalidate', 'targetVersions', 'fieldDirectives'])) throw invalidReplay('Invalid replay request')
  if (!isRecord(input.selector) || !hasOnlyKeys(input.selector, ['rawRecordIds', 'rawRevisionIds', 'inputHashes'])) throw invalidReplay('Invalid replay selector')
  const selector = input.selector
  const selectors = ['rawRecordIds', 'rawRevisionIds', 'inputHashes'] as const
  if (!selectors.some((key) => {
    const value = selector[key]
    return Array.isArray(value) && value.length > 0
  })) throw invalidReplay('Replay selector must not be empty')
  for (const key of selectors) validateStringArray(selector[key], `Invalid replay selector ${key}`)
  if (Array.isArray(selector.inputHashes) && selector.inputHashes.some((hash) => !isInputHash(hash))) throw invalidReplay('Invalid replay selector input hash')

  if (!isRecord(input.invalidate) || !hasOnlyKeys(input.invalidate, ['resolverVersions', 'canonicalSchemaVersions', 'gatePolicyVersions'])) throw invalidReplay('Invalid replay invalidation')
  validateVersionRefs(input.invalidate.resolverVersions, 'Invalid resolver invalidation')
  validateStringArray(input.invalidate.canonicalSchemaVersions, 'Invalid canonical schema invalidation')
  validateStringArray(input.invalidate.gatePolicyVersions, 'Invalid gate policy invalidation')

  if (input.targetVersions !== undefined) {
    if (!isRecord(input.targetVersions) || !hasOnlyKeys(input.targetVersions, ['resolvers', 'canonicalSchemaVersion', 'gatePolicyVersion'])) throw invalidReplay('Invalid replay target versions')
    validateVersionRefs(input.targetVersions.resolvers, 'Invalid target resolver version')
    for (const key of ['canonicalSchemaVersion', 'gatePolicyVersion'] as const) {
      if (input.targetVersions[key] !== undefined && !isNonblankString(input.targetVersions[key])) throw invalidReplay(`Invalid target ${key}`)
    }
  }

  if (input.fieldDirectives !== undefined) {
    if (!Array.isArray(input.fieldDirectives)) throw invalidReplay('Invalid field directives')
    const fields = new Set<string>()
    for (const directive of input.fieldDirectives) {
      if (!isRecord(directive) || !['lock', 'suppress'].includes(String(directive.action))) throw invalidReplay('Invalid field directive')
      const allowed = directive.action === 'lock'
        ? ['action', 'field', 'value', 'reason', 'inputHash', 'policyVersion']
        : ['action', 'field', 'reason', 'inputHash', 'policyVersion']
      if (!hasOnlyKeys(directive, allowed)
        || !canonicalCandidateFields.includes(directive.field as CanonicalCandidateField)
        || !isNonblankString(directive.reason)
        || !isNonblankString(directive.policyVersion)
        || !isInputHash(directive.inputHash)
        || fields.has(String(directive.field))) throw invalidReplay('Invalid field directive')
      fields.add(String(directive.field))
      if (directive.action === 'lock' && !isValidCanonicalFieldValue(
        directive.field as CanonicalCandidateField,
        directive.value as JsonValue,
      )) throw invalidReplay(`Invalid locked value for ${String(directive.field)}`)
    }
  }
}

function validateStringArray(value: unknown, message: string) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !isNonblankString(item)) || new Set(value).size !== value.length) throw invalidReplay(message)
}

function validateVersionRefs(value: unknown, message: string) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0) throw invalidReplay(message)
  const identities = new Set<string>()
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['resolverId', 'version']) || !isNonblankString(item.resolverId) || !isNonblankString(item.version)) throw invalidReplay(message)
    const identity = `${item.resolverId}@${item.version}`
    if (identities.has(identity)) throw invalidReplay(message)
    identities.add(identity)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}
function isNonblankString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}
function isInputHash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

function selectEffectiveDirectives(database: DrizzleDatabase, rawRevisionId: string) {
  const requests = database.select({
    id: normalizationReplayRequests.id,
    acceptedAt: normalizationReplayRequests.acceptedAt,
    directivesJson: normalizationReplayRequests.fieldDirectivesJson,
  }).from(normalizationReplayItems)
    .innerJoin(normalizationReplayRequests, eq(normalizationReplayRequests.id, normalizationReplayItems.replayId))
    .where(eq(normalizationReplayItems.captureEvidenceVersionId, rawRevisionId))
    .orderBy(
      asc(normalizationReplayRequests.acceptedAt),
      sql`${normalizationReplayRequests}.rowid asc`,
    ).all()
  const byField = new Map<string, RawSourceFieldDirective>()
  for (const request of requests) {
    for (const directive of JSON.parse(request.directivesJson) as RawSourceFieldDirective[]) {
      byField.set(directive.field, directive)
    }
  }
  return [...byField.values()]
}

function selectMatches(database: DrizzleDatabase, input: ReplayRawSourceRecordsInput) {
  const revisions = database.select({
    rawRecordId: captureEvidenceVersions.captureLineageId,
    rawRevisionId: captureEvidenceVersions.id,
    contentHash: captureEvidenceVersions.contentHash,
  }).from(captureEvidenceVersions).orderBy(asc(captureEvidenceVersions.createdAt), asc(captureEvidenceVersions.id)).all()
  const rawRecordIds = input.selector.rawRecordIds ? new Set(input.selector.rawRecordIds) : null
  const rawRevisionIds = input.selector.rawRevisionIds ? new Set(input.selector.rawRevisionIds) : null
  const inputHashes = input.selector.inputHashes ? new Set(input.selector.inputHashes) : null

  return revisions.flatMap((revision) => {
    if (rawRecordIds && !rawRecordIds.has(revision.rawRecordId)) return []
    if (rawRevisionIds && !rawRevisionIds.has(revision.rawRevisionId)) return []
    const runs = database.select().from(normalizationRuns)
      .where(eq(normalizationRuns.captureEvidenceVersionId, revision.rawRevisionId)).all()
    if (inputHashes && !matchesInputHash(database, runs, inputHashes)) return []
    if (!matchesInvalidation(database, runs, input.invalidate)) return []
    return [{
      rawRecordId: revision.rawRecordId,
      rawRevisionId: revision.rawRevisionId,
      inputHash: hashJson({ rawRevisionId: revision.rawRevisionId, contentHash: revision.contentHash }),
    }]
  })
}

function matchesInputHash(
  database: DrizzleDatabase,
  runs: Array<typeof normalizationRuns.$inferSelect>,
  inputHashes: ReadonlySet<string>,
) {
  if (runs.some(({ inputHash }) => inputHashes.has(inputHash))) return true
  if (!runs.length) return false
  const runIds = runs.map(({ id }) => id)
  if (database.select({ inputHash: normalizationAttempts.inputHash }).from(normalizationAttempts)
    .where(inArray(normalizationAttempts.runId, runIds)).all()
    .some(({ inputHash }) => inputHashes.has(inputHash))) return true
  return database.select({ inputHash: normalizationFieldOutcomes.inputHash })
    .from(normalizationFieldOutcomes)
    .where(inArray(normalizationFieldOutcomes.runId, runIds)).all()
    .some(({ inputHash }) => inputHashes.has(inputHash))
}

function matchesInvalidation(
  database: DrizzleDatabase,
  runs: Array<typeof normalizationRuns.$inferSelect>,
  invalidation: ReplayRawSourceRecordsInput['invalidate'],
) {
  const hasInvalidation = Boolean(
    invalidation.resolverVersions?.length
    || invalidation.canonicalSchemaVersions?.length
    || invalidation.gatePolicyVersions?.length,
  )
  if (!hasInvalidation) return true
  if (invalidation.canonicalSchemaVersions?.some((version) => runs.some((run) => run.canonicalSchemaVersion === version))) return true
  if (invalidation.gatePolicyVersions?.some((version) => runs.some((run) => run.gatePolicyVersion === version))) return true
  if (invalidation.resolverVersions?.length && runs.length) {
    const attempts = database.select({
      resolverId: normalizationAttempts.resolverId,
      resolverVersion: normalizationAttempts.resolverVersion,
    }).from(normalizationAttempts).where(inArray(normalizationAttempts.runId, runs.map(({ id }) => id))).all()
    if (invalidation.resolverVersions.some((version) => attempts.some((attempt) =>
      attempt.resolverId === version.resolverId && attempt.resolverVersion === version.version,
    ))) return true
  }
  return false
}

function validateTargetVersions(input: ReplayRawSourceRecordsInput, registry: NormalizationResolverRegistry) {
  if (input.targetVersions?.canonicalSchemaVersion
    && input.targetVersions.canonicalSchemaVersion !== CANONICAL_CANDIDATE_SCHEMA_VERSION) {
    throw invalidReplay('Unsupported target canonical schema version')
  }
  if (input.targetVersions?.gatePolicyVersion
    && input.targetVersions.gatePolicyVersion !== NORMALIZATION_GATE_POLICY_VERSION) {
    throw invalidReplay('Unsupported target gate policy version')
  }
  const targetedResolverIds = new Set<string>()
  for (const target of input.targetVersions?.resolvers ?? []) {
    if (targetedResolverIds.has(target.resolverId)) {
      throw invalidReplay(`Duplicate target resolver id: ${target.resolverId}`)
    }
    targetedResolverIds.add(target.resolverId)
    if (!registry.resolvers.some(({ declaration }) =>
      declaration.id === target.resolverId && declaration.version === target.version,
    )) throw invalidReplay(`Unsupported target resolver version: ${target.resolverId}@${target.version}`)
  }
}

function invalidReplay(message: string) {
  return Object.assign(new Error(message), { code: 'invalid_request', statusCode: 400 })
}
