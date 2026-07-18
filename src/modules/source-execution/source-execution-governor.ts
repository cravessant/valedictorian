import { randomUUID } from 'node:crypto'
import { and, eq, lte, or, sql } from 'drizzle-orm'
import type { SourceExecutionScopeId } from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import { sourceExecutionScopes, sourceExecutionSessions } from '../../db/schema'

export interface SourceSessionCodec {
  decrypt(value: string): string
  encrypt(value: string): string
}

export function deriveSourceExecutionScopeId(
  connectorInstanceId: string,
): SourceExecutionScopeId {
  const instanceId = connectorInstanceId.trim()
  if (!instanceId || instanceId !== connectorInstanceId || Buffer.byteLength(instanceId) > 125) {
    throw new Error('Connector instance id cannot produce a valid source execution scope')
  }
  return `scope_${Buffer.from(instanceId, 'utf8').toString('hex')}`
}

export interface BlockScopeInput {
  now: string
  random?: () => number
  retryAfter?: string | null
  serverMinimumDelayMs?: number
}

const BASE_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 60 * 60_000

export function createSourceExecutionGovernor(
  database: PgliteDatabase,
  sessionCodec: SourceSessionCodec = { decrypt: (value) => value, encrypt: (value) => value },
) {
  return {
    async getScope(scopeId: SourceExecutionScopeId) {
      return readScope(database, scopeId)
    },
    async loadActiveSession(scopeId: SourceExecutionScopeId) {
      const [session] = await database.select().from(sourceExecutionSessions)
        .where(eq(sourceExecutionSessions.executionScopeId, scopeId)).limit(1)
      return session ? { ...session, encryptedSession: sessionCodec.decrypt(session.encryptedSession) } : null
    },
    async ensureScope(scopeId: SourceExecutionScopeId, now: string) {
      await database.insert(sourceExecutionScopes).values({
        id: scopeId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }).onConflictDoNothing()
      return readScope(database, scopeId)
    },

    async isAvailable(scopeId: SourceExecutionScopeId, now: string) {
      const scope = await readScope(database, scopeId)
      if (scope.status === 'action_required' || scope.status === 'refreshing') return false
      return scope.blockedUntil === null || scope.blockedUntil <= now
    },

    async acquireReconnectLease(scopeId: SourceExecutionScopeId, input: { leaseMs: number; now: string; token?: string }) {
      const token = input.token ?? randomUUID()
      const expiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString()
      const updated = await database.update(sourceExecutionScopes).set({
        status: 'refreshing', blockedUntil: null, refreshLeaseToken: token,
        refreshLeaseExpiresAt: expiresAt, actionReason: 'source_reconnect_validation', updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        or(
          eq(sourceExecutionScopes.status, 'available'),
          eq(sourceExecutionScopes.status, 'action_required'),
          and(eq(sourceExecutionScopes.status, 'cooldown'), lte(sourceExecutionScopes.blockedUntil, input.now)),
          and(eq(sourceExecutionScopes.status, 'refreshing'), lte(sourceExecutionScopes.refreshLeaseExpiresAt, input.now)),
        ),
      )).returning({ id: sourceExecutionScopes.id })
      return updated.length === 1 ? { expiresAt, token } : null
    },

    async finishReconnectValidation(scopeId: SourceExecutionScopeId, input: {
      now: string
      reason: string
      status: 'action_required' | 'available'
      token: string
    }) {
      const updated = await database.update(sourceExecutionScopes).set({
        status: input.status,
        actionReason: input.status === 'available' ? null : sanitizeActionReason(input.reason),
        refreshLeaseToken: null,
        refreshLeaseExpiresAt: null,
        updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        eq(sourceExecutionScopes.status, 'refreshing'),
        eq(sourceExecutionScopes.refreshLeaseToken, input.token),
      )).returning()
      return updated[0] ?? null
    },

    async blockScope(scopeId: SourceExecutionScopeId, input: BlockScopeInput) {
      return database.transaction(async (transaction) => {
        const scope = await readScopeForUpdate(transaction, scopeId)
        const cooldown = cooldownValues(scope, input)
        const [updated] = await transaction.update(sourceExecutionScopes).set({
          ...cooldown,
          status: 'cooldown',
          updatedAt: input.now,
        }).where(eq(sourceExecutionScopes.id, scopeId)).returning()
        if (!updated) throw new Error(`Source execution scope not found: ${scopeId}`)
        return updated
      })
    },

    async acquireRefreshLease(scopeId: SourceExecutionScopeId, input: {
      allowActionRequired?: boolean
      leaseMs: number
      now: string
      token?: string
    }) {
      const token = input.token ?? randomUUID()
      const expiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString()
      const updated = await database.update(sourceExecutionScopes).set({
        status: 'refreshing',
        blockedUntil: null,
        refreshLeaseToken: token,
        refreshLeaseExpiresAt: expiresAt,
        actionReason: null,
        updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        or(
          eq(sourceExecutionScopes.status, 'available'),
          and(
            eq(sourceExecutionScopes.status, 'cooldown'),
            lte(sourceExecutionScopes.blockedUntil, input.now),
          ),
          and(
            eq(sourceExecutionScopes.status, 'refreshing'),
            lte(sourceExecutionScopes.refreshLeaseExpiresAt, input.now),
          ),
          ...(input.allowActionRequired ? [eq(sourceExecutionScopes.status, 'action_required')] : []),
        ),
      )).returning({ id: sourceExecutionScopes.id })
      return updated.length === 1 ? { expiresAt, token } : null
    },

    async completeRefresh(scopeId: SourceExecutionScopeId, input: { encryptedSession?: string; now: string; token: string }) {
      return database.transaction(async (transaction) => {
        const [scope] = await transaction.update(sourceExecutionScopes).set({
          status: 'available',
          blockedUntil: null,
          backoffAttempt: 0,
          authGeneration: sql`${sourceExecutionScopes.authGeneration} + 1`,
          refreshLeaseToken: null,
          refreshLeaseExpiresAt: null,
          actionReason: null,
          updatedAt: input.now,
        }).where(and(
          eq(sourceExecutionScopes.id, scopeId),
          eq(sourceExecutionScopes.status, 'refreshing'),
          eq(sourceExecutionScopes.refreshLeaseToken, input.token),
        )).returning()
        if (!scope) return null
        if (input.encryptedSession !== undefined) {
          const encryptedSession = sessionCodec.encrypt(input.encryptedSession)
          await transaction.insert(sourceExecutionSessions).values({ executionScopeId: scopeId,
            encryptedSession, authGeneration: scope.authGeneration, updatedAt: input.now })
            .onConflictDoUpdate({ target: sourceExecutionSessions.executionScopeId,
              set: { encryptedSession, authGeneration: scope.authGeneration, updatedAt: input.now } })
        }
        return scope
      })
    },

    async failRefresh(scopeId: SourceExecutionScopeId, input: {
      now: string
      reason: string
      token: string
    }) {
      const [updated] = await database.update(sourceExecutionScopes).set({
        status: 'action_required',
        refreshLeaseToken: null,
        refreshLeaseExpiresAt: null,
        actionReason: sanitizeActionReason(input.reason),
        updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        eq(sourceExecutionScopes.status, 'refreshing'),
        eq(sourceExecutionScopes.refreshLeaseToken, input.token),
      )).returning()
      return updated ?? null
    },

    async cooldownRefresh(scopeId: SourceExecutionScopeId, input: BlockScopeInput & { token: string }) {
      return database.transaction(async (transaction) => {
        const scope = await readScopeForUpdate(transaction, scopeId)
        if (scope.status !== 'refreshing' || scope.refreshLeaseToken !== input.token) return null
        const cooldown = cooldownValues(scope, input)
        const [updated] = await transaction.update(sourceExecutionScopes).set({
          ...cooldown, status: 'cooldown', refreshLeaseToken: null,
          refreshLeaseExpiresAt: null, actionReason: null, updatedAt: input.now,
        }).where(and(
          eq(sourceExecutionScopes.id, scopeId), eq(sourceExecutionScopes.status, 'refreshing'),
          eq(sourceExecutionScopes.refreshLeaseToken, input.token),
        )).returning()
        return updated ?? null
      })
    },

    async releaseRefreshLease(scopeId: SourceExecutionScopeId, input: { now: string; token: string }) {
      const updated = await database.update(sourceExecutionScopes).set({
        status: 'available', refreshLeaseToken: null, refreshLeaseExpiresAt: null, updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        eq(sourceExecutionScopes.status, 'refreshing'),
        eq(sourceExecutionScopes.refreshLeaseToken, input.token),
      )).returning({ id: sourceExecutionScopes.id })
      return updated.length === 1
    },
  }
}

