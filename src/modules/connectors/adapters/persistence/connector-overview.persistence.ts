import { and, asc, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm'
import {
  connectorInstances,
  connectorRuns,
  connectorRunSynchronizations,
} from '../../../../db/schema'
import type { PgliteDatabase } from '../../../../db/pglite'
import { mapConnectorInstance } from './connector-instance.persistence'
import { synchronizedConnectorRun } from './connector-synchronization.persistence'
import type {
  ConnectorOverviewStatusPage,
  ConnectorOverviewStatusPageInput,
} from '../../ports/connector.overview-page'

export async function listConnectorOverviewStatusPage(
  database: PgliteDatabase,
  input: ConnectorOverviewStatusPageInput,
): Promise<ConnectorOverviewStatusPage> {
  const latestRunId = database.select({ id: connectorRuns.id })
    .from(connectorRuns)
    .innerJoin(
      connectorRunSynchronizations,
      eq(connectorRunSynchronizations.connectorRunId, connectorRuns.id),
    )
    .where(and(
      eq(connectorRuns.connectorInstanceId, connectorInstances.id),
      isNull(connectorRuns.deletedAt),
    ))
    .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt), desc(connectorRuns.id))
    .limit(1)
  const healthStatus = connectorOverviewHealthStatusSql()
  const healthSeverity = connectorOverviewHealthSeveritySql(healthStatus)
  const rows = await database.select({
    instance: connectorInstances,
    run: connectorRuns,
    snapshotJson: connectorRunSynchronizations.snapshotJson,
  }).from(connectorInstances)
    .leftJoin(connectorRuns, eq(connectorRuns.id, latestRunId))
    .leftJoin(
      connectorRunSynchronizations,
      eq(connectorRunSynchronizations.connectorRunId, connectorRuns.id),
    )
    .where(and(
      isNull(connectorInstances.deletedAt),
      input.cursorId === undefined
        ? undefined
        : gt(connectorInstances.id, input.cursorId),
      input.enabled === undefined ? undefined : eq(connectorInstances.enabled, input.enabled),
      input.status === undefined ? undefined : eq(healthStatus, input.status),
      input.severity === undefined ? undefined : eq(healthSeverity, input.severity),
    ))
    .orderBy(asc(connectorInstances.id))
    .limit(input.limit + 1)
  return {
    items: rows.slice(0, input.limit).map(({ instance, run, snapshotJson }) => ({
      ...mapConnectorInstance(instance),
      latestRun: run && snapshotJson ? synchronizedConnectorRun(run, snapshotJson) : null,
    })),
    hasMore: rows.length > input.limit,
  }
}

function connectorOverviewHealthStatusSql() {
  const outcome = sql`(${connectorRunSynchronizations.snapshotJson}::jsonb #>> '{outcome,kind}')`
  const reason = sql`(${connectorRunSynchronizations.snapshotJson}::jsonb #>> '{outcome,reason}')`
  const newest = sql`(${connectorRunSynchronizations.snapshotJson}::jsonb #>> '{newestFrontier,state}')`
  const backfill = sql`(${connectorRunSynchronizations.snapshotJson}::jsonb #>> '{historicalBackfill,state}')`
  const pending = sql`coalesce((${connectorRunSynchronizations.snapshotJson}::jsonb #>> '{pendingResolutionCount}')::integer, 0)`
  const authWarning = sql`exists (
    select 1 from jsonb_array_elements(${connectorRuns.warningsJson}::jsonb) warning
    where warning ->> 'code' like 'auth.%'
       or warning ->> 'code' = 'jobright_auth_required'
  )`
  const blockedWarning = sql`exists (
    select 1 from jsonb_array_elements(${connectorRuns.warningsJson}::jsonb) warning
    where warning ->> 'code' in (
      'source.captcha', 'jobright_auth_failed', 'jobright_challenge_blocked',
      'jobright_raw_intake_unavailable', 'jobright_normalization_unavailable'
    )
  )`
  return sql<string>`case
    when ${connectorRuns.id} is null then 'never_run'
    when ${outcome} = 'action_required' then 'authentication_required'
    when ${outcome} = 'cooling_down' then 'cooling_down'
    when ${outcome} = 'source_exhausted' then 'source_exhausted'
    when ${outcome} = 'boundary_exhausted' then 'boundary_exhausted'
    when ${outcome} = 'caught_up' then 'caught_up'
    when ${outcome} = 'yielded' then 'skipped'
    when ${outcome} = 'cancelled' and ${reason} like 'user_skipped%' then 'skipped'
    when ${authWarning} then 'authentication_required'
    when ${blockedWarning} then 'blocked'
    when ${connectorRuns.status} = 'queued' then 'queued'
    when ${connectorRuns.status} = 'running' and ${newest} = 'advancing' then 'checking_newest'
    when ${connectorRuns.status} = 'running' and ${backfill} = 'advancing' then 'backfilling'
    when ${connectorRuns.status} = 'running' and ${pending} > 0 then 'resolving'
    when ${connectorRuns.status} = 'running' then 'checking_newest'
    when ${connectorRuns.status} = 'failed' then 'failed'
    when ${connectorRuns.status} = 'cancelled' then 'cancelled'
    when ${connectorRuns.status} = 'skipped' then 'skipped'
    else 'caught_up'
  end`
}

function connectorOverviewHealthSeveritySql(healthStatus: SQL<string>) {
  return sql<string>`case
    when ${healthStatus} in ('authentication_required', 'blocked', 'failed') then 'blocked'
    when ${healthStatus} in ('boundary_exhausted', 'caught_up', 'source_exhausted') then 'healthy'
    else 'warning'
  end`
}
