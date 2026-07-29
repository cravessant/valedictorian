import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
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
} from '@sparxie/sdk'
import {
  connectorInstances,
  connectorRuns,
  connectorScheduleEvents,
  connectorScheduleOccurrences,
  connectorScheduleRevisions,
  connectorSchedules,
} from './connector.schema'
import { connectorCaptureWork, sourceExecutionScopes } from '../../db/schema'
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
          connectorInstanceId: connectorCaptureWork.connectorInstanceId,
          nextAttemptAt: connectorCaptureWork.nextEligibleAt,
          scopeBlockedUntil: sourceExecutionScopes.blockedUntil,
        })
        .from(connectorCaptureWork)
        .innerJoin(
          connectorSchedules,
          eq(connectorSchedules.connectorInstanceId, connectorCaptureWork.connectorInstanceId),
        )
        .innerJoin(
          connectorInstances,
          eq(connectorInstances.id, connectorCaptureWork.connectorInstanceId),
        )
        .innerJoin(
          sourceExecutionScopes,
          eq(sourceExecutionScopes.id, connectorInstances.executionScopeId),
        )
        .where(and(
          eq(connectorCaptureWork.status, 'scheduled'),
          isNotNull(connectorCaptureWork.nextEligibleAt),
          eq(connectorSchedules.state, 'enabled'),
          isNull(connectorSchedules.deletedAt),
          eq(connectorInstances.enabled, true),
          isNull(connectorInstances.deletedAt),
          inArray(sourceExecutionScopes.status, ['available', 'cooldown']),
        ))
        .orderBy(asc(connectorCaptureWork.nextEligibleAt), asc(connectorCaptureWork.connectorInstanceId))
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
      const result = await database.$client.query<ScheduleAuditPageRow>(AUDIT_PAGE_QUERY, [
        input.connectorInstanceId,
        input.limit,
        input.offset,
      ])
      const total = Number(result.rows[0]?.total ?? 0)
      const items = result.rows.flatMap((row) => row.id ? [{
        id: row.id,
        scheduleId: row.schedule_id!,
        actorClass: row.actor_class as ConnectorScheduleAuditEvent['actorClass'],
        action: row.action as ConnectorScheduleAuditEvent['action'],
        revision: row.revision!,
        at: row.at!,
      }] : [])

      return {
        items,
        total,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + items.length < total,
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
      const result = await database.$client.query<ScheduleOccurrencePageRow>(
        OCCURRENCE_PAGE_QUERY,
        [input.connectorInstanceId, input.limit, input.offset],
      )
      const total = Number(result.rows[0]?.total ?? 0)
      const items = result.rows.flatMap((row) => row.id ? [mapOccurrenceSummary({
        id: row.id,
        scheduleId: row.schedule_id!,
        scheduleRevision: row.schedule_revision!,
        nominalAt: row.nominal_at!,
        idempotencyKey: row.idempotency_key!,
        admittedMode: row.admitted_mode!,
        outcome: row.outcome!,
        connectorRunId: row.connector_run_id,
        createdAt: row.created_at!,
      })] : [])

      return {
        items,
        total,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + items.length < total,
      }
    },
  }
}

interface ScheduleAuditPageRow {
  total: number
  id: string | null
  schedule_id: string | null
  actor_class: string | null
  action: string | null
  revision: string | null
  at: string | null
}

interface ScheduleOccurrencePageRow {
  total: number
  id: string | null
  schedule_id: string | null
  schedule_revision: string | null
  nominal_at: string | null
  idempotency_key: string | null
  admitted_mode: string | null
  outcome: string | null
  connector_run_id: string | null
  created_at: string | null
}

const AUDIT_PAGE_QUERY = `
with eligible as (
  select event.*
  from connector_schedule_events event
  where event.schedule_id in (
    select schedule.id from connector_schedules schedule
    where schedule.connector_instance_id = $1
  )
), page as (
  select * from eligible
  order by at desc, id desc
  limit $2 offset $3
), total as (
  select count(*)::integer as value from eligible
)
select total.value as total, page.*
from total left join page on true
order by page.at desc nulls last, page.id desc nulls last`

const OCCURRENCE_PAGE_QUERY = `
with eligible as (
  select occurrence.*
  from connector_schedule_occurrences occurrence
  where occurrence.schedule_id in (
    select schedule.id from connector_schedules schedule
    where schedule.connector_instance_id = $1
  )
), page as (
  select * from eligible
  order by created_at desc, id desc
  limit $2 offset $3
), total as (
  select count(*)::integer as value from eligible
)
select total.value as total, page.*
from total left join page on true
order by page.created_at desc nulls last, page.id desc nulls last`

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
