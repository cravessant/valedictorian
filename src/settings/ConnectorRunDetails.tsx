import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ConnectorRunLifecycleCounts } from '../modules/connectors/connector.lifecycle-counts'
import { connectorRunTerminalCopy } from '../modules/connectors/connector.run-presentation'
import type { ConnectorSettingsRun } from './connector-settings.types'
import { recordFromUnknown, stringFromUnknown } from './connector-settings.helpers'

export function connectorRunMetrics(run: ConnectorSettingsRun): Array<{ label: string; value: number }> {
  const stats = recordFromUnknown(run.stats)
  const failureMetric = numericRunMetric(stats, 'failures', 'Failures')
    ?? numericRunMetric(stats, 'failed', 'Failures')
    ?? (run.status === 'failed' ? { label: 'Failures', value: 1 } : null)
  const metrics = [
    { label: 'Warnings', value: run.warningCount },
    failureMetric,
  ]

  return metrics.filter((metric): metric is { label: string; value: number } => metric !== null)
}

export function ConnectorRunLifecycleDetails({ run }: { run: ConnectorSettingsRun }) {
  const [showExplanation, setShowExplanation] = useState(false)
  const stats = recordFromUnknown(run.stats)
  const lifecycle = connectorRunLifecycleCounts(stats.lifecycleCounts, run.id)
  const terminal = connectorRunTerminalCopy(run)
  const providerGaps = lifecycle && Array.isArray(lifecycle.provider.gaps)
    ? lifecycle.provider.gaps
    : []
  const carried = [
    numericRunMetric(stats, 'discovered', 'Discovered jobs'),
    numericRunMetric(stats, 'discoveryPages', 'Discovery page requests'),
    numericRunMetric(stats, 'attempted', 'Detail attempts'),
    numericRunMetric(stats, 'authRequired', 'Auth-required requests'),
    numericRunMetric(stats, 'retryableFailures', 'Retryable request failures'),
    numericRunMetric(stats, 'resolvedEmployerOrAts', 'Resolved employer / ATS'),
    numericRunMetric(stats, 'resolvedThirdParty', 'Resolved third-party'),
  ].filter((metric): metric is { label: string; value: number } => metric !== null)
  const stopReason = stringFromUnknown(stats.stopReason)
    || stringFromUnknown(recordFromUnknown(run.retryHints).stopReason)
  const earliestBackfillDate = utcDateOnlyFromCoverageStart(run.coverage.start)
  const capReached = stopReason === 'coverage_start_reached'

  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 text-xs">
      <div>
        <p className="font-semibold text-foreground">{terminal.summary}</p>
        {terminal.detail ? <p className="mt-1 text-muted-foreground">{terminal.detail}</p> : null}
        {terminal.technical ? <p className="mt-1 text-muted-foreground">{terminal.technical}</p> : null}
        {earliestBackfillDate ? (
          <p className="mt-1 text-muted-foreground">
            Selected earliest backfill date: {earliestBackfillDate}
          </p>
        ) : null}
        {capReached ? (
          <p className="mt-1 text-muted-foreground">
            Discovery stopped because the selected earliest backfill date was reached.
          </p>
        ) : null}
        {stopReason ? (
          <p className="mt-1 text-muted-foreground">Stop reason: {stopReason}</p>
        ) : null}
      </div>
      {lifecycle ? (
        <>
          <div>
            <p className="font-semibold text-foreground">Unique jobs in this connector run</p>
            <p className="mt-1 text-muted-foreground">
              {lifecycle.source === 'frozen_terminal'
                ? 'Frozen at terminal completion.'
                : lifecycle.source === 'live_current'
                  ? 'Live counts derived from current persisted lineage.'
                  : 'Derived from current persisted lineage for a pre-feature terminal run.'}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3" aria-label="Run lifecycle counts">
            <RunCountStage title="Provider intake" values={[
              ['Provider returned rows', lifecycle.provider.returnedRows],
              ['Valid unique records', lifecycle.provider.validRecords],
              ['Invalid records', lifecycle.provider.invalidRecords],
              ['Source duplicates', lifecycle.provider.sourceDuplicates],
              ['Captured records', lifecycle.provider.capturedRecords],
              ['Capture occurrences', lifecycle.provider.occurrenceCount],
            ]} />
            <RunCountStage title="Destination and normalization" values={[
              ['Normalized', lifecycle.destination.normalized],
              ['Resolved employer / ATS', lifecycle.destination.resolvedEmployerOrAts],
              ['Resolved third-party', lifecycle.destination.resolvedThirdParty],
              ['Pending', lifecycle.destination.pending],
              ['Unresolved', lifecycle.destination.unresolved],
              ['Gate rejected', lifecycle.destination.gateRejected],
            ]} />
            <RunCountStage title="Sourcing" values={[
              ['Added / new', lifecycle.sourcing.added],
              ['Queue duplicate', lifecycle.sourcing.queueDuplicate],
              ['Not fit', lifecycle.sourcing.notFit],
              ['Cutoff / rejected', lifecycle.sourcing.rejected],
              ['Actionable review', lifecycle.sourcing.actionableReview],
            ]} />
          </div>
          {lifecycle.provider.invariant !== 'reconciled'
            || lifecycle.destination.invariant !== 'reconciled'
            || lifecycle.sourcing.invariant !== 'reconciled'
            || lifecycle.provider.captureShortfall > 0
            || lifecycle.provider.unclassifiedRows > 0
            || lifecycle.destination.unclassified > 0
            || lifecycle.sourcing.unclassified > 0 ? (
              <p className="font-medium text-warning">
                Some persisted rows do not reconcile; shortfalls and unclassified records remain visible in the count explanation.
              </p>
            ) : null}
          {providerGaps.length > 0 ? (
            <p className="font-medium text-warning">
              Provider stats gaps: {providerGaps.map(formatProviderStatsGap).join(', ')}.
            </p>
          ) : null}
        </>
      ) : null}
      {carried.length > 0 ? (
        <div>
          <p className="font-semibold text-foreground">Carried connector cycle</p>
          <p className="mt-1 text-muted-foreground">
            Cumulative checkpoint and request details; these are not jobs returned by this run.
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {carried.map((metric) => (
              <span key={metric.label}>{metric.label}: {metric.value}</span>
            ))}
          </div>
        </div>
      ) : null}
      <Button
        aria-expanded={showExplanation}
        className="w-fit"
        size="sm"
        type="button"
        variant="outline"
        onClick={() => setShowExplanation((shown) => !shown)}
      >
        How these counts work
      </Button>
      {showExplanation ? (
        <div className="grid gap-1 text-muted-foreground">
          <p>Every primary count is scoped to unique jobs captured by this connector run id.</p>
          <p>Returned rows equal valid unique records plus invalid rows plus source duplicates when provider totals reconcile.</p>
          <p>Captured records equal normalized plus pending, unresolved, gate-rejected, and explicitly unclassified records.</p>
          <p>Normalized equals resolved employer / ATS plus resolved third-party jobs.</p>
          <p>Sourcing outcomes partition normalized jobs; only a persisted concrete question counts as actionable review.</p>
          {lifecycle ? (
            <p>
              Visible exceptions: capture shortfall {lifecycle.provider.captureShortfall}; provider unclassified {lifecycle.provider.unclassifiedRows}; destination unclassified {lifecycle.destination.unclassified}; sourcing unclassified {lifecycle.sourcing.unclassified}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function formatProviderStatsGap(value: string): string {
  return value.replace(/_/g, ' ')
}

function RunCountStage({
  title,
  values,
}: {
  title: string
  values: Array<readonly [string, number]>
}) {
  return (
    <section>
      <h4 className="font-medium text-foreground">{title}</h4>
      <div className="mt-1 grid gap-1 text-muted-foreground">
        {values.map(([label, value]) => <span key={label}>{label}: {value}</span>)}
      </div>
    </section>
  )
}

function connectorRunLifecycleCounts(
  value: unknown,
  connectorRunId: string,
): ConnectorRunLifecycleCounts | null {
  const lifecycle = recordFromUnknown(value)
  const scope = recordFromUnknown(lifecycle.scope)
  if (
    lifecycle.version !== 'connector-run-lifecycle-counts/v1'
    || !['frozen_terminal', 'live_current', 'derived_pre_feature'].includes(
      String(lifecycle.source),
    )
    || scope.kind !== 'connector_run'
    || scope.connectorRunId !== connectorRunId
  ) {
    return null
  }
  return lifecycle as unknown as ConnectorRunLifecycleCounts
}

export function ConnectorRunProgressDetails({ run }: { run: ConnectorSettingsRun }) {
  const stats = recordFromUnknown(run.stats)
  const stage = stringFromUnknown(stats.stage)
  const lastProgressAt = stringFromUnknown(stats.lastProgressAt)
  const wait = recordFromUnknown(stats.wait)
  const startedAtMs = Date.parse(run.startedAt)
  const endAtMs = run.completedAt ? Date.parse(run.completedAt) : Date.now()
  const elapsedSeconds = Number.isFinite(startedAtMs) && Number.isFinite(endAtMs)
    ? Math.max(0, Math.floor((endAtMs - startedAtMs) / 1_000))
    : null

  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      {stage ? <span>Stage: {formatConnectorStage(stage)}</span> : null}
      <span>Started: {run.startedAt}</span>
      {elapsedSeconds !== null ? <span>Elapsed: {elapsedSeconds}s</span> : null}
      {lastProgressAt ? <span>Last progress: {lastProgressAt}</span> : null}
      {Object.keys(wait).length > 0 ? (
        <span>Waiting between bounded Jobright API requests.</span>
      ) : null}
    </div>
  )
}

function formatConnectorStage(stage: string): string {
  return stage
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function numericRunMetric(
  stats: Record<string, unknown>,
  key: string,
  label: string,
): { label: string; value: number } | null {
  const value = stats[key]

  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { label, value }
    : null
}

function utcDateOnlyFromCoverageStart(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.endsWith('T00:00:00.000Z')) {
    return null
  }
  const dateOnly = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null
}
