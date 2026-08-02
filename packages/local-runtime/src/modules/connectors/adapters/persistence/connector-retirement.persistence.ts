import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  connectorInstances,
  connectorRuns,
  connectorSchedules,
  connectorCaptureWork,
} from '../../../../db/schema.js'
import type { PgliteDatabase } from '../../../../db/pglite.js'
import { retireSourceExecutionScope } from '../../../source-execution/source-execution.persistence.js'
import {
  connectorRetirementActiveWorkConflictMessage,
  type ConnectorRetirementActiveWorkConflict,
  type ConnectorRetirementResult,
} from '@sparxie/sdk'

export async function retireConnectorInstance(
  database: PgliteDatabase,
  connectorInstanceId: string,
  retiredAt: string,
): Promise<ConnectorRetirementResult> {
  return database.transaction(async (transaction) => {
    const [instance] = await transaction
      .select({
        id: connectorInstances.id,
        executionScopeId: connectorInstances.executionScopeId,
      })
      .from(connectorInstances)
      .where(and(
        eq(connectorInstances.id, connectorInstanceId),
        isNull(connectorInstances.deletedAt),
      ))
      .limit(1)
      .for('update')

    if (!instance) {
      throw connectorInstanceNotFound(connectorInstanceId)
    }

    const activeRuns = (await transaction
      .select({ connectorRunId: connectorRuns.id, status: connectorRuns.status })
      .from(connectorRuns)
      .where(and(
        eq(connectorRuns.connectorInstanceId, connectorInstanceId),
        inArray(connectorRuns.status, ['queued', 'running']),
        isNull(connectorRuns.deletedAt),
      ))
      .for('update'))
      .map(({ connectorRunId, status }) => ({
        connectorRunId,
        status: status as 'queued' | 'running',
      }))

    if (activeRuns.length > 0) {
      throw activeWorkConflict(connectorInstanceId, activeRuns)
    }

    const [retiredInstance] = await transaction.update(connectorInstances).set({
      authJson: '[]',
      configJson: '{}',
      filtersJson: '{}',
      earliestBackfillDate: null,
      enabled: false,
      updatedAt: retiredAt,
      deletedAt: retiredAt,
    }).where(and(
      eq(connectorInstances.id, connectorInstanceId),
      isNull(connectorInstances.deletedAt),
    )).returning({ id: connectorInstances.id })
    if (!retiredInstance) {
      throw connectorInstanceNotFound(connectorInstanceId)
    }

    await transaction.update(connectorSchedules).set({
      updatedAt: retiredAt,
      deletedAt: retiredAt,
    }).where(and(
      eq(connectorSchedules.connectorInstanceId, connectorInstanceId),
      isNull(connectorSchedules.deletedAt),
    ))
    await transaction.update(connectorCaptureWork).set({
      status: 'cancelled',
      nextEligibleAt: null,
      acquisitionToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      updatedAt: retiredAt,
    }).where(and(
      eq(connectorCaptureWork.connectorInstanceId, connectorInstanceId),
      inArray(connectorCaptureWork.status, ['scheduled', 'claimed']),
    ))
    await retireSourceExecutionScope(transaction, instance.executionScopeId, retiredAt)

    return {
      connectorInstanceId,
      lifecycle: 'retired',
      retiredAt,
      requirements: {
        connectorImplementation: 'not_required',
        authenticationValidation: 'not_required',
      },
      disposition: {
        configuration: 'removed',
        schedule: 'removed',
        checkpoints: 'preserved',
        executionScopes: 'preserved',
        futureExecution: 'blocked',
        authReferences: 'removed',
        secretValues: 'preserved_for_workspace_secret_administration',
      },
      preservedLineage: {
        connectorRuns: true,
        captures: true,
        normalizationAttempts: true,
        jobs: true,
        opportunities: true,
      },
    }
  }, { isolationLevel: 'serializable' })
}

function connectorInstanceNotFound(connectorInstanceId: string) {
  return Object.assign(new Error(`Connector instance not found: ${connectorInstanceId}`), {
    statusCode: 404,
  })
}

function activeWorkConflict(
  connectorInstanceId: string,
  activeRuns: ConnectorRetirementActiveWorkConflict['activeRuns'],
) {
  const conflict: ConnectorRetirementActiveWorkConflict = {
    code: 'connector_retirement_active_work_conflict',
    connectorInstanceId,
    message: connectorRetirementActiveWorkConflictMessage,
    cancellationRequired: true,
    activeRuns,
  }
  return Object.assign(new Error(conflict.message), conflict, { statusCode: 409 })
}
