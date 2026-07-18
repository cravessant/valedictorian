import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type {
  ConnectorScheduleAuditEvent,
  ConnectorScheduleAuditListResult,
  ConnectorScheduleCadence,
  ConnectorScheduleLastRunSummary,
  ConnectorScheduleOccurrenceListResult,
  ConnectorScheduleOccurrenceSummary,
  ConnectorScheduleSummary,
  ConnectorScheduleState,
} from 'sparxie'
import {
  connectorInstances,
  connectorRuns,
  connectorScheduleEvents,
  connectorScheduleOccurrences,
  connectorScheduleRevisions,
  connectorSchedules,
} from '../../db/schema.connectors'
import { retryWork, sourceExecutionScopes } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'
import { computeNextEligibleAt } from './connector-schedule.eligibility'
import { createConnectorScheduleError } from './connector-schedule.errors'

export function createConnectorScheduleRepository(
  database: PgliteDatabase,
  now: () => Date = () => new Date(),
) {
  return {
    async listEnabled(): Promise<ConnectorScheduleSummary[]> {
      const rows = await database
        .select()
        .from(connectorSchedules)
        .where(and(
          eq(connectorSchedules.state, 'enabled'),
          isNull(connectorSchedules.deletedAt),
        ))
        .orderBy(asc(connectorSchedules.nextEligibleAt), asc(connectorSchedules.connectorInstanceId))
      return Promise.all(rows.map((row) => mapScheduleSummary(database, row)))
    },

    async listScheduledCaptureRetries(): Promise<Array<{
      connectorInstanceId: string
      nextAttemptAt: string
    }>> {
      const rows = await database
        .select({
          connectorInstanceId: retryWork.connectorInstanceId,
          nextAttemptAt: retryWork.nextAttemptAt,
          scopeBlockedUntil: sourceExecutionScopes.blockedUntil,
        })
        .from(retryWork)
        .innerJoin(
          connectorSchedules,
          eq(connectorSchedules.connectorInstanceId, retryWork.connectorInstanceId),
        )
        .innerJoin(
          connectorInstances,
          eq(connectorInstances.id, retryWork.connectorInstanceId),
        )
        .innerJoin(
          sourceExecutionScopes,
          eq(sourceExecutionScopes.id, connectorInstances.executionScopeId),
        )
        .where(and(
          eq(retryWork.kind, 'connector_capture'),
          eq(retryWork.state, 'scheduled'),
          isNotNull(retryWork.nextAttemptAt),
          isNull(retryWork.deletedAt),
          eq(connectorSchedules.state, 'enabled'),
          isNull(connectorSchedules.deletedAt),
          eq(connectorInstances.enabled, true),
          isNull(connectorInstances.deletedAt),
          inArray(sourceExecutionScopes.status, ['available', 'cooldown']),
        ))
        .orderBy(asc(retryWork.nextAttemptAt), asc(retryWork.connectorInstanceId))
      return rows.flatMap((row) => row.connectorInstanceId && row.nextAttemptAt ? [{
          connectorInstanceId: row.connectorInstanceId,
          nextAttemptAt: row.scopeBlockedUntil && row.scopeBlockedUntil > row.nextAttemptAt
            ? row.scopeBlockedUntil
            : row.nextAttemptAt,
        }] : [])
    },

    async getByConnectorInstanceId(connectorInstanceId: string): Promise<ConnectorScheduleSummary | null> {
      const [row] = await database
        .select()
        .from(connectorSchedules)
        .where(and(
          eq(connectorSchedules.connectorInstanceId, connectorInstanceId),
          isNull(connectorSchedules.deletedAt),
        ))
        .limit(1)

      if (!row) {
        return null
      }

      return mapScheduleSummary(database, row)
    },

    async getOccurrenceLinkForRun(connectorRunId: string): Promise<ConnectorScheduleOccurrenceSummary | null> {
      const [row] = await database
        .select()
        .from(connectorScheduleOccurrences)
        .where(eq(connectorScheduleOccurrences.connectorRunId, connectorRunId))
        .orderBy(desc(connectorScheduleOccurrences.createdAt), desc(connectorScheduleOccurrences.id))
        .limit(1)
      if (!row) {
        return null
      }
      return mapOccurrenceSummary(row)
    },

    async getRevisionSnapshot(revision: string): Promise<ConnectorScheduleRevisionSnapshot | null> {
      const [row] = await database
        .select()
        .from(connectorScheduleRevisions)
        .where(eq(connectorScheduleRevisions.revision, revision))
        .limit(1)
      return row ? mapRevisionSnapshot(row) : null
    },

    async listRevisionSnapshots(scheduleId: string): Promise<ConnectorScheduleRevisionSnapshot[]> {
      const rows = await database
        .select()
        .from(connectorScheduleRevisions)
        .where(eq(connectorScheduleRevisions.scheduleId, scheduleId))
        .orderBy(asc(connectorScheduleRevisions.createdAt), asc(connectorScheduleRevisions.revision))
      return rows.map(mapRevisionSnapshot)
    },

    async create(input: {
      connectorInstanceId: string
      state: ConnectorScheduleState
      cadence: ConnectorScheduleCadence
      timezone: string
    }): Promise<ConnectorScheduleSummary> {
      const [instance] = await database
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(and(
          eq(connectorInstances.id, input.connectorInstanceId),
          isNull(connectorInstances.deletedAt),
        ))
        .limit(1)

      if (!instance) {
        throw Object.assign(new Error(`Connector instance not found: ${input.connectorInstanceId}`), {
          statusCode: 404,
        })
      }

      const existing = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (existing) {
        throw createConnectorScheduleError(
          'stale_schedule_revision',
          'A schedule already exists for this connector instance',
        )
      }

      const clock = now()
      const createdAt = clock.toISOString()
      const revision = randomUUID()
      const scheduleId = randomUUID()
      const nextEligibleAt = computeNextEligibleAt({
        cadence: input.cadence,
        now: clock,
        timezone: input.timezone,
      })
      const eventId = randomUUID()

      try {
        await database.transaction(async (tx) => {
          const [inserted] = await tx.insert(connectorSchedules).values({
            id: scheduleId,
            connectorInstanceId: input.connectorInstanceId,
            revision,
            state: input.state,
            cadenceJson: JSON.stringify(input.cadence),
            timezone: input.timezone,
            nextEligibleAt,
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          }).returning({ id: connectorSchedules.id })
          if (!inserted) throw new Error('Failed to create connector schedule')

          await insertRevisionSnapshot(tx, {
            revision,
            scheduleId,
            state: input.state,
            cadence: input.cadence,
            timezone: input.timezone,
            createdAt,
          })

          await tx.insert(connectorScheduleEvents).values({
            id: eventId,
            scheduleId,
            actorClass: 'user',
            action: 'upserted',
            revision,
            at: createdAt,
          })
        })
      } catch (error) {
        if (isPostgresUniqueViolation(error)) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'A schedule already exists for this connector instance',
          )
        }
        throw error
      }

      const created = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!created) {
        throw new Error('Failed to read created connector schedule')
      }
      return created
    },

    async update(input: {
      connectorInstanceId: string
      expectedRevision: string
      state: ConnectorScheduleState
      cadence: ConnectorScheduleCadence
      timezone: string
    }): Promise<ConnectorScheduleSummary> {
      const existing = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!existing || existing.revision !== input.expectedRevision) {
        throw createConnectorScheduleError(
          'stale_schedule_revision',
          'Schedule revision does not match the expected revision',
        )
      }

      const clock = now()
      const updatedAt = clock.toISOString()
      const revision = randomUUID()
      const nextEligibleAt = computeNextEligibleAt({
        cadence: input.cadence,
        now: clock,
        timezone: input.timezone,
      })

      await database.transaction(async (tx) => {
        const [updated] = await tx.update(connectorSchedules).set({
          revision,
          state: input.state,
          cadenceJson: JSON.stringify(input.cadence),
          timezone: input.timezone,
          nextEligibleAt,
          updatedAt,
        }).where(and(
          eq(connectorSchedules.id, existing.id),
          eq(connectorSchedules.revision, input.expectedRevision),
          isNull(connectorSchedules.deletedAt),
        )).returning({ id: connectorSchedules.id })

        if (!updated) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        await tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'upserted',
          revision,
          at: updatedAt,
        })

        await insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: input.state,
          cadence: input.cadence,
          timezone: input.timezone,
          createdAt: updatedAt,
        })
      })

      const summary = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!summary) {
        throw new Error('Failed to read updated connector schedule')
      }
      return summary
    },

    async pause(input: {
      connectorInstanceId: string
      expectedRevision: string
    }): Promise<ConnectorScheduleSummary> {
      const existing = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!existing || existing.revision !== input.expectedRevision) {
        throw createConnectorScheduleError(
          'stale_schedule_revision',
          'Schedule revision does not match the expected revision',
        )
      }

      const clock = now()
      const updatedAt = clock.toISOString()
      const revision = randomUUID()

      await database.transaction(async (tx) => {
        const [updated] = await tx.update(connectorSchedules).set({
          revision,
          state: 'paused',
          updatedAt,
        }).where(and(
          eq(connectorSchedules.id, existing.id),
          eq(connectorSchedules.revision, input.expectedRevision),
          isNull(connectorSchedules.deletedAt),
        )).returning({ id: connectorSchedules.id })

        if (!updated) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        await insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: 'paused',
          cadence: existing.cadence,
          timezone: existing.timezone,
          createdAt: updatedAt,
        })

        await tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'paused',
          revision,
          at: updatedAt,
        })
      })

      const summary = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!summary) {
        throw new Error('Failed to read paused connector schedule')
      }
      return summary
    },

    async resume(input: {
      connectorInstanceId: string
      expectedRevision: string
    }): Promise<ConnectorScheduleSummary> {
      const existing = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!existing || existing.revision !== input.expectedRevision) {
        throw createConnectorScheduleError(
          'stale_schedule_revision',
          'Schedule revision does not match the expected revision',
        )
      }

      const clock = now()
      const updatedAt = clock.toISOString()
      const revision = randomUUID()
      const nextEligibleAt = computeNextEligibleAt({
        cadence: existing.cadence,
        now: clock,
        timezone: existing.timezone,
      })

      await database.transaction(async (tx) => {
        const [updated] = await tx.update(connectorSchedules).set({
          revision,
          state: 'enabled',
          nextEligibleAt,
          updatedAt,
        }).where(and(
          eq(connectorSchedules.id, existing.id),
          eq(connectorSchedules.revision, input.expectedRevision),
          isNull(connectorSchedules.deletedAt),
        )).returning({ id: connectorSchedules.id })

        if (!updated) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        await insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: 'enabled',
          cadence: existing.cadence,
          timezone: existing.timezone,
          createdAt: updatedAt,
        })

        await tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'resumed',
          revision,
          at: updatedAt,
        })
      })

      const summary = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!summary) {
        throw new Error('Failed to read resumed connector schedule')
      }
      return summary
    },

    async delete(input: {
      connectorInstanceId: string
      expectedRevision: string
    }): Promise<void> {
      const existing = await this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!existing || existing.revision !== input.expectedRevision) {
        throw createConnectorScheduleError(
          'stale_schedule_revision',
          'Schedule revision does not match the expected revision',
        )
      }

      const clock = now()
      const deletedAt = clock.toISOString()
      const revision = randomUUID()

      await database.transaction(async (tx) => {
        const [updated] = await tx.update(connectorSchedules).set({
          revision,
          updatedAt: deletedAt,
          deletedAt,
        }).where(and(
          eq(connectorSchedules.id, existing.id),
          eq(connectorSchedules.revision, input.expectedRevision),
          isNull(connectorSchedules.deletedAt),
        )).returning({ id: connectorSchedules.id })

        if (!updated) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        await insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: existing.state,
          cadence: existing.cadence,
          timezone: existing.timezone,
          createdAt: deletedAt,
        })

        await tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'deleted',
          revision,
          at: deletedAt,
        })
      })
    },

    async listAudit(input: {
      connectorInstanceId: string
      limit: number
      offset: number
    }): Promise<ConnectorScheduleAuditListResult> {
      const scheduleIds = (await database
        .select({ id: connectorSchedules.id })
        .from(connectorSchedules)
        .where(eq(connectorSchedules.connectorInstanceId, input.connectorInstanceId))
        .orderBy(asc(connectorSchedules.id)))
        .map((row) => row.id)

      if (scheduleIds.length === 0) {
        return {
          items: [],
          total: 0,
          limit: input.limit,
          offset: input.offset,
          hasMore: false,
        }
      }

      const [totalRow] = await database
        .select({ value: count() })
        .from(connectorScheduleEvents)
        .where(inArray(connectorScheduleEvents.scheduleId, scheduleIds))
      const rows = await database
        .select()
        .from(connectorScheduleEvents)
        .where(inArray(connectorScheduleEvents.scheduleId, scheduleIds))
        .orderBy(desc(connectorScheduleEvents.at), desc(connectorScheduleEvents.id))
        .limit(input.limit)
        .offset(input.offset)

      const items = rows.map((row) => ({
        id: row.id,
        scheduleId: row.scheduleId,
        actorClass: row.actorClass as ConnectorScheduleAuditEvent['actorClass'],
        action: row.action as ConnectorScheduleAuditEvent['action'],
        revision: row.revision,
        at: row.at,
      }))

      return {
        items,
        total: totalRow?.value ?? 0,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + items.length < (totalRow?.value ?? 0),
      }
    },

    async markOccurrenceOutcome(input: {
      occurrenceId: string
      outcome: ConnectorScheduleOccurrenceSummary['outcome']
    }): Promise<ConnectorScheduleOccurrenceSummary> {
      const [existing] = await database
        .select()
        .from(connectorScheduleOccurrences)
        .where(eq(connectorScheduleOccurrences.id, input.occurrenceId))
        .limit(1)

      if (!existing) {
        throw new Error(`Schedule occurrence not found: ${input.occurrenceId}`)
      }

      if (existing.outcome !== input.outcome) {
        const [updated] = await database
          .update(connectorScheduleOccurrences)
          .set({ outcome: input.outcome })
          .where(eq(connectorScheduleOccurrences.id, input.occurrenceId))
          .returning()
        if (!updated) throw new Error(`Schedule occurrence not found: ${input.occurrenceId}`)
        return mapOccurrenceSummary(updated)
      }

      return mapOccurrenceSummary(existing)
    },

    async listOccurrences(input: {
      connectorInstanceId: string
      limit: number
      offset: number
    }): Promise<ConnectorScheduleOccurrenceListResult> {
      const scheduleIds = (await database
        .select({ id: connectorSchedules.id })
        .from(connectorSchedules)
        .where(eq(connectorSchedules.connectorInstanceId, input.connectorInstanceId))
        .orderBy(asc(connectorSchedules.id)))
        .map((row) => row.id)

      if (scheduleIds.length === 0) {
        return {
          items: [],
          total: 0,
          limit: input.limit,
          offset: input.offset,
          hasMore: false,
        }
      }

      const [totalRow] = await database
        .select({ value: count() })
        .from(connectorScheduleOccurrences)
        .where(inArray(connectorScheduleOccurrences.scheduleId, scheduleIds))
      const rows = await database
        .select()
        .from(connectorScheduleOccurrences)
        .where(inArray(connectorScheduleOccurrences.scheduleId, scheduleIds))
        .orderBy(
          desc(connectorScheduleOccurrences.createdAt),
          desc(connectorScheduleOccurrences.id),
        )
        .limit(input.limit)
        .offset(input.offset)

      const items = rows.map(mapOccurrenceSummary)

      return {
        items,
        total: totalRow?.value ?? 0,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + items.length < (totalRow?.value ?? 0),
      }
    },
  }
}

