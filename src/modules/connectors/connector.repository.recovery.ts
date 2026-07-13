import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  connectorRuns,
  connectorScheduleOccurrences,
  retryWork,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  readConnectorWarnings,
} from './connector-run.persistence'
import { toJsonRecord } from './connector.persistence-json'
import type { RecoverInterruptedConnectorRunsInput } from './connector-run.persistence-types'
import { occurrenceOutcomeForRunStatus } from './connector-schedule.occurrence-outcome'

export function recoverInterruptedConnectorRuns(
  database: DrizzleDatabase,
  input: RecoverInterruptedConnectorRunsInput,
): number {
  return database.transaction((transaction) => {
    const interruptedRuns = transaction
      .select()
      .from(connectorRuns)
      .where(
        and(
          inArray(connectorRuns.status, ['queued', 'running']),
          isNull(connectorRuns.deletedAt),
        ),
      )
      .all()
    const warning = {
      code: 'connector.interrupted',
      message: 'Connector run was interrupted before completion.',
    }

    let recovered = 0
    for (const run of interruptedRuns) {
      if (shouldPreserveAdmittedScheduleQueuedRun(transaction, run)) {
        continue
      }

      const stats = toJsonRecord(JSON.parse(run.statsJson))
      const warnings = readConnectorWarnings(run.warningsJson)
      warnings.push(warning)

      transaction
        .update(connectorRuns)
        .set({
          status: 'cancelled',
          completedAt: input.completedAt,
          warningCount: warnings.length,
          statsJson: JSON.stringify({
            ...stats,
            interrupted: true,
            queued: false,
            running: false,
          }),
          warningsJson: JSON.stringify(warnings),
          retryHintsJson: JSON.stringify(null),
          updatedAt: input.completedAt,
        })
        .where(eq(connectorRuns.id, run.id))
        .run()
      transaction.update(retryWork).set({
        state: 'scheduled', acquiredAt: null,
        acquisitionToken: null, acquisitionRunId: null, updatedAt: input.completedAt,
      }).where(and(
        eq(retryWork.state, 'acquired'),
        eq(retryWork.acquisitionRunId, run.id),
        isNull(retryWork.deletedAt),
      )).run()
      recovered += 1
    }

    reconcileAdmittedOccurrencesWithTerminalRuns(transaction)

    return recovered
  }, { behavior: 'immediate' })
}

function reconcileAdmittedOccurrencesWithTerminalRuns(
  transaction: {
    select: DrizzleDatabase['select']
    update: DrizzleDatabase['update']
  },
): void {
  const admittedOccurrences = transaction
    .select()
    .from(connectorScheduleOccurrences)
    .where(eq(connectorScheduleOccurrences.outcome, 'admitted'))
    .all()

  for (const occurrence of admittedOccurrences) {
    if (!occurrence.connectorRunId) {
      continue
    }

    const run = transaction
      .select({
        id: connectorRuns.id,
        status: connectorRuns.status,
      })
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.id, occurrence.connectorRunId),
        isNull(connectorRuns.deletedAt),
      ))
      .get()

    if (!run) {
      continue
    }

    const outcome = occurrenceOutcomeForRunStatus(run.status)
    if (outcome === 'admitted') {
      continue
    }

    transaction
      .update(connectorScheduleOccurrences)
      .set({ outcome })
      .where(and(
        eq(connectorScheduleOccurrences.id, occurrence.id),
        eq(connectorScheduleOccurrences.outcome, 'admitted'),
      ))
      .run()
  }
}

function shouldPreserveAdmittedScheduleQueuedRun(
  transaction: {
    select: DrizzleDatabase['select']
  },
  run: {
    id: string
    mode: string
    status: string
  },
): boolean {
  if (run.status !== 'queued') {
    return false
  }
  if (run.mode !== 'scheduled' && run.mode !== 'catch_up') {
    return false
  }

  const occurrence = transaction
    .select({
      id: connectorScheduleOccurrences.id,
      admittedMode: connectorScheduleOccurrences.admittedMode,
      outcome: connectorScheduleOccurrences.outcome,
      connectorRunId: connectorScheduleOccurrences.connectorRunId,
    })
    .from(connectorScheduleOccurrences)
    .where(eq(connectorScheduleOccurrences.connectorRunId, run.id))
    .get()

  return Boolean(
    occurrence
    && occurrence.outcome === 'admitted'
    && occurrence.admittedMode === run.mode
    && occurrence.connectorRunId === run.id,
  )
}
