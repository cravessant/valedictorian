import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { LoadFailureView } from '@/components/ui/load-failure-view'
import { AlertCircle, History } from 'lucide-react'
import { typography } from '@/components/ui/typography'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import {
  ConnectorRunLifecycleDetails,
  ConnectorRunSynchronizationDetails,
} from './ConnectorRunDetails'
import type { ConnectorSettingsRun } from './connector-settings.types'
import { ownedLoadFailure, presentLoadFailure, type ErrorPresentation } from '../app/error-presentation'
import {
  openCapturesForRun,
  type CaptureRunFilter,
  type ConnectorProvenanceTarget,
} from '../app/capture-navigation'
import {
  JOBRIGHT_CONNECTOR_ID,
  connectorRunSynchronizationCopy,
} from '../modules/connectors/renderer'

export interface ConnectorRunHistoryItem {
  connectorId: string
  connectorName: string
  run: ConnectorSettingsRun
}

export const CONNECTOR_RUNS_PAGE_SIZE = 20
export const CONNECTOR_RUNS_MAX_FOCUS_PAGES = 25

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

export async function resolveFocusedConnectorRun(
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
  focusedProvenanceTarget = null,
  showDebugData = false,
  onViewCaptures,
}: {
  connectorsApi: ConnectorsPreloadApi
  focusedRunId?: string | null
  focusedProvenanceTarget?: ConnectorProvenanceTarget | null
  showDebugData?: boolean
  onViewCaptures?: (filter: CaptureRunFilter) => void
}) {
  const viewCaptures = onViewCaptures ?? openCapturesForRun
  const [items, setItems] = useState<ConnectorRunHistoryItem[]>([])
  const [loadFailure, setLoadFailure] = useState<ErrorPresentation | null>(null)
  const [focusedRunLookup, setFocusedRunLookup] = useState<FocusedConnectorRunLookup>('idle')
  const [isLoading, setIsLoading] = useState(true)
  const [loadRetryKey, setLoadRetryKey] = useState(0)
  const focusedRunRef = useRef<HTMLElement | null>(null)
  const focusedRunAppliedIdRef = useRef<string | null>(null)
  const focusedIdentityRef = useRef(focusedRunId)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    const focusedChanged = focusedIdentityRef.current !== focusedRunId
    focusedIdentityRef.current = focusedRunId
    if (focusedChanged) {
      focusedRunAppliedIdRef.current = null
      setItems([])
      itemsRef.current = []
      setLoadFailure(null)
      setFocusedRunLookup('idle')
      setIsLoading(true)
    }

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
          setLoadFailure(null)
          if (nextItems.some(({ run }) => run.status === 'queued' || run.status === 'running')) {
            pollTimer = setTimeout(loadRuns, 1_000)
          }
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          const hasStaleData = !focusedChanged && itemsRef.current.length > 0
          setFocusedRunLookup('idle')
          const presentation = presentLoadFailure(reason, {
            fallbackMessage: 'Connector run history could not be loaded.',
            hasStaleData,
            trigger: hasStaleData ? 'refresh' : 'load',
          })
          const owned = ownedLoadFailure(
            presentation.surface === 'authentication' || presentation.surface === 'global'
              ? presentation
              : { ...presentation, title: 'Run history unavailable' },
          )
          setLoadFailure(owned)
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
  }, [connectorsApi, focusedRunId, loadRetryKey])

  useEffect(() => {
    if (!focusedRunId || isLoading || focusedRunLookup !== 'found') {
      return
    }

    const focusIdentity = focusedProvenanceTarget?.connectorRunId === focusedRunId
      ? `${focusedRunId}:${focusedProvenanceTarget.kind}:${focusedProvenanceTarget.id}`
      : focusedRunId
    if (focusedRunAppliedIdRef.current === focusIdentity) {
      return
    }

    const node = focusedRunRef.current
    if (!node) {
      return
    }

    focusedRunAppliedIdRef.current = focusIdentity
    node.scrollIntoView({ block: 'nearest' })
    const provenanceNode = focusedProvenanceTarget?.connectorRunId === focusedRunId
      ? [...node.querySelectorAll<HTMLElement>('[data-connector-provenance-kind]')].find((candidate) =>
          candidate.dataset.connectorProvenanceKind === focusedProvenanceTarget.kind
          && candidate.dataset.connectorProvenanceId === focusedProvenanceTarget.id)
      : null
    ;(provenanceNode ?? node).focus()
  }, [focusedProvenanceTarget, focusedRunId, focusedRunLookup, isLoading, items])

  return (
    <section aria-labelledby="connector-runs-title" className="space-y-7">
      <div>
        <h2 id="connector-runs-title" className={typography.sectionTitle}>
          Connector Runs
        </h2>
        <p className={typography.sectionDescription}>
          Inspect connector progress, results, warnings, and safe retry guidance.
        </p>
      </div>

      {isLoading ? (
        <p className={typography.muted} role="status">Loading connector runs...</p>
      ) : null}
      {loadFailure ? (
        <LoadFailureView
          failure={loadFailure}
          onRetry={() => setLoadRetryKey((current) => current + 1)}
        />
      ) : null}
      {focusedRunLookup === 'not_found' && focusedRunId ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Connector run not found</AlertTitle>
          <AlertDescription>
            The requested connector run could not be found in available history.
          </AlertDescription>
        </Alert>
      ) : null}
      {focusedRunLookup === 'search_limit_reached' && focusedRunId ? (
        <p
          aria-label="Requested connector run was not located within the searched recent-history window"
          className={`rounded-md border border-border bg-card p-4 ${typography.muted}`}
          role="status"
        >
          The requested connector run was not located within the searched recent-history window.
          More history is available beyond this search limit.
        </p>
      ) : null}
      {!isLoading && !loadFailure && items.length === 0 ? (
        <Empty
          aria-label="Empty connector runs"
          className="flex-none gap-3 rounded-md border border-solid border-border bg-card p-6"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h3>No connector runs yet</h3>
            </EmptyTitle>
            <EmptyDescription>
              Start a connector run to see progress and results here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {items.length > 0 ? (
        <div className="space-y-3" aria-label="Connector run history">
          {items.map(({ connectorId, connectorName, run }) => {
            const warningLabels = [...new Set(run.warnings.map((warning) =>
              safeRunWarningLabel(warning.code)))]
            const retryGuidance = safeRunRetryGuidance(run, connectorId)
            const isFocused = focusedRunId === run.id && focusedRunLookup === 'found'
            const synchronization = connectorRunSynchronizationCopy(run)

            return (
              <article
                key={run.id}
                ref={isFocused ? focusedRunRef : undefined}
                aria-current={isFocused ? 'true' : undefined}
                aria-live={run.status === 'queued' || run.status === 'running' ? 'polite' : undefined}
                className={`min-w-0 rounded-md ${isFocused ? 'ring-2 ring-primary' : ''}`}
                data-connector-run-id={run.id}
                id={`connector-run-${run.id}`}
                tabIndex={isFocused ? -1 : undefined}
              >
                <Card className="@container/connector-run-card min-w-0 gap-3 rounded-md border-border p-4 shadow-none">
                  <CardHeader className="min-w-0 gap-1 px-0 has-data-[slot=card-action]:grid-cols-1 @md/connector-run-card:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
                    <CardTitle className="min-w-0">
                      <h3 className={`${typography.panelTitle} min-w-0 break-words`}>{connectorName}</h3>
                    </CardTitle>
                    <CardDescription className="min-w-0 break-words text-xs">
                      {run.mode} · {run.startedAt}
                    </CardDescription>
                    <CardAction
                      className={
                        'col-start-1 row-span-1 row-start-3 min-w-0 justify-self-start '
                        + '@md/connector-run-card:col-start-2 '
                        + '@md/connector-run-card:row-span-2 '
                        + '@md/connector-run-card:row-start-1 '
                        + '@md/connector-run-card:justify-self-end'
                      }
                    >
                      <Badge className="max-w-full whitespace-normal" variant="outline">
                        {synchronization.label}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="min-w-0 space-y-3 px-0">
                    <dl className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      {([
                        ['instance', 'Connector instance', run.connectorInstanceId],
                        ['run', 'Connector run', run.id],
                        ['scope', 'Execution scope', run.executionScopeId],
                      ] as const).map(([kind, label, id]) => (
                        <div className="min-w-0" key={kind}>
                          <dt className="font-medium">{label}</dt>
                          <dd
                            className="break-all font-mono"
                            data-connector-provenance-id={id}
                            data-connector-provenance-kind={kind}
                            tabIndex={
                              isFocused
                              && focusedProvenanceTarget?.kind === kind
                              && focusedProvenanceTarget.id === id
                                ? -1
                                : undefined
                            }
                          >
                            {id}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <ConnectorRunSynchronizationDetails run={run} />
                    <ConnectorRunLifecycleDetails run={run} showDebugData={showDebugData} />
                    <Button
                        type="button"
                        className="max-w-full min-w-0 whitespace-normal"
                        size="sm"
                        variant="outline"
                        onClick={() => viewCaptures({
                          connectorInstanceId: run.connectorInstanceId,
                          connectorRunId: run.id,
                        })}
                      >
                        View Captures from {run.id}
                    </Button>
                    {warningLabels.length > 0 ? (
                      <div className="flex min-w-0 flex-wrap gap-2">
                        {warningLabels.map((label) => (
                          <Badge
                            key={label}
                            className="max-w-full whitespace-normal"
                            variant="secondary"
                          >
                            {label}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {retryGuidance ? (
                      <p className="min-w-0 break-words text-xs font-medium text-muted-foreground">
                        {retryGuidance}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
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
    'connector.finalize_failed': 'Run finalization failed',
    jobright_auth_failed: 'Jobright authentication failed',
    jobright_auth_required: 'Jobright authentication required',
    jobright_auth_retryable: 'Jobright authentication unavailable',
    jobright_challenge_blocked: 'Jobright API challenge',
    jobright_discovery_failed: 'Jobright discovery failed',
    jobright_discovery_forbidden: 'Jobright discovery forbidden',
    jobright_discovery_http_client_error: 'Jobright discovery request error',
    jobright_discovery_http_non_success: 'Jobright discovery non-success',
    jobright_discovery_non_success: 'Jobright discovery rejected',
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

  if (warningCodes.has('jobright_auth_failed')) {
    return 'Jobright authentication failed. Validate credentials and retry the run.'
  }

  if (warningCodes.has('jobright_discovery_failed')) {
    return 'Jobright discovery failed. Review API availability and connector configuration, then run again.'
  }

  if (warningCodes.has('jobright_discovery_forbidden')) {
    return 'Jobright denied discovery access. Review provider access policy and connector configuration, then run again.'
  }

  if (warningCodes.has('jobright_discovery_http_client_error')) {
    return 'Jobright rejected the discovery request. Check the request contract and connector configuration, then run again.'
  }

  if (warningCodes.has('jobright_discovery_http_non_success')) {
    return 'Jobright discovery returned a non-success response. Check provider availability and the request contract, then run again.'
  }

  if (warningCodes.has('jobright_discovery_non_success')) {
    return 'Jobright discovery returned a provider non-success result. Check provider availability and access policy, then run again.'
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
