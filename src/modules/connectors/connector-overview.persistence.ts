import { and, asc, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm'
import {
  connectorInstances,
  connectorRuns,
  connectorRunSynchronizations,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { ConnectorStatusSeverity, ConnectorStatusState } from 'sparxie'
import { mapConnectorInstance } from './connector-instance.persistence'
import { synchronizedConnectorRun } from './connector-synchronization.persistence'
import type { ConnectorStatusSummaryRecord } from './connector-status.persistence-types'

export interface ConnectorOverviewStatusPageInput {
  cursorId?: string
  enabled?: boolean
  limit: number
  severity?: ConnectorStatusSeverity
  status?: ConnectorStatusState
}

export interface ConnectorOverviewStatusPage {
  items: ConnectorStatusSummaryRecord[]
  hasMore: boolean
}

export function listConnectorOverviewStatusPage(
  database: DrizzleDatabase,
  input: ConnectorOverviewStatusPageInput,
): ConnectorOverviewStatusPage {
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
    .orderBy(desc(connectorRuns.startedAt), desc(connectorRuns.createdAt))
    .limit(1)
  const healthStatus = connectorOverviewHealthStatusSql()
  const healthSeverity = connectorOverviewHealthSeveritySql(healthStatus)
  const rows = database.select({
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
    .all()
  return {
    items: rows.slice(0, input.limit).map(({ instance, run, snapshotJson }) => ({
      ...mapConnectorInstance(instance),
      latestRun: run && snapshotJson ? synchronizedConnectorRun(run, snapshotJson) : null,
    })),
    hasMore: rows.length > input.limit,
  }
}

function connectorOverviewHealthStatusSql() {
  const outcome = sql`json_extract(${connectorRunSynchronizations.snapshotJson}, '$.outcome.kind')`
  const reason = sql`json_extract(${connectorRunSynchronizations.snapshotJson}, '$.outcome.reason')`
  const newest = sql`json_extract(${connectorRunSynchronizations.snapshotJson}, '$.newestFrontier.state')`
  const backfill = sql`json_extract(${connectorRunSynchronizations.snapshotJson}, '$.historicalBackfill.state')`
  const pending = sql`coalesce(json_extract(${connectorRunSynchronizations.snapshotJson}, '$.pendingResolutionCount'), 0)`
  const authWarning = sql`exists (
    select 1 from json_each(${connectorRuns.warningsJson}) warning
    where json_extract(warning.value, '$.code') like 'auth.%'
       or json_extract(warning.value, '$.code') = 'jobright_auth_required'
  )`
  const blockedWarning = sql`exists (
    select 1 from json_each(${connectorRuns.warningsJson}) warning
    where json_extract(warning.value, '$.code') in (
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
