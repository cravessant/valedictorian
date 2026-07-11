
import { Button } from '@/components/ui/button'
import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_MAX_REQUESTS_PER_RUN,
  JOBRIGHT_HOST_REQUEST_BUDGET,
  JOBRIGHT_MAX_DISCOVERY_COUNT,
  JOBRIGHT_MAX_MAX_DISCOVERY_PAGES,
  JOBRIGHT_MAX_MAX_DISCOVERY_RECORDS,
  JOBRIGHT_MAX_USEFUL_TARGET,
  JOBRIGHT_MIN_DISCOVERY_COUNT,
  JOBRIGHT_MIN_MAX_DISCOVERY_PAGES,
  JOBRIGHT_MIN_MAX_DISCOVERY_RECORDS,
  JOBRIGHT_MIN_USEFUL_TARGET,
  JOBRIGHT_PACING_CONCURRENCY,
  JOBRIGHT_PACING_MAX_DELAY_SECONDS,
  JOBRIGHT_PACING_MIN_DELAY_SECONDS,
} from '../modules/connectors/jobright.constants'
import { formatRetryAdviceGuidance } from '../modules/connectors/connector.retry-guidance'
import { retryAdviceSchema } from 'sparxie'
import {
  ConnectorRunLifecycleDetails,
  ConnectorRunProgressDetails,
  connectorRunMetrics,
} from './ConnectorRunDetails'
import {
  connectorAuthStatusLabel,
  connectorAuthStatusMessage,
  interpretJobrightSettings,
  isConnectorAuthReady,
  isJobrightCredentialsConfigured,
} from './connector-settings.helpers'
import type {
  ConnectorAuthCredentialDraft,
  ConnectorAuthUiState,
  ConnectorSettingsDraft,
  ConnectorSettingsInstance,
  ConnectorSettingsRun,
} from './connector-settings.types'

