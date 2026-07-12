import { and, desc, eq, isNull } from 'drizzle-orm'
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
import type { DrizzleDatabase } from '../../db/sqlite'
import { computeNextEligibleAt } from './connector-schedule.eligibility'
import { createConnectorScheduleError } from './connector-schedule.errors'

export function createConnectorScheduleRepository(
  database: DrizzleDatabase,
  now: () => Date = () => new Date(),
) {
  return {
    getByConnectorInstanceId(connectorInstanceId: string): ConnectorScheduleSummary | null {
      const row = database
        .select()
        .from(connectorSchedules)
        .where(and(
          eq(connectorSchedules.connectorInstanceId, connectorInstanceId),
          isNull(connectorSchedules.deletedAt),
        ))
        .get()

      if (!row) {
        return null
      }

      return mapScheduleSummary(database, row)
    },

    getOccurrenceLinkForRun(connectorRunId: string): ConnectorScheduleOccurrenceSummary | null {
      const row = database
        .select()
        .from(connectorScheduleOccurrences)
        .where(eq(connectorScheduleOccurrences.connectorRunId, connectorRunId))
        .get()
      if (!row) {
        return null
      }
      return mapOccurrenceSummary(row)
    },

    getRevisionSnapshot(revision: string): ConnectorScheduleRevisionSnapshot | null {
      const row = database
        .select()
        .from(connectorScheduleRevisions)
        .where(eq(connectorScheduleRevisions.revision, revision))
        .get()
      return row ? mapRevisionSnapshot(row) : null
    },

    listRevisionSnapshots(scheduleId: string): ConnectorScheduleRevisionSnapshot[] {
      return database
        .select()
        .from(connectorScheduleRevisions)
        .where(eq(connectorScheduleRevisions.scheduleId, scheduleId))
        .all()
        .sort((left, right) => (
          left.createdAt.localeCompare(right.createdAt)
          || left.revision.localeCompare(right.revision)
        ))
        .map(mapRevisionSnapshot)
    },

    create(input: {
      connectorInstanceId: string
      state: ConnectorScheduleState
      cadence: ConnectorScheduleCadence
      timezone: string
    }): ConnectorScheduleSummary {
      const instance = database
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(and(
          eq(connectorInstances.id, input.connectorInstanceId),
          isNull(connectorInstances.deletedAt),
        ))
        .get()

      if (!instance) {
        throw Object.assign(new Error(`Connector instance not found: ${input.connectorInstanceId}`), {
          statusCode: 404,
        })
      }

      const existing = this.getByConnectorInstanceId(input.connectorInstanceId)
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

      database.transaction((tx) => {
        tx.insert(connectorSchedules).values({
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
        }).run()

        insertRevisionSnapshot(tx, {
          revision,
          scheduleId,
          state: input.state,
          cadence: input.cadence,
          timezone: input.timezone,
          createdAt,
        })

        tx.insert(connectorScheduleEvents).values({
          id: eventId,
          scheduleId,
          actorClass: 'user',
          action: 'upserted',
          revision,
          at: createdAt,
        }).run()
      })

      const created = this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!created) {
        throw new Error('Failed to read created connector schedule')
      }
      return created
    },

    update(input: {
      connectorInstanceId: string
      expectedRevision: string
      state: ConnectorScheduleState
      cadence: ConnectorScheduleCadence
      timezone: string
    }): ConnectorScheduleSummary {
      const existing = this.getByConnectorInstanceId(input.connectorInstanceId)
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

      database.transaction((tx) => {
        const updated = tx.update(connectorSchedules).set({
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
        )).run()

        if (updated.changes !== 1) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'upserted',
          revision,
          at: updatedAt,
        }).run()

        insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: input.state,
          cadence: input.cadence,
          timezone: input.timezone,
          createdAt: updatedAt,
        })
      })

      const summary = this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!summary) {
        throw new Error('Failed to read updated connector schedule')
      }
      return summary
    },

    pause(input: {
      connectorInstanceId: string
      expectedRevision: string
    }): ConnectorScheduleSummary {
      const existing = this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!existing || existing.revision !== input.expectedRevision) {
        throw createConnectorScheduleError(
          'stale_schedule_revision',
          'Schedule revision does not match the expected revision',
        )
      }

      const clock = now()
      const updatedAt = clock.toISOString()
      const revision = randomUUID()

      database.transaction((tx) => {
        const updated = tx.update(connectorSchedules).set({
          revision,
          state: 'paused',
          updatedAt,
        }).where(and(
          eq(connectorSchedules.id, existing.id),
          eq(connectorSchedules.revision, input.expectedRevision),
          isNull(connectorSchedules.deletedAt),
        )).run()

        if (updated.changes !== 1) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: 'paused',
          cadence: existing.cadence,
          timezone: existing.timezone,
          createdAt: updatedAt,
        })

        tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'paused',
          revision,
          at: updatedAt,
        }).run()
      })

      const summary = this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!summary) {
        throw new Error('Failed to read paused connector schedule')
      }
      return summary
    },

    resume(input: {
      connectorInstanceId: string
      expectedRevision: string
    }): ConnectorScheduleSummary {
      const existing = this.getByConnectorInstanceId(input.connectorInstanceId)
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

      database.transaction((tx) => {
        const updated = tx.update(connectorSchedules).set({
          revision,
          state: 'enabled',
          nextEligibleAt,
          updatedAt,
        }).where(and(
          eq(connectorSchedules.id, existing.id),
          eq(connectorSchedules.revision, input.expectedRevision),
          isNull(connectorSchedules.deletedAt),
        )).run()

        if (updated.changes !== 1) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: 'enabled',
          cadence: existing.cadence,
          timezone: existing.timezone,
          createdAt: updatedAt,
        })

        tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'resumed',
          revision,
          at: updatedAt,
        }).run()
      })

      const summary = this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!summary) {
        throw new Error('Failed to read resumed connector schedule')
      }
      return summary
    },

    delete(input: {
      connectorInstanceId: string
      expectedRevision: string
    }): void {
      const existing = this.getByConnectorInstanceId(input.connectorInstanceId)
      if (!existing || existing.revision !== input.expectedRevision) {
        throw createConnectorScheduleError(
          'stale_schedule_revision',
          'Schedule revision does not match the expected revision',
        )
      }

      const clock = now()
      const deletedAt = clock.toISOString()
      const revision = randomUUID()

      database.transaction((tx) => {
        const updated = tx.update(connectorSchedules).set({
          revision,
          updatedAt: deletedAt,
          deletedAt,
        }).where(and(
          eq(connectorSchedules.id, existing.id),
          eq(connectorSchedules.revision, input.expectedRevision),
          isNull(connectorSchedules.deletedAt),
        )).run()

        if (updated.changes !== 1) {
          throw createConnectorScheduleError(
            'stale_schedule_revision',
            'Schedule revision does not match the expected revision',
          )
        }

        insertRevisionSnapshot(tx, {
          revision,
          scheduleId: existing.id,
          state: existing.state,
          cadence: existing.cadence,
          timezone: existing.timezone,
          createdAt: deletedAt,
        })

        tx.insert(connectorScheduleEvents).values({
          id: randomUUID(),
          scheduleId: existing.id,
          actorClass: 'user',
          action: 'deleted',
          revision,
          at: deletedAt,
        }).run()
      })
    },

    listAudit(input: {
      connectorInstanceId: string
      limit: number
      offset: number
    }): ConnectorScheduleAuditListResult {
      const scheduleIds = database
        .select({ id: connectorSchedules.id })
        .from(connectorSchedules)
        .where(eq(connectorSchedules.connectorInstanceId, input.connectorInstanceId))
        .all()
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

      const rows = database
        .select()
        .from(connectorScheduleEvents)
        .all()
        .filter((row) => scheduleIds.includes(row.scheduleId))
        .sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id))

      const items = rows.slice(input.offset, input.offset + input.limit).map((row) => ({
        id: row.id,
        scheduleId: row.scheduleId,
        actorClass: row.actorClass as ConnectorScheduleAuditEvent['actorClass'],
        action: row.action as ConnectorScheduleAuditEvent['action'],
        revision: row.revision,
        at: row.at,
      }))

      return {
        items,
        total: rows.length,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + items.length < rows.length,
      }
    },

    markOccurrenceOutcome(input: {
      occurrenceId: string
      outcome: ConnectorScheduleOccurrenceSummary['outcome']
    }): ConnectorScheduleOccurrenceSummary {
      const existing = database
        .select()
        .from(connectorScheduleOccurrences)
        .where(eq(connectorScheduleOccurrences.id, input.occurrenceId))
        .get()

      if (!existing) {
        throw new Error(`Schedule occurrence not found: ${input.occurrenceId}`)
      }

      if (existing.outcome !== input.outcome) {
        database
          .update(connectorScheduleOccurrences)
          .set({ outcome: input.outcome })
          .where(eq(connectorScheduleOccurrences.id, input.occurrenceId))
          .run()
      }

      return mapOccurrenceSummary(
        database
          .select()
          .from(connectorScheduleOccurrences)
          .where(eq(connectorScheduleOccurrences.id, input.occurrenceId))
          .get()!,
      )
    },

    listOccurrences(input: {
      connectorInstanceId: string
      limit: number
      offset: number
    }): ConnectorScheduleOccurrenceListResult {
      const scheduleIds = database
        .select({ id: connectorSchedules.id })
        .from(connectorSchedules)
        .where(eq(connectorSchedules.connectorInstanceId, input.connectorInstanceId))
        .all()
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

      const rows = database
        .select()
        .from(connectorScheduleOccurrences)
        .all()
        .filter((row) => scheduleIds.includes(row.scheduleId))
        .sort((left, right) => (
          right.createdAt.localeCompare(left.createdAt)
          || right.id.localeCompare(left.id)
        ))

      const items = rows
        .slice(input.offset, input.offset + input.limit)
        .map(mapOccurrenceSummary)

      return {
        items,
        total: rows.length,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + items.length < rows.length,
      }
    },
  }
}

