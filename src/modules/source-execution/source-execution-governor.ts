import { randomUUID } from 'node:crypto'
import { and, eq, lte, or, sql } from 'drizzle-orm'
import type { SourceExecutionScopeId } from 'sparxie'
import { sourceExecutionScopes, sourceExecutionSessions } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

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
  database: DrizzleDatabase,
  sessionCodec: SourceSessionCodec = { decrypt: (value) => value, encrypt: (value) => value },
) {
  return {
    getScope(scopeId: SourceExecutionScopeId) {
      return readScope(database, scopeId)
    },
    loadActiveSession(scopeId: SourceExecutionScopeId) {
      const session = database.select().from(sourceExecutionSessions)
        .where(eq(sourceExecutionSessions.executionScopeId, scopeId)).get()
      return session ? { ...session, encryptedSession: sessionCodec.decrypt(session.encryptedSession) } : null
    },
    ensureScope(scopeId: SourceExecutionScopeId, now: string) {
      database.insert(sourceExecutionScopes).values({
        id: scopeId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }).onConflictDoNothing().run()
      return readScope(database, scopeId)
    },

    isAvailable(scopeId: SourceExecutionScopeId, now: string) {
      const scope = readScope(database, scopeId)
      if (scope.status === 'action_required' || scope.status === 'refreshing') return false
      return scope.blockedUntil === null || scope.blockedUntil <= now
    },

    acquireReconnectLease(scopeId: SourceExecutionScopeId, input: { leaseMs: number; now: string; token?: string }) {
      const token = input.token ?? randomUUID()
      const expiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString()
      const result = database.update(sourceExecutionScopes).set({
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
      )).run()
      return result.changes === 1 ? { expiresAt, token } : null
    },

    finishReconnectValidation(scopeId: SourceExecutionScopeId, input: {
      now: string
      reason: string
      status: 'action_required' | 'available'
      token: string
    }) {
      const result = database.update(sourceExecutionScopes).set({
        status: input.status,
        actionReason: input.status === 'available' ? null : sanitizeActionReason(input.reason),
        refreshLeaseToken: null,
        refreshLeaseExpiresAt: null,
        updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        eq(sourceExecutionScopes.status, 'refreshing'),
        eq(sourceExecutionScopes.refreshLeaseToken, input.token),
      )).run()
      return result.changes === 1 ? readScope(database, scopeId) : null
    },

    blockScope(scopeId: SourceExecutionScopeId, input: BlockScopeInput) {
      return database.transaction((transaction) => {
        const scope = readScope(transaction, scopeId)
        const cooldown = cooldownValues(scope, input)
        transaction.update(sourceExecutionScopes).set({
          ...cooldown,
          status: 'cooldown',
          updatedAt: input.now,
        }).where(eq(sourceExecutionScopes.id, scopeId)).run()
        return readScope(transaction, scopeId)
      })
    },

    acquireRefreshLease(scopeId: SourceExecutionScopeId, input: {
      allowActionRequired?: boolean
      leaseMs: number
      now: string
      token?: string
    }) {
      const token = input.token ?? randomUUID()
      const expiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString()
      const result = database.update(sourceExecutionScopes).set({
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
      )).run()
      return result.changes === 1 ? { expiresAt, token } : null
    },

    completeRefresh(scopeId: SourceExecutionScopeId, input: { encryptedSession?: string; now: string; token: string }) {
      return database.transaction((transaction) => {
      const result = transaction.update(sourceExecutionScopes).set({
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
      )).run()
      if (result.changes !== 1) return null
      const scope = readScope(transaction, scopeId)
      if (input.encryptedSession !== undefined) {
        transaction.insert(sourceExecutionSessions).values({ executionScopeId: scopeId,
          encryptedSession: sessionCodec.encrypt(input.encryptedSession), authGeneration: scope.authGeneration, updatedAt: input.now })
          .onConflictDoUpdate({ target: sourceExecutionSessions.executionScopeId,
            set: { encryptedSession: sessionCodec.encrypt(input.encryptedSession), authGeneration: scope.authGeneration, updatedAt: input.now } }).run()
      }
      return scope
      })
    },

    failRefresh(scopeId: SourceExecutionScopeId, input: {
      now: string
      reason: string
      token: string
    }) {
      const result = database.update(sourceExecutionScopes).set({
        status: 'action_required',
        refreshLeaseToken: null,
        refreshLeaseExpiresAt: null,
        actionReason: sanitizeActionReason(input.reason),
        updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        eq(sourceExecutionScopes.status, 'refreshing'),
        eq(sourceExecutionScopes.refreshLeaseToken, input.token),
      )).run()
      return result.changes === 1 ? readScope(database, scopeId) : null
    },

    cooldownRefresh(scopeId: SourceExecutionScopeId, input: BlockScopeInput & { token: string }) {
      return database.transaction((transaction) => {
        const scope = readScope(transaction, scopeId)
        if (scope.status !== 'refreshing' || scope.refreshLeaseToken !== input.token) return null
        const cooldown = cooldownValues(scope, input)
        const result = transaction.update(sourceExecutionScopes).set({
          ...cooldown, status: 'cooldown', refreshLeaseToken: null,
          refreshLeaseExpiresAt: null, actionReason: null, updatedAt: input.now,
        }).where(and(
          eq(sourceExecutionScopes.id, scopeId), eq(sourceExecutionScopes.status, 'refreshing'),
          eq(sourceExecutionScopes.refreshLeaseToken, input.token),
        )).run()
        return result.changes === 1 ? readScope(transaction, scopeId) : null
      })
    },

    releaseRefreshLease(scopeId: SourceExecutionScopeId, input: { now: string; token: string }) {
      const result = database.update(sourceExecutionScopes).set({
        status: 'available', refreshLeaseToken: null, refreshLeaseExpiresAt: null, updatedAt: input.now,
      }).where(and(
        eq(sourceExecutionScopes.id, scopeId),
        eq(sourceExecutionScopes.status, 'refreshing'),
        eq(sourceExecutionScopes.refreshLeaseToken, input.token),
      )).run()
      return result.changes === 1
    },
  }
}

function sanitizeActionReason(reason: string) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(reason) ? reason : 'source_action_required'
}

function readScope(database: Pick<DrizzleDatabase, 'select'>, scopeId: SourceExecutionScopeId) {
  const scope = database.select().from(sourceExecutionScopes)
    .where(eq(sourceExecutionScopes.id, scopeId)).get()
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
