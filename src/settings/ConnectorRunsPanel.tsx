import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { retryAdviceSchema } from 'sparxie'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import { JOBRIGHT_CONNECTOR_ID } from '../modules/connectors/jobright.constants'
import { formatRetryAdviceGuidance } from '../modules/connectors/connector.retry-guidance'
import {
  ConnectorRunLifecycleDetails,
  ConnectorRunProgressDetails,
  connectorRunMetrics,
} from './ConnectorRunDetails'
import type { ConnectorSettingsRun } from './connector-settings.types'

interface ConnectorRunHistoryItem {
  connectorId: string
  connectorName: string
  run: ConnectorSettingsRun
}

const CONNECTOR_RUNS_PAGE_SIZE = 20
const CONNECTOR_RUNS_MAX_FOCUS_PAGES = 25

async function loadConnectorRunHistoryPage(
  connectorsApi: ConnectorsPreloadApi,
  offset: number,
): Promise<{
  items: ConnectorRunHistoryItem[]
  hasMore: boolean
}> {
  const { items: instances } = await connectorsApi.list()
  const runLists = await Promise.all(instances.map(async (instance) => {
    const page = await connectorsApi.runs.list({
      connectorInstanceId: instance.id,
      limit: CONNECTOR_RUNS_PAGE_SIZE,
      offset,
    })
    return {
      connectorId: instance.connectorId,
      connectorName: instance.displayName,
      hasMore: page.hasMore,
      runs: page.items,
    }
  }))

  return {
    hasMore: runLists.some((entry) => entry.hasMore),
    items: runLists
      .flatMap(({ connectorId, connectorName, runs }) =>
        runs.map((run) => ({ connectorId, connectorName, run })))
      .sort((left, right) => right.run.startedAt.localeCompare(left.run.startedAt)),
  }
}

async function resolveFocusedConnectorRun(
  connectorsApi: ConnectorsPreloadApi,
  focusedRunId: string,
  initialItems: ConnectorRunHistoryItem[],
  initialHasMore: boolean,
): Promise<{
  focusedItem: ConnectorRunHistoryItem | null
  outcome: 'found' | 'not_found' | 'search_limit_reached'
}> {
  const existing = initialItems.find((item) => item.run.id === focusedRunId)
  if (existing) {
    return { focusedItem: existing, outcome: 'found' }
  }

  let offset = CONNECTOR_RUNS_PAGE_SIZE
  let hasMore = initialHasMore
  let pagesFetched = 1

  while (hasMore && pagesFetched < CONNECTOR_RUNS_MAX_FOCUS_PAGES) {
    const page = await loadConnectorRunHistoryPage(connectorsApi, offset)
    pagesFetched += 1
    const match = page.items.find((item) => item.run.id === focusedRunId)
    if (match) {
      return { focusedItem: match, outcome: 'found' }
    }
    hasMore = page.hasMore
    offset += CONNECTOR_RUNS_PAGE_SIZE
  }

  if (hasMore) {
    return { focusedItem: null, outcome: 'search_limit_reached' }
  }

  return { focusedItem: null, outcome: 'not_found' }
}

type FocusedConnectorRunLookup =
  | 'idle'
  | 'found'
  | 'not_found'
  | 'search_limit_reached'

