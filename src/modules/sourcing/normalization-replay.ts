import crypto from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
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
  rawSourceRevisions,
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

  return {
    async replay(input: ReplayRawSourceRecordsInput): Promise<RawSourceReplayReceipt> {
      validateReplayInput(input)
      validateTargetVersions(input, options.registry)
      const replayId = crypto.randomUUID()
      const acceptedAt = now().toISOString()
      const matches = selectMatches(options.database, input)

      options.database.transaction((transaction) => {
        transaction.insert(normalizationReplayRequests).values({
          id: replayId,
          selectorJson: JSON.stringify(input.selector),
          invalidationJson: JSON.stringify(input.invalidate),
          targetVersionsJson: input.targetVersions ? JSON.stringify(input.targetVersions) : null,
          fieldDirectivesJson: JSON.stringify(input.fieldDirectives ?? []),
          status: matches.length ? 'in_progress' : 'accepted',
          acceptedAt,
          completedAt: null,
        }).run()
        matches.forEach((match, sequence) => {
          transaction.insert(normalizationReplayItems).values({
            id: crypto.randomUUID(), replayId, rawRecordId: match.rawRecordId,
            rawRevisionId: match.rawRevisionId, inputHash: match.inputHash,
            sequence, status: 'pending', normalizationRunId: null,
            failureJson: null, completedAt: null,
          }).run()
        })
      })

      let failed = false
      const items: RawSourceReplayItem[] = []
      for (const match of matches) {
        try {
          const effectiveDirectives = selectEffectiveDirectives(
            options.database,
            match.rawRevisionId,
          )
          const result = await options.orchestrator.normalize(match.rawRecordId, match.rawRevisionId, {
            kind: 'replay', replayId, fieldDirectives: effectiveDirectives,
            targetResolverVersions: input.targetVersions?.resolvers ?? [],
          })
          await options.onNormalized?.(result)
          const run = options.database.select({ id: normalizationRuns.id }).from(normalizationRuns)
            .where(and(
              eq(normalizationRuns.rawRevisionId, match.rawRevisionId),
              eq(normalizationRuns.triggerId, replayId),
            )).get()
          const resultFailed = result.status === 'failed'
          const failure: RawSourceReplayFailure | null = resultFailed
            ? { code: 'normalization_failed', retryable: false }
            : null
          if (failure) {
            failed = true
          }
          const completedAt = now().toISOString()
          options.database.update(normalizationReplayItems).set({
            status: resultFailed ? 'failed' : 'completed', normalizationRunId: run?.id ?? null,
            failureJson: failure ? JSON.stringify(failure) : null,
            completedAt,
          }).where(and(
            eq(normalizationReplayItems.replayId, replayId),
            eq(normalizationReplayItems.rawRevisionId, match.rawRevisionId),
          )).run()
          items.push(resultFailed ? {
            status: 'failed', rawRecordId: match.rawRecordId,
            rawRevisionId: match.rawRevisionId, ...(run ? { normalizationRunId: run.id } : {}),
            failure: failure!,
          } : {
            status: 'completed', rawRecordId: match.rawRecordId,
            rawRevisionId: match.rawRevisionId, ...(run ? { normalizationRunId: run.id } : {}),
          })
        } catch (error) {
          failed = true
          const failure = classifyReplayFailure(error)
          const completedAt = now().toISOString()
          options.database.update(normalizationReplayItems).set({
            status: 'failed',
            failureJson: JSON.stringify(failure),
            completedAt,
          }).where(and(
            eq(normalizationReplayItems.replayId, replayId),
            eq(normalizationReplayItems.rawRevisionId, match.rawRevisionId),
          )).run()
          items.push({
            status: 'failed', rawRecordId: match.rawRecordId,
            rawRevisionId: match.rawRevisionId, failure,
          })
        }
      }

      const completedAt = now().toISOString()
      options.database.update(normalizationReplayRequests).set({
        status: failed ? 'completed_with_failures' : 'completed', completedAt,
      }).where(eq(normalizationReplayRequests.id, replayId)).run()

      const receipt = {
        replayId,
        acceptedAt,
        matchedRawRevisionIds: matches.map(({ rawRevisionId }) => rawRevisionId),
        completedAt,
      }
      return failed
        ? { ...receipt, status: 'completed_with_failures', items }
        : { ...receipt, status: 'completed', items: items.filter(
          (item): item is CompletedRawSourceReplayItem => item.status === 'completed',
        ) }
    },
  }
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
    .where(eq(normalizationReplayItems.rawRevisionId, rawRevisionId))
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
    rawRecordId: rawSourceRevisions.rawRecordId,
    rawRevisionId: rawSourceRevisions.id,
    contentHash: rawSourceRevisions.contentHash,
  }).from(rawSourceRevisions).orderBy(asc(rawSourceRevisions.createdAt), asc(rawSourceRevisions.id)).all()
  const rawRecordIds = input.selector.rawRecordIds ? new Set(input.selector.rawRecordIds) : null
  const rawRevisionIds = input.selector.rawRevisionIds ? new Set(input.selector.rawRevisionIds) : null
  const inputHashes = input.selector.inputHashes ? new Set(input.selector.inputHashes) : null

  return revisions.flatMap((revision) => {
    if (rawRecordIds && !rawRecordIds.has(revision.rawRecordId)) return []
    if (rawRevisionIds && !rawRevisionIds.has(revision.rawRevisionId)) return []
    const runs = database.select().from(normalizationRuns)
      .where(eq(normalizationRuns.rawRevisionId, revision.rawRevisionId)).all()
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
