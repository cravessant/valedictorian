import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import {
  connectorScheduleOccurrenceIdempotencyKey,
  type ConnectorScheduleAdmittedMode,
  type ConnectorScheduleLastRunSummary,
  type ConnectorScheduleOccurrenceSummary,
  type DispatchConnectorScheduleDueResult,
} from 'sparxie'
import {
  connectorInstances,
  connectorRuns,
  connectorScheduleEvents,
  connectorScheduleOccurrences,
  connectorSchedules,
} from '../../db/schema.connectors'
import type { DrizzleDatabase } from '../../db/sqlite'
import { computeNextEligibleAt, resolveMissedNominals } from './connector-schedule.eligibility'
import { createConnectorScheduleError } from './connector-schedule.errors'

export function admitConnectorScheduleDue({
  database,
  now,
  maximumCatchUpAgeMinutes,
  input,
}: {
  database: DrizzleDatabase
  now: () => Date
  maximumCatchUpAgeMinutes: number
  input: {
    connectorInstanceId: string
    expectedRevision: string
  }
}): DispatchConnectorScheduleDueResult {
  return database.transaction((tx) => {
    const scheduleRow = tx
      .select()
      .from(connectorSchedules)
      .where(and(
        eq(connectorSchedules.connectorInstanceId, input.connectorInstanceId),
        isNull(connectorSchedules.deletedAt),
      ))
      .get()

    if (!scheduleRow || scheduleRow.revision !== input.expectedRevision) {
      throw createConnectorScheduleError(
        'stale_schedule_revision',
        'Schedule revision does not match the expected revision',
      )
    }

    if (scheduleRow.state === 'paused') {
      return { status: 'paused' }
    }

    const instance = tx
      .select()
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

    if (!instance.enabled) {
      return { status: 'connector_disabled' }
    }

    const clock = now()
    const clockIso = clock.toISOString()

    const unresolvedAdmitted = findUnresolvedAdmittedOccurrence(tx, {
      scheduleId: scheduleRow.id,
    })
    if (unresolvedAdmitted) {
      return {
        status: 'admitted',
        occurrence: mapOccurrence(unresolvedAdmitted.occurrence),
        run: mapLastRun(unresolvedAdmitted.run),
      } as DispatchConnectorScheduleDueResult
    }

    if (Date.parse(scheduleRow.nextEligibleAt) > clock.getTime()) {
      const priorOccurrence = tx
        .select()
        .from(connectorScheduleOccurrences)
        .where(and(
          eq(connectorScheduleOccurrences.scheduleId, scheduleRow.id),
          eq(connectorScheduleOccurrences.scheduleRevision, scheduleRow.revision),
        ))
        .orderBy(desc(connectorScheduleOccurrences.createdAt))
        .get()

      if (
        priorOccurrence?.connectorRunId
        && Date.parse(priorOccurrence.nominalAt) <= clock.getTime()
        && Date.parse(priorOccurrence.nominalAt) < Date.parse(scheduleRow.nextEligibleAt)
      ) {
        const priorRun = tx
          .select()
          .from(connectorRuns)
          .where(eq(connectorRuns.id, priorOccurrence.connectorRunId))
          .get()
        if (priorRun) {
          return {
            status: 'admitted',
            occurrence: mapOccurrence(priorOccurrence),
            run: mapLastRun(priorRun),
          } as DispatchConnectorScheduleDueResult
        }
      }

      return {
        status: 'not_due',
        nextEligibleAt: scheduleRow.nextEligibleAt,
      }
    }

    const activeRun = tx
      .select({ id: connectorRuns.id })
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.connectorInstanceId, input.connectorInstanceId),
        inArray(connectorRuns.status, ['queued', 'running']),
        isNull(connectorRuns.deletedAt),
      ))
      .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt))
      .get()

    if (activeRun) {
      return {
        status: 'deferred_active',
        activeRunId: activeRun.id,
      }
    }

    const cadence = JSON.parse(scheduleRow.cadenceJson) as Parameters<typeof computeNextEligibleAt>[0]['cadence']
    const resolved = resolveMissedNominals({
      cadence,
      nextEligibleAt: scheduleRow.nextEligibleAt,
      now: clock,
      maximumCatchUpAgeMinutes,
      timezone: scheduleRow.timezone,
    })

    if (resolved.inHorizon.length === 0) {
      const updated = tx.update(connectorSchedules).set({
        nextEligibleAt: resolved.futureEligibleAt,
        updatedAt: clockIso,
      }).where(and(
        eq(connectorSchedules.id, scheduleRow.id),
        eq(connectorSchedules.revision, input.expectedRevision),
        isNull(connectorSchedules.deletedAt),
      )).run()

      if (updated.changes !== 1) {
        throw createConnectorScheduleError(
          'schedule_dispatch_conflict',
          'Schedule changed during due dispatch',
        )
      }

      return {
        status: 'not_due',
        nextEligibleAt: resolved.futureEligibleAt,
      }
    }

    const nominalAt = resolved.inHorizon[resolved.inHorizon.length - 1]!
    const admittedMode: ConnectorScheduleAdmittedMode = resolved.missed.length === 1
      ? 'scheduled'
      : 'catch_up'
    const idempotencyKey = connectorScheduleOccurrenceIdempotencyKey(
      scheduleRow.revision,
      nominalAt,
    )

    const existingOccurrence = tx
      .select()
      .from(connectorScheduleOccurrences)
      .where(eq(connectorScheduleOccurrences.idempotencyKey, idempotencyKey))
      .get()

    if (existingOccurrence?.connectorRunId) {
      const existingRun = tx
        .select()
        .from(connectorRuns)
        .where(eq(connectorRuns.id, existingOccurrence.connectorRunId))
        .get()
      if (existingRun) {
        return {
          status: 'admitted',
          occurrence: mapOccurrence(existingOccurrence),
          run: mapLastRun(existingRun),
        } as DispatchConnectorScheduleDueResult
      }
    }

    const nextEligibleAt = resolved.futureEligibleAt
    const occurrenceId = randomUUID()
    const runId = randomUUID()
    const revisionAfter = scheduleRow.revision

    const updated = tx.update(connectorSchedules).set({
      nextEligibleAt,
      updatedAt: clockIso,
    }).where(and(
      eq(connectorSchedules.id, scheduleRow.id),
      eq(connectorSchedules.revision, input.expectedRevision),
      isNull(connectorSchedules.deletedAt),
    )).run()

    if (updated.changes !== 1) {
      throw createConnectorScheduleError(
        'schedule_dispatch_conflict',
        'Schedule changed during due dispatch',
      )
    }

    tx.insert(connectorRuns).values({
      id: runId,
      executionScopeId: instance.executionScopeId,
      connectorInstanceId: input.connectorInstanceId,
      mode: admittedMode,
      status: 'queued',
      startedAt: clockIso,
      completedAt: null,
      coverageStartedAt: null,
      coverageEndedAt: clockIso,
      configJson: instance.configJson,
      filtersJson: instance.filtersJson,
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      statsJson: JSON.stringify({}),
      warningsJson: JSON.stringify([]),
      retryHintsJson: JSON.stringify(null),
      createdAt: clockIso,
      updatedAt: clockIso,
      deletedAt: null,
    }).run()

    tx.insert(connectorScheduleOccurrences).values({
      id: occurrenceId,
      scheduleId: scheduleRow.id,
      scheduleRevision: scheduleRow.revision,
      nominalAt,
      idempotencyKey,
      admittedMode,
      outcome: 'admitted',
      connectorRunId: runId,
      createdAt: clockIso,
    }).run()

    tx.insert(connectorScheduleEvents).values({
      id: randomUUID(),
      scheduleId: scheduleRow.id,
      actorClass: 'scheduler',
      action: 'dispatched',
      revision: revisionAfter,
      at: clockIso,
    }).run()

    return {
      status: 'admitted',
      occurrence: {
        id: occurrenceId,
        scheduleId: scheduleRow.id,
        scheduleRevision: scheduleRow.revision,
        nominalAt,
        idempotencyKey,
        admittedMode,
        outcome: 'admitted',
        connectorRunId: runId,
        createdAt: clockIso,
      },
      run: {
        id: runId,
        status: 'queued',
        mode: admittedMode,
        startedAt: clockIso,
        completedAt: null,
      },
    } as DispatchConnectorScheduleDueResult
  })
}

