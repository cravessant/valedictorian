import crypto from 'node:crypto'
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { captureEvidenceVersions, retryWork } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import type { RawSourceTransaction } from './raw-source.repository'
import type { ClaimedProviderUrlResolutionWork } from './provider-url-resolution.source'

const PROVIDER_URL_WORK_KIND = 'provider_url_resolution'
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_HORIZON_MS = 24 * 60 * 60 * 1_000

export interface EnqueueProviderUrlResolutionInput {
  captureEvidenceVersionId: string
  connectorInstanceId: string
  executionScopeId: string
  inputHash: string
  providerRecordId: string
  intermediaryUrl: string
  resolverId: string
  resolverVersion: string
}

interface ProviderUrlLineage {
  acquisitionToken?: string | null
  connectorInstanceId: string
  failureEvidence?: unknown
  intermediaryUrl: string
  normalizationRunId?: string
  providerRecordId: string
  workKind: typeof PROVIDER_URL_WORK_KIND
}

export function createProviderUrlResolutionRepository(
  database: PgliteDatabase,
  now: () => Date = () => new Date(),
) {
  return {
    async enqueue(input: EnqueueProviderUrlResolutionInput, transaction?: RawSourceTransaction) {
      const target = transaction ?? database
      const createdAt = now().toISOString()
      const [inserted] = await target.insert(retryWork).values({
        id: crypto.randomUUID(),
        executionScopeId: input.executionScopeId,
        kind: 'normalization',
        connectorInstanceId: null,
        filterSignature: null,
        checkpointSchemaVersion: null,
        checkpointGeneration: null,
        captureEvidenceVersionId: input.captureEvidenceVersionId,
        resolverId: input.resolverId,
        resolverVersion: input.resolverVersion,
        inputHash: input.inputHash,
        reason: 'network_interruption',
        attempt: 1,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        lastAttemptAt: createdAt,
        computedDelayMs: 0,
        serverMinimumDelayMs: null,
        nextAttemptAt: createdAt,
        horizonAt: new Date(now().getTime() + DEFAULT_HORIZON_MS).toISOString(),
        state: 'scheduled',
        ownerVersion: input.resolverVersion,
        lineageJson: JSON.stringify({
          connectorInstanceId: input.connectorInstanceId,
          intermediaryUrl: input.intermediaryUrl,
          providerRecordId: input.providerRecordId,
          workKind: PROVIDER_URL_WORK_KIND,
        } satisfies ProviderUrlLineage),
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        skippedRunId: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      }).onConflictDoNothing().returning({ id: retryWork.id })
      return Boolean(inserted)
    },

    async nextDueAt(): Promise<string | null> {
      return (await scheduledProviderWork(database))
        .map(({ nextAttemptAt }) => nextAttemptAt)
        .filter((value): value is string => value !== null)
        .sort((left, right) => left.localeCompare(right))[0] ?? null
    },

    async recoverAcquired(recoveredAt = now().toISOString()): Promise<number> {
      const recovered = await database.update(retryWork).set({
        acquiredAt: null,
        acquisitionToken: null,
        acquisitionRunId: null,
        lineageJson: sql`((${retryWork.lineageJson})::jsonb - 'acquisitionToken')::text`,
        state: 'scheduled',
        updatedAt: recoveredAt,
      }).where(and(
        eq(retryWork.kind, 'normalization'),
        eq(retryWork.state, 'acquired'),
        isNull(retryWork.deletedAt),
        sql`(${retryWork.lineageJson})::jsonb ->> 'workKind' = ${PROVIDER_URL_WORK_KIND}`,
      )).returning({ id: retryWork.id })
      return recovered.length
    },

    async claimDue(dueAt: string): Promise<ClaimedProviderUrlResolutionWork | null> {
      return database.transaction(async (transaction) => {
        const [candidate] = await transaction.select().from(retryWork).where(and(
          eq(retryWork.kind, 'normalization'),
          eq(retryWork.state, 'scheduled'),
          lte(retryWork.nextAttemptAt, dueAt),
          isNull(retryWork.deletedAt),
          sql`(${retryWork.lineageJson})::jsonb ->> 'workKind' = ${PROVIDER_URL_WORK_KIND}`,
        )).orderBy(
          asc(retryWork.nextAttemptAt),
          asc(retryWork.createdAt),
          asc(retryWork.id),
        ).limit(1).for('update', { skipLocked: true })
        if (!candidate) return null
        const candidateLineage = providerLineage(candidate.lineageJson)
        if (!candidateLineage) return null
        const acquisitionToken = crypto.randomUUID()
        const [claimed] = await transaction.update(retryWork).set({
          acquiredAt: dueAt,
          acquisitionToken,
          lineageJson: JSON.stringify({ ...candidateLineage, acquisitionToken }),
          state: 'acquired',
          updatedAt: dueAt,
        }).where(and(
          eq(retryWork.id, candidate.id),
          eq(retryWork.state, 'scheduled'),
          isNull(retryWork.deletedAt),
        )).returning()
        if (!claimed) return null
        const lineage = providerLineage(claimed.lineageJson)
        const revision = claimed.captureEvidenceVersionId
          ? (await transaction.select().from(captureEvidenceVersions)
              .where(eq(captureEvidenceVersions.id, claimed.captureEvidenceVersionId)).limit(1))[0]
          : null
        if (!lineage || !revision?.providerRecordId || lineage.providerRecordId !== revision.providerRecordId
          || !claimed.captureEvidenceVersionId
          || !claimed.resolverId || !claimed.resolverVersion || !claimed.inputHash) {
          throw new Error('Claimed provider URL work has incomplete persisted identity')
        }
        return {
          acquisitionToken,
          attempt: lineage.normalizationRunId
            ? claimed.attempt + 1
            : claimed.attempt,
          captureEvidenceVersionId: claimed.captureEvidenceVersionId,
          connectorInstanceId: lineage.connectorInstanceId,
          executionScopeId: claimed.executionScopeId,
          inputHash: claimed.inputHash,
          horizonAt: claimed.horizonAt,
          intermediaryUrl: lineage.intermediaryUrl,
          maxAttempts: claimed.maxAttempts,
          providerRecordId: revision.providerRecordId,
          resolverId: claimed.resolverId,
          resolverVersion: claimed.resolverVersion,
          serverMinimumDelayMs: claimed.serverMinimumDelayMs,
          retryWorkId: claimed.id,
        }
      })
    },

    async release(work: Pick<ClaimedProviderUrlResolutionWork, 'acquisitionToken' | 'retryWorkId'>) {
      const updatedAt = now().toISOString()
      await database.update(retryWork).set({
        acquiredAt: null,
        acquisitionToken: null,
        state: 'scheduled',
        updatedAt,
      }).where(and(
        eq(retryWork.id, work.retryWorkId),
        eq(retryWork.state, 'acquired'),
        eq(retryWork.acquisitionToken, work.acquisitionToken),
        isNull(retryWork.deletedAt),
      ))
    },

    recordFailureEvidence(input: {
      acquisitionToken: string
      retryWorkId: string
      evidence: unknown
      terminal?: boolean
    }): Promise<boolean> {
      return database.transaction(async (transaction) => {
        const [row] = await transaction.select().from(retryWork)
          .where(eq(retryWork.id, input.retryWorkId)).limit(1).for('update')
        if (!row) throw new Error('Provider URL work not found')
        const lineage = providerLineage(row.lineageJson)
        if (!lineage) throw new Error('Provider URL work lineage is invalid')

        const ownsCurrentClaim = row.state === 'acquired'
          && row.acquisitionToken === input.acquisitionToken
        const ownsPersistedReplay = row.state !== 'acquired'
          && typeof lineage.normalizationRunId === 'string'
          && lineage.acquisitionToken === input.acquisitionToken
        if (!ownsCurrentClaim && !ownsPersistedReplay) return false

        const currentClaim = and(
          eq(retryWork.state, 'acquired'),
          eq(retryWork.acquisitionToken, input.acquisitionToken),
        )
        const persistedReplay = and(
          sql`${retryWork.state} <> 'acquired'`,
          sql`(${retryWork.lineageJson})::jsonb ->> 'normalizationRunId' IS NOT NULL`,
          sql`(${retryWork.lineageJson})::jsonb ->> 'acquisitionToken' = ${input.acquisitionToken}`,
        )
        const updated = await transaction.update(retryWork).set({
          ...(input.terminal
            ? { state: 'cancelled' as const, nextAttemptAt: null }
            : {}),
          acquiredAt: null,
          acquisitionToken: null,
          lineageJson: JSON.stringify({ ...lineage, failureEvidence: input.evidence }),
          updatedAt: now().toISOString(),
        }).where(and(
          eq(retryWork.id, input.retryWorkId),
          isNull(retryWork.deletedAt),
          or(currentClaim, persistedReplay),
        )).returning({ id: retryWork.id })
        return updated.length > 0
      })
    },
  }
}

async function scheduledProviderWork(database: PgliteDatabase) {
  return database.select().from(retryWork).where(and(
    eq(retryWork.kind, 'normalization'),
    eq(retryWork.state, 'scheduled'),
    isNull(retryWork.deletedAt),
    sql`(${retryWork.lineageJson})::jsonb ->> 'workKind' = ${PROVIDER_URL_WORK_KIND}`,
  ))
}

function providerLineage(value: string): ProviderUrlLineage | null {
  try {
    const parsed = JSON.parse(value) as Partial<ProviderUrlLineage>
    return parsed.workKind === PROVIDER_URL_WORK_KIND
      && typeof parsed.connectorInstanceId === 'string'
      && typeof parsed.intermediaryUrl === 'string'
      && typeof parsed.providerRecordId === 'string'
      ? parsed as ProviderUrlLineage
      : null
  } catch {
    return null
  }
}
