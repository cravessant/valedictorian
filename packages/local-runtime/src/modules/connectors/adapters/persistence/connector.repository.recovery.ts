import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  connectorRuns,
  connectorRunSynchronizations,
  connectorScheduleOccurrences,
  connectorCaptureWork,
} from '../../../../db/schema.js'
import type { PgliteDatabase } from '../../../../db/pglite.js'
import {
  persistFrozenConnectorRunLifecycleCounts,
  readConnectorWarnings,
} from './connector-run.persistence.js'
import { toJsonRecord } from '../../ports/connector.json-values.js'
import type { RecoverInterruptedConnectorRunsInput } from '../../ports/connector-run.records.js'
import { occurrenceOutcomeForRunStatus } from '../../core/connector-schedule.occurrence-outcome.js'

export async function recoverInterruptedConnectorRuns(
  database: PgliteDatabase,
  input: RecoverInterruptedConnectorRunsInput,
): Promise<number> {
  return database.transaction(async (transaction) => {
    const interruptedRuns = await transaction
      .select()
      .from(connectorRuns)
      .where(
        and(
          inArray(connectorRuns.status, ['queued', 'running']),
          isNull(connectorRuns.deletedAt),
        ),
      )
    const warning = {
      code: 'connector.interrupted',
      message: 'Connector run was interrupted before completion.',
    }

    let recovered = 0
    for (const run of interruptedRuns) {
      if (await shouldPreserveAdmittedScheduleQueuedRun(transaction, run)) {
        continue
      }

      const stats = toJsonRecord(JSON.parse(run.statsJson))
      const warnings = readConnectorWarnings(run.warningsJson)
      warnings.push(warning)

      await transaction
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
      const [synchronization] = await transaction
        .select({ snapshotJson: connectorRunSynchronizations.snapshotJson })
        .from(connectorRunSynchronizations)
        .where(eq(connectorRunSynchronizations.connectorRunId, run.id))
        .limit(1)
      if (synchronization) {
        const snapshot = toJsonRecord(JSON.parse(synchronization.snapshotJson))
        await transaction.update(connectorRunSynchronizations).set({
          snapshotJson: JSON.stringify({
            ...snapshot,
            outcome: { kind: 'cancelled', reason: 'connector_interrupted' },
          }),
          updatedAt: input.completedAt,
        }).where(eq(connectorRunSynchronizations.connectorRunId, run.id))
      }
      await persistFrozenConnectorRunLifecycleCounts(transaction, run.id, input.completedAt)
      await transaction.update(connectorCaptureWork).set({
        status: 'scheduled', claimedAt: null,
        acquisitionToken: null, acquisitionRunId: null, updatedAt: input.completedAt,
      }).where(and(
        eq(connectorCaptureWork.status, 'claimed'),
        eq(connectorCaptureWork.acquisitionRunId, run.id),
      ))
      recovered += 1
    }

    await reconcileAdmittedOccurrencesWithTerminalRuns(transaction)

    return recovered
  })
}

async function reconcileAdmittedOccurrencesWithTerminalRuns(
  transaction: {
    select: PgliteDatabase['select']
    update: PgliteDatabase['update']
  },
): Promise<void> {
  const admittedOccurrences = await transaction
    .select()
    .from(connectorScheduleOccurrences)
    .where(eq(connectorScheduleOccurrences.outcome, 'admitted'))

  for (const occurrence of admittedOccurrences) {
    if (!occurrence.connectorRunId) {
      continue
    }

    const [run] = await transaction
      .select({
        id: connectorRuns.id,
        status: connectorRuns.status,
      })
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.id, occurrence.connectorRunId),
        isNull(connectorRuns.deletedAt),
      ))
      .limit(1)

    if (!run) {
      continue
    }

    const outcome = occurrenceOutcomeForRunStatus(run.status)
    if (outcome === 'admitted') {
      continue
    }

    await transaction
      .update(connectorScheduleOccurrences)
      .set({ outcome })
      .where(and(
        eq(connectorScheduleOccurrences.id, occurrence.id),
        eq(connectorScheduleOccurrences.outcome, 'admitted'),
      ))
  }
}

async function shouldPreserveAdmittedScheduleQueuedRun(
  transaction: {
    select: PgliteDatabase['select']
  },
  run: {
    id: string
    mode: string
    status: string
  },
): Promise<boolean> {
  if (run.status !== 'queued') {
    return false
  }
  if (run.mode !== 'scheduled' && run.mode !== 'catch_up') {
    return false
  }

  const [occurrence] = await transaction
    .select({
      id: connectorScheduleOccurrences.id,
      admittedMode: connectorScheduleOccurrences.admittedMode,
      outcome: connectorScheduleOccurrences.outcome,
      connectorRunId: connectorScheduleOccurrences.connectorRunId,
    })
    .from(connectorScheduleOccurrences)
    .where(eq(connectorScheduleOccurrences.connectorRunId, run.id))
    .limit(1)

  return Boolean(
    occurrence
    && occurrence.outcome === 'admitted'
    && occurrence.admittedMode === run.mode
    && occurrence.connectorRunId === run.id,
  )
}