async function mapScheduleSummary(
  database: PgliteDatabase,
  row: {
    id: string
    connectorInstanceId: string
    revision: string
    state: string
    cadenceJson: string
    timezone: string
    nextEligibleAt: string
    createdAt: string
    updatedAt: string
  },
): Promise<ConnectorScheduleSummary> {
  const [lastOccurrenceRow] = await database
    .select()
    .from(connectorScheduleOccurrences)
    .where(eq(connectorScheduleOccurrences.scheduleId, row.id))
    .orderBy(desc(connectorScheduleOccurrences.createdAt), desc(connectorScheduleOccurrences.id))
    .limit(1)

  const lastOccurrence = lastOccurrenceRow ? mapOccurrenceSummary(lastOccurrenceRow) : null
  const lastRunRow = lastOccurrenceRow?.connectorRunId
    ? (await database
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.id, lastOccurrenceRow.connectorRunId))
      .limit(1))[0]
    : null

  return {
    id: row.id,
    connectorInstanceId: row.connectorInstanceId,
    revision: row.revision,
    state: row.state as ConnectorScheduleState,
    cadence: JSON.parse(row.cadenceJson) as ConnectorScheduleCadence,
    timezone: row.timezone,
    nextEligibleAt: row.nextEligibleAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastOccurrence,
    lastRun: lastRunRow
      ? {
        id: lastRunRow.id,
        status: lastRunRow.status as ConnectorScheduleLastRunSummary['status'],
        mode: lastRunRow.mode as ConnectorScheduleLastRunSummary['mode'],
        startedAt: lastRunRow.startedAt,
        completedAt: lastRunRow.completedAt,
      }
      : null,
  }
}

