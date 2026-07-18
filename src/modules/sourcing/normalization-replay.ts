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
import type { PgliteDatabase } from '../../db/pglite'
import {
  CANONICAL_CANDIDATE_SCHEMA_VERSION,
  createNormalizationOrchestrator,
  isValidCanonicalFieldValue,
  NORMALIZATION_GATE_POLICY_VERSION,
} from './normalization.orchestrator'
import { hashJson, type NormalizationResolverRegistry } from './normalization.registry'

const REPLAY_CLAIM_LEASE_MS = 30_000

export function createNormalizationReplayService(options: {
  database: PgliteDatabase
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
    const matches = await selectMatches(options.database, input)
    await initializeReplay(options.database, { input, matches, replayId, acceptedAt: now().toISOString() })
    const [existing] = await options.database.select({ status: normalizationReplayRequests.status })
      .from(normalizationReplayRequests)
      .where(eq(normalizationReplayRequests.id, replayId)).limit(1)
    if (existing?.status === 'completed' || existing?.status === 'completed_with_failures') {
      return await readReplayReceipt(options.database, replayId)
    }
    await options.database.update(normalizationReplayRequests).set({ status: 'in_progress' })
      .where(and(
        eq(normalizationReplayRequests.id, replayId),
        eq(normalizationReplayRequests.status, 'accepted'),
      ))

    const claimToken = crypto.randomUUID()
    while (true) {
      const match = await claimNextReplayItem(
        options.database,
        replayId,
        claimToken,
        now().toISOString(),
      )
      if (!match) {
        if (!await hasPendingReplayItems(options.database, replayId)) break
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        continue
      }
      if (await settleReplayItemFromPersistedRun(options.database, replayId, match.id, match.captureEvidenceVersionId, now)) {
        continue
      }
      try {
        const effectiveDirectives = await selectEffectiveDirectives(
          options.database,
          match.captureEvidenceVersionId,
        )
        const result = await options.orchestrator.normalize(match.captureLineageId, match.captureEvidenceVersionId, {
          kind: 'replay', replayId, fieldDirectives: effectiveDirectives,
          targetResolverVersions: input.targetVersions?.resolvers ?? [],
        })
        await options.onNormalized?.(result)
        const [run] = await options.database.select({ id: normalizationRuns.id }).from(normalizationRuns)
          .where(and(
            eq(normalizationRuns.captureEvidenceVersionId, match.captureEvidenceVersionId),
            eq(normalizationRuns.triggerId, replayId),
          )).orderBy(desc(normalizationRuns.createdAt), desc(normalizationRuns.id)).limit(1)
        const resultFailed = result.status === 'failed'
        const failure: RawSourceReplayFailure | null = resultFailed
          ? { code: 'normalization_failed', retryable: false }
          : null
        const completedAt = now().toISOString()
        await options.database.update(normalizationReplayItems).set({
          status: resultFailed ? 'failed' : 'completed', normalizationRunId: run?.id ?? null,
          failureJson: failure ? JSON.stringify(failure) : null,
          completedAt,
        }).where(and(
          eq(normalizationReplayItems.replayId, replayId),
          eq(normalizationReplayItems.captureEvidenceVersionId, match.captureEvidenceVersionId),
          eq(normalizationReplayItems.failureJson, match.failureJson!),
        ))
      } catch (error) {
        const failure = classifyReplayFailure(error)
        const completedAt = now().toISOString()
        await options.database.update(normalizationReplayItems).set({
          status: 'failed',
          failureJson: JSON.stringify(failure),
          completedAt,
        }).where(and(
          eq(normalizationReplayItems.replayId, replayId),
          eq(normalizationReplayItems.captureEvidenceVersionId, match.captureEvidenceVersionId),
          eq(normalizationReplayItems.failureJson, match.failureJson!),
        ))
      }
    }

    await finalizeReplay(options.database, replayId, now().toISOString())
    return await readReplayReceipt(options.database, replayId)
  }

  return {
    replay(input: ReplayRawSourceRecordsInput) {
      return replayWithId(input, crypto.randomUUID(), true)
    },
    async replayConnectorUpgrade(input: {
      connectorInstanceId: string
      fromConnectorVersion: string
      instanceUpdatedAt: string
      toConnectorVersion: string
    }) {
      const rawRevisionIds = await currentConnectorRawRevisionIds(
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

async function claimNextReplayItem(
  database: PgliteDatabase,
  replayId: string,
  claimToken: string,
  claimedAt: string,
) {
  const staleBefore = new Date(Date.parse(claimedAt) - REPLAY_CLAIM_LEASE_MS).toISOString()
  const claimJson = replayClaimJson(claimToken, claimedAt)
  return await database.transaction(async (transaction) => {
    const [item] = await transaction.select().from(normalizationReplayItems)
      .where(and(
        eq(normalizationReplayItems.replayId, replayId),
        eq(normalizationReplayItems.status, 'pending'),
        sql`(
          ${normalizationReplayItems.failureJson} is null
          or (${normalizationReplayItems.failureJson}::jsonb)->>'claimedAt' <= ${staleBefore}
        )`,
      ))
      .orderBy(asc(normalizationReplayItems.sequence), asc(normalizationReplayItems.id))
      .limit(1)
      .for('update', { skipLocked: true })
    if (!item) return null
    const [claimed] = await transaction.update(normalizationReplayItems)
      .set({ failureJson: claimJson })
      .where(and(
        eq(normalizationReplayItems.id, item.id),
        eq(normalizationReplayItems.status, 'pending'),
        sql`(
          ${normalizationReplayItems.failureJson} is null
          or (${normalizationReplayItems.failureJson}::jsonb)->>'claimedAt' <= ${staleBefore}
        )`,
      ))
      .returning()
    return claimed ?? null
  })
}

function replayClaimJson(claimToken: string, claimedAt: string) {
  return JSON.stringify({ claimedAt, claimToken })
}

async function hasPendingReplayItems(database: PgliteDatabase, replayId: string) {
  const [pending] = await database.select({ id: normalizationReplayItems.id })
    .from(normalizationReplayItems)
    .where(and(
      eq(normalizationReplayItems.replayId, replayId),
      eq(normalizationReplayItems.status, 'pending'),
    )).limit(1)
  return Boolean(pending)
}

async function finalizeReplay(database: PgliteDatabase, replayId: string, completedAt: string) {
  await database.transaction(async (transaction) => {
    const [pending] = await transaction.select({ id: normalizationReplayItems.id })
      .from(normalizationReplayItems)
      .where(and(
        eq(normalizationReplayItems.replayId, replayId),
        eq(normalizationReplayItems.status, 'pending'),
      )).limit(1).for('update')
    if (pending) return
    const [failed] = await transaction.select({ id: normalizationReplayItems.id })
      .from(normalizationReplayItems)
      .where(and(
        eq(normalizationReplayItems.replayId, replayId),
        eq(normalizationReplayItems.status, 'failed'),
      )).limit(1)
    await transaction.update(normalizationReplayRequests).set({
      status: failed ? 'completed_with_failures' : 'completed',
      completedAt,
    }).where(and(
      eq(normalizationReplayRequests.id, replayId),
      eq(normalizationReplayRequests.status, 'in_progress'),
    ))
  })
}

async function settleReplayItemFromPersistedRun(
  database: PgliteDatabase,
  replayId: string,
  replayItemId: string,
  rawRevisionId: string,
  now: () => Date,
) {
  const [run] = await database.select({ id: normalizationRuns.id, status: normalizationRuns.status })
    .from(normalizationRuns)
    .where(and(
      eq(normalizationRuns.triggerId, replayId),
      eq(normalizationRuns.captureEvidenceVersionId, rawRevisionId),
    ))
    .orderBy(desc(normalizationRuns.createdAt), desc(normalizationRuns.id)).limit(1)
  if (!run || !['completed', 'blocked', 'failed'].includes(run.status)) return false
  const failed = run.status === 'failed'
  await database.update(normalizationReplayItems).set({
    status: failed ? 'failed' : 'completed',
    normalizationRunId: run.id,
    failureJson: failed
      ? JSON.stringify({ code: 'normalization_failed', retryable: false })
      : null,
    completedAt: now().toISOString(),
  }).where(eq(normalizationReplayItems.id, replayItemId))
  return true
}

async function initializeReplay(
  database: PgliteDatabase,
  input: {
    acceptedAt: string
    input: ReplayRawSourceRecordsInput
    matches: Awaited<ReturnType<typeof selectMatches>>
    replayId: string
  },
) {
  await database.transaction(async (transaction) => {
    const [inserted] = await transaction.insert(normalizationReplayRequests).values({
      id: input.replayId,
      selectorJson: JSON.stringify(input.input.selector),
      invalidationJson: JSON.stringify(input.input.invalidate),
      targetVersionsJson: input.input.targetVersions
        ? JSON.stringify(input.input.targetVersions)
        : null,
      fieldDirectivesJson: JSON.stringify(input.input.fieldDirectives ?? []),
      status: 'accepted',
      acceptedAt: input.acceptedAt,
      completedAt: null,
    }).onConflictDoNothing().returning()
    if (!inserted) return
    for (const [sequence, match] of input.matches.entries()) {
      await transaction.insert(normalizationReplayItems).values({
        id: crypto.randomUUID(), replayId: input.replayId, captureLineageId: match.rawRecordId,
        captureEvidenceVersionId: match.rawRevisionId, inputHash: match.inputHash,
        sequence, status: 'pending', normalizationRunId: null,
        failureJson: null, completedAt: null,
      })
    }
  })
}

async function readReplayReceipt(database: PgliteDatabase, replayId: string): Promise<RawSourceReplayReceipt> {
  const [request] = await database.select().from(normalizationReplayRequests)
    .where(eq(normalizationReplayRequests.id, replayId)).limit(1)
  if (!request) throw new Error(`Normalization replay request not found: ${replayId}`)
  const persistedItems = await database.select().from(normalizationReplayItems)
    .where(eq(normalizationReplayItems.replayId, replayId))
    .orderBy(asc(normalizationReplayItems.sequence), asc(normalizationReplayItems.id))
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

async function currentConnectorRawRevisionIds(database: PgliteDatabase, connectorInstanceId: string) {
  const rawRecordIds = new Set((await database.select({ rawRecordId: captures.captureLineageId })
    .from(captures)
    .where(eq(captures.connectorInstanceId, connectorInstanceId))
    ).map(({ rawRecordId }) => rawRecordId))
  const current = new Map<string, { id: string; revision: number }>()
  for (const revision of await database.select({
    id: captureEvidenceVersions.id,
    rawRecordId: captureEvidenceVersions.captureLineageId,
    revision: captureEvidenceVersions.revision,
  }).from(captureEvidenceVersions).orderBy(
    asc(captureEvidenceVersions.createdAt),
    asc(captureEvidenceVersions.id),
  )) {
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
  const errorCode = postgresErrorCode(error)
  if (errorCode) {
    const retryableCodes = new Set(['40001', '40P01', '53300', '55P03', '57P03'])
    return {
      code: 'persistence_failed',
      retryable: retryableCodes.has(errorCode),
    }
  }
  return { code: 'internal_error', retryable: false }
}

function postgresErrorCode(error: unknown, depth = 0): string | null {
  if (depth > 4 || !isRecord(error)) return null
  if (typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) return error.code
  return postgresErrorCode(error.cause, depth + 1)
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

async function selectEffectiveDirectives(database: PgliteDatabase, rawRevisionId: string) {
  const requests = await database.select({
    id: normalizationReplayRequests.id,
    acceptedAt: normalizationReplayRequests.acceptedAt,
    directivesJson: normalizationReplayRequests.fieldDirectivesJson,
  }).from(normalizationReplayItems)
    .innerJoin(normalizationReplayRequests, eq(normalizationReplayRequests.id, normalizationReplayItems.replayId))
    .where(eq(normalizationReplayItems.captureEvidenceVersionId, rawRevisionId))
    .orderBy(
      asc(normalizationReplayRequests.acceptedAt),
      asc(normalizationReplayRequests.id),
    )
  const byField = new Map<string, RawSourceFieldDirective>()
  for (const request of requests) {
    for (const directive of JSON.parse(request.directivesJson) as RawSourceFieldDirective[]) {
      byField.set(directive.field, directive)
    }
  }
  return [...byField.values()]
}

async function selectMatches(database: PgliteDatabase, input: ReplayRawSourceRecordsInput) {
  const revisions = await database.select({
    rawRecordId: captureEvidenceVersions.captureLineageId,
    rawRevisionId: captureEvidenceVersions.id,
    contentHash: captureEvidenceVersions.contentHash,
  }).from(captureEvidenceVersions).orderBy(
    asc(captureEvidenceVersions.createdAt),
    asc(captureEvidenceVersions.id),
  )
  const rawRecordIds = input.selector.rawRecordIds ? new Set(input.selector.rawRecordIds) : null
  const rawRevisionIds = input.selector.rawRevisionIds ? new Set(input.selector.rawRevisionIds) : null
  const inputHashes = input.selector.inputHashes ? new Set(input.selector.inputHashes) : null

  const matches: Array<{ rawRecordId: string; rawRevisionId: string; inputHash: string }> = []
  for (const revision of revisions) {
    if (rawRecordIds && !rawRecordIds.has(revision.rawRecordId)) continue
    if (rawRevisionIds && !rawRevisionIds.has(revision.rawRevisionId)) continue
    const runs = await database.select().from(normalizationRuns)
      .where(eq(normalizationRuns.captureEvidenceVersionId, revision.rawRevisionId))
    if (inputHashes && !await matchesInputHash(database, runs, inputHashes)) continue
    if (!await matchesInvalidation(database, runs, input.invalidate)) continue
    matches.push({
      rawRecordId: revision.rawRecordId,
      rawRevisionId: revision.rawRevisionId,
      inputHash: hashJson({ rawRevisionId: revision.rawRevisionId, contentHash: revision.contentHash }),
    })
  }
  return matches
}

async function matchesInputHash(
  database: PgliteDatabase,
  runs: Array<typeof normalizationRuns.$inferSelect>,
  inputHashes: ReadonlySet<string>,
) {
  if (runs.some(({ inputHash }) => inputHashes.has(inputHash))) return true
  if (!runs.length) return false
  const runIds = runs.map(({ id }) => id)
  if ((await database.select({ inputHash: normalizationAttempts.inputHash }).from(normalizationAttempts)
    .where(inArray(normalizationAttempts.runId, runIds)))
    .some(({ inputHash }) => inputHashes.has(inputHash))) return true
  return (await database.select({ inputHash: normalizationFieldOutcomes.inputHash })
    .from(normalizationFieldOutcomes)
    .where(inArray(normalizationFieldOutcomes.runId, runIds)))
    .some(({ inputHash }) => inputHashes.has(inputHash))
}

async function matchesInvalidation(
  database: PgliteDatabase,
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
    const attempts = await database.select({
      resolverId: normalizationAttempts.resolverId,
      resolverVersion: normalizationAttempts.resolverVersion,
    }).from(normalizationAttempts).where(inArray(normalizationAttempts.runId, runs.map(({ id }) => id)))
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