function findUnresolvedAdmittedOccurrence(
  tx: {
    select: DrizzleDatabase['select']
  },
  input: { scheduleId: string },
): {
  occurrence: typeof connectorScheduleOccurrences.$inferSelect
  run: typeof connectorRuns.$inferSelect
} | null {
  const occurrence = tx
    .select()
    .from(connectorScheduleOccurrences)
    .where(and(
      eq(connectorScheduleOccurrences.scheduleId, input.scheduleId),
      eq(connectorScheduleOccurrences.outcome, 'admitted'),
    ))
    .orderBy(desc(connectorScheduleOccurrences.createdAt))
    .get()

  if (!occurrence?.connectorRunId) {
    return null
  }

  const run = tx
    .select()
    .from(connectorRuns)
    .where(and(
      eq(connectorRuns.id, occurrence.connectorRunId),
      isNull(connectorRuns.deletedAt),
    ))
    .get()

  if (!run) {
    return null
  }

  return { occurrence, run }
}

function mapOccurrence(row: {
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

function mapLastRun(row: {
  id: string
  status: string
  mode: string
  startedAt: string
  completedAt: string | null
}): ConnectorScheduleLastRunSummary {
  return {
    id: row.id,
    status: row.status as ConnectorScheduleLastRunSummary['status'],
    mode: row.mode as ConnectorScheduleLastRunSummary['mode'],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}
