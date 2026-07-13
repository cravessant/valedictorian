import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { connectorRunSynchronizationCopy } from '../modules/connectors/connector.run-presentation'
import type { ConnectorSettingsRun } from './connector-settings.types'

export function ConnectorRunSynchronizationDetails({
  ariaLabel = 'Connector synchronization state',
  run,
}: {
  ariaLabel?: string
  run: ConnectorSettingsRun
}) {
  const [showExplanation, setShowExplanation] = useState(false)
  const presentation = connectorRunSynchronizationCopy(run)
  return (
    <section
      className="grid gap-2 rounded-md border border-border/70 bg-background/35 p-3 text-xs"
    >
      <div aria-atomic="true" aria-label={ariaLabel} aria-live="polite" role="status">
        <div>
          <p className="font-semibold text-foreground">{presentation.label}</p>
          <p className="mt-1 text-muted-foreground">{presentation.summary}</p>
          {presentation.nextAttemptAt ? (
            <p className="mt-1 text-muted-foreground">
              Next attempt {new Date(presentation.nextAttemptAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-3">
          <p><span className="font-medium text-foreground">Newest frontier:</span>{' '}
            {formatNewestFrontier(run.newestFrontier.state)}</p>
          <p><span className="font-medium text-foreground">Historical backfill:</span>{' '}
            {formatHistoricalBackfill(run.historicalBackfill.state)}</p>
          <p><span className="font-medium text-foreground">Pending link resolution:</span>{' '}
            {run.pendingResolutionCount}</p>
        </div>
      </div>
      <Button
        aria-expanded={showExplanation}
        className="w-fit"
        size="sm"
        type="button"
        variant="outline"
        onClick={() => setShowExplanation((shown) => !shown)}
      >
        How synchronization works
      </Button>
      {showExplanation ? (
        <div className="grid gap-1 text-muted-foreground">
          <p>
            Each work opportunity checks the newest frontier first, then advances historical
            backfill toward the configured boundary, and resumes pending link resolution.
          </p>
          <p>
            Yielded work is safely checkpointed for the next admitted manual or scheduled work
            opportunity.
          </p>
        </div>
      ) : null}
    </section>
  )
}

function formatNewestFrontier(state: ConnectorSettingsRun['newestFrontier']['state']) {
  return {
    advancing: 'Checking newest',
    caught_up: 'Caught up',
    not_started: 'Not started',
  }[state]
}

function formatHistoricalBackfill(state: ConnectorSettingsRun['historicalBackfill']['state']) {
  return {
    advancing: 'Backfilling',
    boundary_reached: 'Boundary reached',
    caught_up: 'Caught up',
    not_started: 'Not started',
    source_exhausted: 'Provider history exhausted',
  }[state]
}

export function ConnectorRunLifecycleDetails({ run }: { run: ConnectorSettingsRun }) {
  const [showExplanation, setShowExplanation] = useState(false)
  const lifecycle = run.lifecycleCounts ?? null
  const providerGaps = lifecycle?.provider.gaps ?? []
  const providerReturnedRowsUnknown = providerGaps.includes('missing_provider_returned')
    || providerGaps.includes('invalid_provider_returned')

  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 text-xs">
      {lifecycle ? (
        <>
          <div>
            <p className="font-semibold text-foreground">Stage-specific synchronization counts</p>
            <p className="mt-1 text-muted-foreground">
              {lifecycle.source === 'frozen_terminal'
                ? 'Frozen at terminal completion.'
                : 'Live counts derived from current persisted lineage.'}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3" aria-label="Run lifecycle counts">
            <RunCountStage title="Provider intake" values={[
              [
                'Provider returned rows',
                providerReturnedRowsUnknown ? 'Unknown' : lifecycle.provider.returnedRows,
              ],
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
              ['Sourcing findings added', lifecycle.sourcing.findingsAdded],
              ['Canonical duplicates', lifecycle.sourcing.canonicalDuplicates],
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
          {providerReturnedRowsUnknown ? (
            <p className="font-medium text-warning">
              Provider did not report a valid returned-row count.
            </p>
          ) : null}
        </>
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
          <p>Provider returned rows are response rows, not a unique-job total.</p>
          <p>Valid records and invalid rows classify provider rows; source duplicates repeat a provider identity.</p>
          <p>Capture occurrences are intake events; captured records are unique persisted raw records for this run.</p>
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
  values: Array<readonly [string, number | string]>
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