export function ConnectorRunsPanel({
  connectorsApi,
  focusedRunId = null,
}: {
  connectorsApi: ConnectorsPreloadApi
  focusedRunId?: string | null
}) {
  const [items, setItems] = useState<ConnectorRunHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [focusedRunLookup, setFocusedRunLookup] = useState<FocusedConnectorRunLookup>('idle')
  const [isLoading, setIsLoading] = useState(true)
  const focusedRunRef = useRef<HTMLElement | null>(null)
  const focusedRunAppliedIdRef = useRef<string | null>(null)

  useEffect(() => {
    focusedRunAppliedIdRef.current = null
    setFocusedRunLookup('idle')
  }, [focusedRunId])

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let resolvedFocusedItem: ConnectorRunHistoryItem | null = null
    let focusedLookupComplete = !focusedRunId
    let lookupOutcome: FocusedConnectorRunLookup = 'idle'

    const loadRuns = () => loadConnectorRunHistoryPage(connectorsApi, 0)
      .then(async (page) => {
        let nextItems = page.items

        if (focusedRunId && !focusedLookupComplete) {
          const focused = await resolveFocusedConnectorRun(
            connectorsApi,
            focusedRunId,
            page.items,
            page.hasMore,
          )
          focusedLookupComplete = true
          lookupOutcome = focused.outcome
          resolvedFocusedItem = focused.outcome === 'found' ? focused.focusedItem : null
        }

        if (
          focusedRunId
          && resolvedFocusedItem
          && !nextItems.some((item) => item.run.id === focusedRunId)
        ) {
          nextItems = [resolvedFocusedItem, ...nextItems]
        }

        if (!cancelled) {
          setItems(nextItems)
          setFocusedRunLookup(focusedRunId && focusedLookupComplete ? lookupOutcome : 'idle')
          setError(null)
          if (nextItems.some(({ run }) => run.status === 'queued' || run.status === 'running')) {
            pollTimer = setTimeout(loadRuns, 1_000)
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          setFocusedRunLookup('idle')
          setError('Connector run history could not be loaded.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    void loadRuns()

    return () => {
      cancelled = true
      if (pollTimer) {
        clearTimeout(pollTimer)
      }
    }
  }, [connectorsApi, focusedRunId])

  useEffect(() => {
    if (!focusedRunId || isLoading || focusedRunLookup !== 'found') {
      return
    }

    if (focusedRunAppliedIdRef.current === focusedRunId) {
      return
    }

    const node = focusedRunRef.current
    if (!node) {
      return
    }

    focusedRunAppliedIdRef.current = focusedRunId
    node.scrollIntoView({ block: 'nearest' })
    node.focus()
  }, [focusedRunId, focusedRunLookup, isLoading, items])

  return (
    <section aria-labelledby="connector-runs-title" className="space-y-7">
      <div>
        <h2 id="connector-runs-title" className="text-xl font-semibold text-foreground">
          Connector Runs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspect connector progress, results, warnings, and safe retry guidance.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading connector runs...</p>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="bg-card" role="alert">
          <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
          <div className="pl-7">
            <AlertTitle>Run history unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {focusedRunLookup === 'not_found' && focusedRunId ? (
        <Alert variant="destructive" className="bg-card" role="alert">
          <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
          <div className="pl-7">
            <AlertTitle>Connector run not found</AlertTitle>
            <AlertDescription>
              The requested connector run could not be found in available history.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      {focusedRunLookup === 'search_limit_reached' && focusedRunId ? (
        <p
          aria-label="Requested connector run was not located within the searched recent-history window"
          className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground"
          role="status"
        >
          The requested connector run was not located within the searched recent-history window.
          More history is available beyond this search limit.
        </p>
      ) : null}
      {!isLoading && !error && items.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          No connector runs recorded yet.
        </p>
      ) : null}
      {items.length > 0 ? (
        <div className="space-y-3" aria-label="Connector run history">
          {items.map(({ connectorId, connectorName, run }) => {
            const warningLabels = [...new Set(run.warnings.map((warning) =>
              safeRunWarningLabel(warning.code)))]
            const retryGuidance = safeRunRetryGuidance(run, connectorId)
            const isFocused = focusedRunId === run.id && focusedRunLookup === 'found'

            return (
              <article
                key={run.id}
                ref={isFocused ? focusedRunRef : undefined}
                aria-current={isFocused ? 'true' : undefined}
                aria-live={run.status === 'queued' || run.status === 'running' ? 'polite' : undefined}
                className={`space-y-3 rounded-md border border-border bg-card p-4 ${
                  isFocused ? 'ring-2 ring-primary' : ''
                }`}
                data-connector-run-id={run.id}
                id={`connector-run-${run.id}`}
                tabIndex={isFocused ? -1 : undefined}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{connectorName}</h3>
                    <p className="text-xs text-muted-foreground">
                      {run.mode} · {run.startedAt}
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2 py-1 text-xs font-medium text-foreground">
                    {run.status}
                  </span>
                </div>
                <ConnectorRunProgressDetails run={run} />
                <ConnectorRunLifecycleDetails run={run} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {connectorRunMetrics(run).map((metric) => (
                    <span key={metric.label}>{metric.label}: {metric.value}</span>
                  ))}
                </div>
                {warningLabels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {warningLabels.map((label) => (
                      <span key={label} className="rounded-full bg-muted px-2 py-1 text-xs text-foreground">
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {retryGuidance ? (
                  <p className="text-xs font-medium text-muted-foreground">{retryGuidance}</p>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function safeRunWarningLabel(code: string): string {
  const labels: Record<string, string> = {
    'auth.required': 'Authentication required',
    'connector.execution_failed': 'Connector execution failed',
    'connector.interrupted': 'Run interrupted',
    'connector.projection_failed': 'Projection failed',
    jobright_auth_failed: 'Jobright authentication failed',
    jobright_auth_required: 'Jobright authentication required',
    jobright_auth_retryable: 'Jobright authentication unavailable',
    jobright_challenge_blocked: 'Jobright API challenge',
    jobright_discovery_failed: 'Jobright discovery failed',
    jobright_discovery_rate_limited: 'Jobright discovery rate limited',
    jobright_discovery_retryable: 'Jobright discovery unavailable',
    jobright_parser_changed: 'Jobright API changed',
    jobright_rate_limited: 'Jobright rate limited',
    jobright_retryable_failure: 'Jobright temporarily unavailable',
    jobright_zero_useful_results: 'No usable Jobright URLs',
    'source.captcha': 'Captcha required',
    'source.rate_limited': 'Rate limited',
  }

  return labels[code] ?? 'Connector warning'
}

function safeRunRetryGuidance(run: ConnectorSettingsRun, connectorId: string): string | null {
  const warningCodes = new Set(run.warnings.map((warning) => warning.code))
  const advice = retryAdviceSchema.safeParse(run.retryHints)
  if (advice.success) {
    return formatRetryAdviceGuidance(advice.data)
  }

  if (warningCodes.has('jobright_auth_failed')) {
    return 'Jobright authentication failed. Validate credentials and retry the run.'
  }

  if (warningCodes.has('jobright_discovery_failed')) {
    return 'Jobright discovery failed. Review API availability and connector configuration, then run again.'
  }

  if (warningCodes.has('auth.required') || warningCodes.has('jobright_auth_required')) {
    return connectorId === JOBRIGHT_CONNECTOR_ID
      ? 'Update and validate Jobright credentials, then run again.'
      : 'Reconnect the connector and run again.'
  }

  if (warningCodes.has('jobright_challenge_blocked')) {
    return 'Jobright returned an API challenge. Refresh credentials or retry later.'
  }

  if (warningCodes.has('jobright_parser_changed')) {
    return 'Update the Jobright API parser, then run again.'
  }

  if (warningCodes.has('jobright_zero_useful_results')) {
    return 'Review unresolved Jobright results and URL normalization, then run again.'
  }

  if (
    warningCodes.has('jobright_rate_limited')
    || warningCodes.has('jobright_retryable_failure')
    || warningCodes.has('jobright_discovery_rate_limited')
    || warningCodes.has('jobright_discovery_retryable')
  ) {
    return 'Retry the Jobright run later with backoff.'
  }

  return run.status === 'failed' ? 'Review the connector configuration and run again.' : null
}