function sanitizeActionReason(reason: string) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(reason) ? reason : 'source_action_required'
}

async function readScope(database: Pick<PgliteDatabase, 'select'>, scopeId: SourceExecutionScopeId) {
  const [scope] = await database.select().from(sourceExecutionScopes)
    .where(eq(sourceExecutionScopes.id, scopeId)).limit(1)
  if (!scope) throw new Error(`Source execution scope not found: ${scopeId}`)
  return scope
}

async function readScopeForUpdate(database: Pick<PgliteDatabase, 'select'>, scopeId: SourceExecutionScopeId) {
  const [scope] = await database.select().from(sourceExecutionScopes)
    .where(eq(sourceExecutionScopes.id, scopeId)).limit(1).for('update')
  if (!scope) throw new Error(`Source execution scope not found: ${scopeId}`)
  return scope
}

function parseRetryAfter(value: string | null | undefined, now: string) {
  if (!value) return null
  const nowTimestamp = Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) return null
  let timestamp: number
  if (/^(0|[1-9]\d*)$/.test(value)) {
    const seconds = Number(value)
    if (!Number.isSafeInteger(seconds) || seconds > Math.floor((8.64e15 - nowTimestamp) / 1000)) return null
    timestamp = nowTimestamp + seconds * 1000
  } else {
    timestamp = Date.parse(value)
  }
  return Number.isFinite(timestamp) && timestamp >= nowTimestamp && timestamp <= 8.64e15
    ? new Date(timestamp).toISOString()
    : null
}

function cooldownValues(scope: { backoffAttempt: number }, input: BlockScopeInput) {
  const nowTimestamp = Date.parse(input.now)
  const minimum = input.serverMinimumDelayMs
  const parsedMinimum = Number.isSafeInteger(minimum) && minimum! >= 0
    && Number.isFinite(nowTimestamp) && minimum! <= 8.64e15 - nowTimestamp
    ? new Date(nowTimestamp + minimum!).toISOString()
    : null
  const parsedRetryAfter = parsedMinimum ?? parseRetryAfter(input.retryAfter, input.now)
  const backoffAttempt = parsedRetryAfter === null ? scope.backoffAttempt + 1 : 0
  const maximumDelay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** Math.max(0, backoffAttempt - 1)))
  const random = Math.max(0, Math.min(1, input.random?.() ?? Math.random()))
  return {
    blockedUntil: parsedRetryAfter ?? new Date(Date.parse(input.now) + Math.floor(maximumDelay * random)).toISOString(),
    backoffAttempt,
  }
}