function mapOccurrenceSummary(row: {
  id: string
  scheduleId: string
  scheduleRevision: string
  nominalAt: string
  idempotencyKey: string
  admittedMode: string
  outcome: string
  connectorRunId: string | null
  createdAt: string
}): ConnectorScheduleOccurrenceSummary {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    scheduleRevision: row.scheduleRevision,
    nominalAt: row.nominalAt,
    idempotencyKey: row.idempotencyKey,
    admittedMode: row.admittedMode as ConnectorScheduleOccurrenceSummary['admittedMode'],
    outcome: row.outcome as ConnectorScheduleOccurrenceSummary['outcome'],
    connectorRunId: row.connectorRunId,
    createdAt: row.createdAt,
  }
}

export type ConnectorScheduleRevisionSnapshot = {
  revision: string
  scheduleId: string
  state: ConnectorScheduleState
  cadence: ConnectorScheduleCadence
  timezone: string
  createdAt: string
}

function mapRevisionSnapshot(row: {
  revision: string
  scheduleId: string
  state: string
  cadenceJson: string
  timezone: string
  createdAt: string
}): ConnectorScheduleRevisionSnapshot {
  return {
    revision: row.revision,
    scheduleId: row.scheduleId,
    state: row.state as ConnectorScheduleState,
    cadence: JSON.parse(row.cadenceJson) as ConnectorScheduleCadence,
    timezone: row.timezone,
    createdAt: row.createdAt,
  }
}

async function insertRevisionSnapshot(
  tx: {
    insert: PgliteDatabase['insert']
  },
  input: {
    revision: string
    scheduleId: string
    state: ConnectorScheduleState
    cadence: ConnectorScheduleCadence
    timezone: string
    createdAt: string
  },
): Promise<void> {
  await tx.insert(connectorScheduleRevisions).values({
    revision: input.revision,
    scheduleId: input.scheduleId,
    state: input.state,
    cadenceJson: JSON.stringify(input.cadence),
    timezone: input.timezone,
    createdAt: input.createdAt,
  })
}

function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const cause = 'cause' in error ? error.cause : null
  return Boolean(
    cause
    && typeof cause === 'object'
    && 'code' in cause
    && cause.code === '23505'
    && 'constraint' in cause
    && cause.constraint === 'idx_connector_schedules_instance',
  )
}