export function ConnectorSettingsInstanceCard({
  instance,
  authState,
  draft,
  credentialDraft,
  isEditingAuth,
  latestRun,
  latestRunStatus,
  isSavingSettings,
  authenticatingInstanceId,
  runningInstanceId,
  onBeginCredentialEdit,
  onCancelCredentialEdit,
  onUpdateCredentialDraft,
  onSaveAndValidateCredentials,
  onRevalidateCredentials,
  onUpdateDraft,
  onSaveSettings,
  onDiscardSettings,
  onRunNow,
  isDraftDirty,
  onOpenSourcingRuns,
}: {
  instance: ConnectorSettingsInstance
  authState: ConnectorAuthUiState
  draft: ConnectorSettingsDraft
  credentialDraft: ConnectorAuthCredentialDraft
  isEditingAuth: boolean
  latestRun: ConnectorSettingsRun | undefined
  latestRunStatus: string | undefined
  isSavingSettings: boolean
  authenticatingInstanceId: string | null
  runningInstanceId: string | null
  onBeginCredentialEdit: (instance: ConnectorSettingsInstance) => void
  onCancelCredentialEdit: (instanceId: string) => void
  onUpdateCredentialDraft: (instanceId: string, patch: Partial<ConnectorAuthCredentialDraft>) => void
  onSaveAndValidateCredentials: (instance: ConnectorSettingsInstance) => void
  onRevalidateCredentials: (instance: ConnectorSettingsInstance) => void
  onUpdateDraft: (instanceId: string, patch: Partial<ConnectorSettingsDraft>) => void
  onSaveSettings: (instance: ConnectorSettingsInstance) => void
  onDiscardSettings: (instance: ConnectorSettingsInstance) => void
  onRunNow: (instance: ConnectorSettingsInstance) => void
  isDraftDirty: (instance: ConnectorSettingsInstance) => boolean
  onOpenSourcingRuns?: (runId?: string) => void
}) {
  const authConfigured = isJobrightCredentialsConfigured(instance)
  const authReady = isConnectorAuthReady(authState)
  const authLabel = connectorAuthStatusLabel(authState, authConfigured)
  const authMessage = connectorAuthStatusMessage(authState)
  const runMetrics = latestRun ? connectorRunMetrics(latestRun) : []
  const retryGuidance = (() => {
    const advice = retryAdviceSchema.safeParse(latestRun?.retryHints)
    return advice.success ? formatRetryAdviceGuidance(advice.data) : null
  })()
  const isJobrightInstance = instance.connectorId === JOBRIGHT_CONNECTOR_ID
  const settingsInterpretation = isJobrightInstance
    ? interpretJobrightSettings(instance, draft)
    : null

  return (
                  <div
                    key={instance.id}
                    className="grid gap-4 p-3 text-sm"
                    data-testid={`connector-instance-card-${instance.id}`}
                  >
                    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{instance.displayName}</p>
                        <p className="text-xs text-muted-foreground">{instance.connectorId}</p>
                      </div>
                      <div
                        className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end"
                        data-testid={`connector-auth-actions-${instance.id}`}
                      >
                        <p className="text-xs font-medium text-muted-foreground">
                          {authLabel}
                        </p>
                        {!isEditingAuth ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={authenticatingInstanceId === instance.id}
                            onClick={() => onBeginCredentialEdit(instance)}
                          >
                            {authConfigured ? 'Update credentials' : 'Add credentials'}
                          </Button>
                        ) : null}
                        {authConfigured && !isEditingAuth ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={authenticatingInstanceId === instance.id}
                            onClick={() => onRevalidateCredentials(instance)}
                          >
                            {authenticatingInstanceId === instance.id ? 'Validating...' : 'Validate'}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {isEditingAuth ? (
                      <div
                        className="grid min-w-0 gap-3 rounded-md border border-border p-3 lg:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto] xl:items-end"
                        data-testid={`connector-credential-form-${instance.id}`}
                      >
                        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                          Jobright email
                          <input
                            aria-label="Jobright email"
                            autoComplete="off"
                            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                            type="email"
                            value={credentialDraft.email}
                            onChange={(event) =>
                              onUpdateCredentialDraft(instance.id, { email: event.target.value })}
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                          Jobright password
                          <input
                            aria-label="Jobright password"
                            autoComplete="new-password"
                            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                            type="password"
                            value={credentialDraft.password}
                            onChange={(event) =>
                              onUpdateCredentialDraft(instance.id, { password: event.target.value })}
                          />
                        </label>
                        <Button
                          type="button"
                          disabled={authenticatingInstanceId === instance.id}
                          onClick={() => onSaveAndValidateCredentials(instance)}
                        >
                          {authenticatingInstanceId === instance.id ? 'Validating...' : 'Save and validate'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={authenticatingInstanceId === instance.id}
                          onClick={() => onCancelCredentialEdit(instance.id)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Credentials are write-only. Saved values are never shown again.
                      </p>
                    )}

                    {authMessage ? (
                      <p
                        className={authReady
                          ? 'text-xs text-success'
                          : 'text-xs text-warning'}
                        role="status"
                      >
                        {authMessage}
                      </p>
                    ) : null}

                    {isJobrightInstance ? (
                    <>
                    <div
                      className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_12rem_auto_auto] xl:items-end"
                      data-testid={`connector-run-actions-${instance.id}`}
                    >
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Role terms
                        <input
                          aria-label="Role terms"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          disabled={isSavingSettings}
                          value={draft.roleTerms}
                          onChange={(event) =>
                            onUpdateDraft(instance.id, { roleTerms: event.target.value })}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Useful results target
                        <input
                          aria-label="Useful results target"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          disabled={isSavingSettings}
                          max={JOBRIGHT_MAX_USEFUL_TARGET}
                          min={JOBRIGHT_MIN_USEFUL_TARGET}
                          type="number"
                          value={draft.usefulTarget}
                          onChange={(event) =>
                            onUpdateDraft(instance.id, { usefulTarget: event.target.value })}
                        />
                        <span className="font-normal text-muted-foreground">
                          Bounded backfill intent across runs, not per-run discovery or resolution volume.
                        </span>
                      </label>
                      <div className="grid gap-1 text-xs text-muted-foreground xl:col-span-full">
                        <p>{settingsInterpretation!.savedUsefulTargetLabel}</p>
                        {settingsInterpretation!.draftUsefulTargetLabel ? (
                          <p>{settingsInterpretation!.draftUsefulTargetLabel}</p>
                        ) : null}
                        <p>{settingsInterpretation!.requestedAttemptsLabel}</p>
                        <p>{settingsInterpretation!.effectiveAttemptsLabel}</p>
                      </div>
                      <details className="xl:col-span-full">
                        <summary className="cursor-pointer text-xs font-medium text-foreground">
                          Advanced connector limits
                        </summary>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                            Discovery page size
                            <input
                              aria-label="Discovery page size"
                              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                              disabled={isSavingSettings}
                              max={JOBRIGHT_MAX_DISCOVERY_COUNT}
                              min={JOBRIGHT_MIN_DISCOVERY_COUNT}
                              type="number"
                              value={draft.discoveryCount}
                              onChange={(event) =>
                                onUpdateDraft(instance.id, { discoveryCount: event.target.value })}
                            />
                          </label>
                          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                            Discovery page limit
                            <input
                              aria-label="Discovery page limit"
                              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                              disabled={isSavingSettings}
                              max={JOBRIGHT_MAX_MAX_DISCOVERY_PAGES}
                              min={JOBRIGHT_MIN_MAX_DISCOVERY_PAGES}
                              type="number"
                              value={draft.maxDiscoveryPages}
                              onChange={(event) =>
                                onUpdateDraft(instance.id, {
                                  maxDiscoveryPages: event.target.value,
                                })}
                            />
                          </label>
                          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                            Discovery record limit
                            <input
                              aria-label="Discovery record limit"
                              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                              disabled={isSavingSettings}
                              max={JOBRIGHT_MAX_MAX_DISCOVERY_RECORDS}
                              min={JOBRIGHT_MIN_MAX_DISCOVERY_RECORDS}
                              type="number"
                              value={draft.maxDiscoveryRecords}
                              onChange={(event) =>
                                onUpdateDraft(instance.id, {
                                  maxDiscoveryRecords: event.target.value,
                                })}
                            />
                          </label>
                          <label className="grid gap-1 text-xs font-medium text-muted-foreground md:col-span-2 xl:col-span-3">
                            Requested detail-resolution attempts
                            <input
                              aria-label="Requested detail-resolution attempts"
                              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                              disabled={isSavingSettings}
                              max={JOBRIGHT_HOST_REQUEST_BUDGET}
                              min={1}
                              type="number"
                              value={draft.maxResolutionCount}
                              onChange={(event) =>
                                onUpdateDraft(instance.id, {
                                  maxResolutionCount: event.target.value,
                                })}
                            />
                            {settingsInterpretation!.legacyResolution ? (
                              <span className="font-normal">
                                Saved value is labeled legacy; effective attempts remain
                                {' '}
                                {settingsInterpretation!.effectiveAttempts}
                                .
                              </span>
                            ) : null}
                          </label>
                          <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-3">
                            Host request budget: effective {JOBRIGHT_HOST_REQUEST_BUDGET} requests/run;
                            connector-supported maximum {JOBRIGHT_CONNECTOR_MAX_REQUESTS_PER_RUN}.
                            The host budget currently takes precedence, so this value is disclosure-only.
                          </p>
                          <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-3">
                            Pacing: concurrency {JOBRIGHT_PACING_CONCURRENCY},
                            {' '}
                            {JOBRIGHT_PACING_MIN_DELAY_SECONDS}–{JOBRIGHT_PACING_MAX_DELAY_SECONDS}
                            {' '}
                            seconds between bounded requests (disclosure-only).
                          </p>
                        </div>
                      </details>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isSavingSettings}
                        onClick={() => onSaveSettings(instance)}
                      >
                        {isSavingSettings ? 'Saving...' : 'Save Jobright settings'}
                      </Button>
                      {isDraftDirty(instance) && !isSavingSettings ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onDiscardSettings(instance)}
                        >
                          Discard unsaved settings
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        disabled={!authReady || runningInstanceId === instance.id || isSavingSettings}
                        onClick={() => onRunNow(instance)}
                      >
                        {runningInstanceId === instance.id ? 'Running...' : 'Run Jobright now'}
                      </Button>
                    </div>
                    {latestRunStatus ? (
                      <div
                        aria-atomic="true"
                        aria-label={`${instance.displayName} run progress`}
                        aria-live="polite"
                        className="grid gap-2"
                        role="status"
                      >
                        <p className="text-xs font-medium text-muted-foreground">
                          Latest run: {latestRunStatus}
                        </p>
                        {retryGuidance ? (
                          <p className="text-xs font-medium text-muted-foreground">{retryGuidance}</p>
                        ) : null}
                        {latestRun ? <ConnectorRunProgressDetails run={latestRun} /> : null}
                        {latestRun ? <ConnectorRunLifecycleDetails run={latestRun} /> : null}
                        {runMetrics.length > 0 ? (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {runMetrics.map((metric) => (
                              <span key={metric.label}>{metric.label}: {metric.value}</span>
                            ))}
                          </div>
                        ) : null}
                        {latestRun ? (
                          <Button
                            aria-label={`View ${latestRun.id} in Connector Runs`}
                            className="w-fit"
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => onOpenSourcingRuns?.(latestRun.id)}
                          >
                            View in Connector Runs
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    </>
                    ) : null}
                  </div>
                )
}