function mapScheduleSummary(
  database: DrizzleDatabase,
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
): ConnectorScheduleSummary {
  const lastOccurrenceRow = database
    .select()
    .from(connectorScheduleOccurrences)
    .where(eq(connectorScheduleOccurrences.scheduleId, row.id))
    .orderBy(desc(connectorScheduleOccurrences.createdAt))
    .get()

  const lastOccurrence = lastOccurrenceRow ? mapOccurrenceSummary(lastOccurrenceRow) : null
  const lastRunRow = lastOccurrenceRow?.connectorRunId
    ? database
      .select()
      .from(connectorRuns)
      .where(eq(connectorRuns.id, lastOccurrenceRow.connectorRunId))
      .get()
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

function insertRevisionSnapshot(
  tx: {
    insert: DrizzleDatabase['insert']
  },
  input: {
    revision: string
    scheduleId: string
    state: ConnectorScheduleState
    cadence: ConnectorScheduleCadence
    timezone: string
    createdAt: string
  },
): void {
  tx.insert(connectorScheduleRevisions).values({
    revision: input.revision,
    scheduleId: input.scheduleId,
    state: input.state,
    cadenceJson: JSON.stringify(input.cadence),
    timezone: input.timezone,
    createdAt: input.createdAt,
  }).run()
}
