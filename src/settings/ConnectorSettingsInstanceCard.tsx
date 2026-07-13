import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_MAX_DISCOVERY_COUNT,
  JOBRIGHT_MIN_DISCOVERY_COUNT,
} from '../modules/connectors/jobright.constants'
import { formatRetryAdviceGuidance } from '../modules/connectors/connector.retry-guidance'
import { retryAdviceSchema } from 'sparxie'
import {
  ConnectorRunLifecycleDetails,
  ConnectorRunProgressDetails,
  connectorRunMetrics,
} from './ConnectorRunDetails'
import { ConnectorEarliestBackfillDateControl } from './ConnectorEarliestBackfillDateControl'
import {
  connectorAuthStatusLabel,
  connectorAuthStatusMessage,
  isConnectorAuthReady,
  isJobrightCredentialsConfigured,
} from './connector-settings.helpers'
import {
  maximumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../modules/connectors/connector.earliest-backfill'
import type {
  ConnectorAuthCredentialDraft,
  ConnectorAuthUiState,
  ConnectorSettingsDraft,
  ConnectorSettingsInstance,
  ConnectorSettingsRun,
} from './connector-settings.types'
import type { ConnectorSchedulingCapability, ConnectorScheduleSummary } from 'sparxie'
import { ConnectorScheduleControls } from './ConnectorScheduleControls'
import type { ConnectorScheduleDraft } from './connector-schedule.types'

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
  schedulingCapability,
  capabilityLoadError,
  scheduleCanonical,
  scheduleDraft,
  scheduleIsDirty,
  scheduleIsLoading,
  scheduleIsSaving,
  scheduleStatusMessage,
  scheduleStatusTone,
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
  onScheduleDraftChange,
  onSaveSchedule,
  onDiscardSchedule,
  onPauseSchedule,
  onResumeSchedule,
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
  schedulingCapability: ConnectorSchedulingCapability | null
  capabilityLoadError: string | null
  scheduleCanonical: ConnectorScheduleSummary | null
  scheduleDraft: ConnectorScheduleDraft
  scheduleIsDirty: boolean
  scheduleIsLoading: boolean
  scheduleIsSaving: boolean
  scheduleStatusMessage: string | null
  scheduleStatusTone: 'idle' | 'success' | 'error'
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
  onScheduleDraftChange: (instanceId: string, patch: Partial<ConnectorScheduleDraft>) => void
  onSaveSchedule: (instance: ConnectorSettingsInstance) => void
  onDiscardSchedule: (instance: ConnectorSettingsInstance) => void
  onPauseSchedule: (instance: ConnectorSettingsInstance) => void
  onResumeSchedule: (instance: ConnectorSettingsInstance) => void
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
  const earliestValid = validateSelectableEarliestBackfillDate({
    candidate: draft.earliestBackfillDate,
    createdAt: instance.createdAt,
    todayUtc: maximumSelectableEarliestBackfillDate(new Date().toISOString()),
  }).ok
  const runBlocked = !authReady
    || runningInstanceId === instance.id
    || isSavingSettings
    || isDraftDirty(instance)
    || !earliestValid

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

                    {isJobrightInstance ? (
                      <p className="text-xs text-muted-foreground">
                        A Jobright password is required. A Gmail address is only the username and does
                        not initiate Google OAuth. Google-only Jobright accounts are currently
                        unsupported until Jobright provides a supported desktop handoff.
                      </p>
                    ) : null}

                    {isEditingAuth ? (
                      <div
                        className="grid min-w-0 gap-3 rounded-md border border-border p-3 lg:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto] xl:items-end"
                        data-testid={`connector-credential-form-${instance.id}`}
                      >
                        <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
                          Jobright email
                          <Input
                            aria-label="Jobright email"
                            autoComplete="off"
                            type="email"
                            value={credentialDraft.email}
                            onChange={(event) =>
                              onUpdateCredentialDraft(instance.id, { email: event.target.value })}
                          />
                        </Label>
                        <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
                          Jobright password
                          <Input
                            aria-label="Jobright password"
                            autoComplete="new-password"
                            type="password"
                            value={credentialDraft.password}
                            onChange={(event) =>
                              onUpdateCredentialDraft(instance.id, { password: event.target.value })}
                          />
                        </Label>
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

                    <ConnectorScheduleControls
                      capability={schedulingCapability}
                      capabilityLoadError={capabilityLoadError}
                      canonical={scheduleCanonical}
                      connectorDisplayName={instance.displayName}
                      connectorEnabled={instance.enabled}
                      draft={scheduleDraft}
                      isDirty={scheduleIsDirty}
                      isLoading={scheduleIsLoading}
                      isSaving={scheduleIsSaving}
                      statusMessage={scheduleStatusMessage}
                      statusTone={scheduleStatusTone}
                      onDiscard={() => onDiscardSchedule(instance)}
                      onDraftChange={(patch) => onScheduleDraftChange(instance.id, patch)}
                      onPause={() => onPauseSchedule(instance)}
                      onResume={() => onResumeSchedule(instance)}
                      onSave={() => onSaveSchedule(instance)}
                    />

                    {isJobrightInstance ? (
                    <>
                    <ConnectorEarliestBackfillDateControl
                      createdAt={instance.createdAt}
                      disabled={isSavingSettings}
                      instanceId={instance.id}
                      value={draft.earliestBackfillDate}
                      onChange={(earliestBackfillDate) =>
                        onUpdateDraft(instance.id, { earliestBackfillDate })}
                    />
                    <div
                      className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_12rem_auto_auto] xl:items-end"
                      data-testid={`connector-run-actions-${instance.id}`}
                    >
                      <details className="xl:col-span-full">
                        <summary className="cursor-pointer text-xs font-medium text-foreground">Connector settings</summary>
                        <div className="mt-3 grid gap-3">
                          <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
                            Discovery page size
                            <Input
                              aria-label="Discovery page size"
                              disabled={isSavingSettings}
                              max={JOBRIGHT_MAX_DISCOVERY_COUNT}
                              min={JOBRIGHT_MIN_DISCOVERY_COUNT}
                              type="number"
                              value={draft.discoveryCount}
                              onChange={(event) =>
                                onUpdateDraft(instance.id, { discoveryCount: event.target.value })}
                            />
                          </Label>
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
                        disabled={runBlocked}
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
