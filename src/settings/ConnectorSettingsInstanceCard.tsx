import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { FormFailureAlert } from '@/components/ui/error-primitives'
import { Input } from '@/components/ui/input'
import type { ErrorPresentation } from '../app/error-presentation'
import { Switch } from '@/components/ui/switch'
import { fieldControlId } from '@/lib/field-control-id'
import { AlertTriangle, ChevronDown, Pencil } from 'lucide-react'
import { JOBRIGHT_CONNECTOR_ID } from '../modules/connectors/jobright.constants'
import {
  ConnectorRunLifecycleDetails,
  ConnectorRunSynchronizationDetails,
} from './ConnectorRunDetails'
import { connectorRunSynchronizationCopy } from '../modules/connectors/connector.run-presentation'
import { ConnectorEarliestBackfillDateControl } from './ConnectorEarliestBackfillDateControl'
import {
  connectorAuthStatusLabel,
  connectorAuthStatusMessage,
  isConnectorAuthReady,
  isJobrightCredentialsConfigured,
  isUnchangedConnectorDisable,
} from './connector-settings.helpers'
import {
  describeConnectorCredentialBlockReason,
  describeConnectorRunActionReason,
  describeConnectorSaveActionReason,
  describeConnectorSettingsBlockReason,
  isBrowserAlignedEmail,
  isConnectorCredentialDraftReady,
} from './connector-action-state'
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
import type { InstalledConnectorDescriptor } from 'sparxie'
import { ConnectorScheduleControls } from './ConnectorScheduleControls'
import type { ConnectorScheduleDraft } from './connector-schedule.types'
import type { ConnectorSettingsUiApi } from './connector-settings.types'
import {
  ConnectorProviderFilters,
  ConnectorSynchronizationConfiguration,
} from './connector-filters/ConnectorProviderFilters'
import {
  validateConnectorConfigPersistenceValue,
  validateConnectorSchemaValue,
} from '../modules/connectors/connector.renderer-schema-validation'
import {
  dynamicBindingPointers,
  evaluateVersionedPresentationCompatibility,
} from './connector-filters/connector-presentation'

export function ConnectorSettingsInstanceCard({
  instance,
  descriptor,
  connectorsApi,
  authState,
  credentialEditFeedback,
  draft,
  credentialDraft,
  isEditingAuth,
  latestRun,
  latestRunStatus,
  isSavingSettings,
  settingsSaveError,
  isRemoving,
  authenticatingInstanceId,
  runningInstanceIds,
  schedulingCapability,
  capabilityLoadError,
  scheduleCanonical,
  scheduleDraft,
  scheduleIsDirty,
  scheduleIsLoading,
  scheduleIsSaving,
  scheduleLoadFailure,
  scheduleStatusMessage,
  scheduleStatusTone,
  scheduleValidationField,
  onBeginCredentialEdit,
  onCancelCredentialEdit,
  onUpdateCredentialDraft,
  onSaveAndValidateCredentials,
  onRevalidateCredentials,
  onUpdateDraft,
  onSaveSettings,
  onDiscardSettings,
  onRunNow,
  onRemove,
  isDraftDirty,
  onOpenConnectorRuns,
  onScheduleDraftChange,
  onSaveSchedule,
  onDiscardSchedule,
  onPauseSchedule,
  onResumeSchedule,
  onRetryScheduleLoad,
}: {
  instance: ConnectorSettingsInstance
  descriptor: InstalledConnectorDescriptor | undefined
  connectorsApi: ConnectorSettingsUiApi
  authState: ConnectorAuthUiState
  credentialEditFeedback: string | null
  draft: ConnectorSettingsDraft
  credentialDraft: ConnectorAuthCredentialDraft
  isEditingAuth: boolean
  latestRun: ConnectorSettingsRun | undefined
  latestRunStatus: string | undefined
  isSavingSettings: boolean
  settingsSaveError: string | null
  isRemoving: boolean
  authenticatingInstanceId: string | null
  runningInstanceIds: ReadonlySet<string>
  schedulingCapability: ConnectorSchedulingCapability | null
  capabilityLoadError: ErrorPresentation | null
  scheduleCanonical: ConnectorScheduleSummary | null
  scheduleDraft: ConnectorScheduleDraft
  scheduleIsDirty: boolean
  scheduleIsLoading: boolean
  scheduleIsSaving: boolean
  scheduleLoadFailure: ErrorPresentation | null
  scheduleStatusMessage: string | null
  scheduleStatusTone: 'idle' | 'success' | 'error'
  scheduleValidationField: import('./connector-schedule.helpers').ConnectorScheduleValidationField | null
  onBeginCredentialEdit: (instance: ConnectorSettingsInstance) => void
  onRetryScheduleLoad: () => void
  onCancelCredentialEdit: (instanceId: string) => void
  onUpdateCredentialDraft: (instanceId: string, patch: Partial<ConnectorAuthCredentialDraft>) => void
  onSaveAndValidateCredentials: (instance: ConnectorSettingsInstance) => void
  onRevalidateCredentials: (instance: ConnectorSettingsInstance) => void
  onUpdateDraft: (instanceId: string, patch: Partial<ConnectorSettingsDraft>) => void
  onSaveSettings: (instance: ConnectorSettingsInstance) => Promise<boolean>
  onDiscardSettings: (instance: ConnectorSettingsInstance) => void
  onRunNow: (instance: ConnectorSettingsInstance) => void
  onRemove: (instance: ConnectorSettingsInstance) => void
  isDraftDirty: (instance: ConnectorSettingsInstance) => boolean
  onOpenConnectorRuns?: (runId?: string) => void
  onScheduleDraftChange: (instanceId: string, patch: Partial<ConnectorScheduleDraft>) => void
  onSaveSchedule: (instance: ConnectorSettingsInstance) => Promise<boolean>
  onDiscardSchedule: (instance: ConnectorSettingsInstance) => void
  onPauseSchedule: (instance: ConnectorSettingsInstance) => void
  onResumeSchedule: (instance: ConnectorSettingsInstance) => void
}) {
  const [providerFiltersCompatible, setProviderFiltersCompatible] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [isSavingAll, setIsSavingAll] = useState(false)
  const [saveConfirmationOpen, setSaveConfirmationOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(true)
  const authConfigured = isJobrightCredentialsConfigured(instance)
  const authReady = isConnectorAuthReady(authState)
  const authLabel = connectorAuthStatusLabel(authState, authConfigured)
  const authMessage = connectorAuthStatusMessage(authState)
  const latestSynchronization = latestRun ? connectorRunSynchronizationCopy(latestRun) : null
  const isJobrightInstance = instance.connectorId === JOBRIGHT_CONNECTOR_ID
  const earliestValidation = isJobrightInstance
    ? validateSelectableEarliestBackfillDate({
      candidate: draft.earliestBackfillDate,
      createdAt: instance.createdAt,
      todayUtc: maximumSelectableEarliestBackfillDate(new Date().toISOString()),
    })
    : { ok: true as const, value: draft.earliestBackfillDate }
  const earliestValid = earliestValidation.ok
  const earliestMessage = earliestValidation.ok ? null : earliestValidation.message
  const filterIssues = descriptor?.filterSchema
    ? validateConnectorSchemaValue(descriptor.filterSchema.schema, draft.filters, {
        allowMissingRootRequired: !draft.enabled,
      })
    : []
  const configIssues = descriptor?.configSchema
    ? validateConnectorConfigPersistenceValue(descriptor.configSchema.schema, draft.config, {
        allowMissingRootRequired: !draft.enabled,
      })
    : []
  const filtersValid = filterIssues.length === 0
  const configValid = configIssues.length === 0
  const configPresentationCompatible = evaluateVersionedPresentationCompatibility(
    descriptor?.configSchema,
  ).compatible
  const filterPresentationCompatible = evaluateVersionedPresentationCompatibility(
    descriptor?.filterSchema,
    { requiredDynamicPointers: dynamicBindingPointers(descriptor?.dynamicOptions) },
  ).compatible
  const descriptorRequired = connectorsApi.descriptors !== undefined
  const descriptorCompatible = !descriptorRequired || descriptor !== undefined
  const safeDisable = descriptorCompatible && isUnchangedConnectorDisable(instance, draft)
  const settingsValid = descriptorCompatible
    && filtersValid
    && configValid
    && configPresentationCompatible
    && filterPresentationCompatible
    && earliestValid
    && (descriptor?.dynamicOptions ? providerFiltersCompatible : true)
  const settingsSaveAllowed = settingsValid || safeDisable
  const settingsBlockReason = describeConnectorSettingsBlockReason({
    descriptorCompatible,
    filterIssues,
    configIssues,
    presentationCompatible: configPresentationCompatible && filterPresentationCompatible,
    providerFiltersCompatible: !descriptor?.dynamicOptions || providerFiltersCompatible,
    earliestValid,
    earliestMessage,
  })
  const draftDirty = isDraftDirty(instance)
  const runBlocked = !instance.enabled
    || !draft.enabled
    || !authReady
    || isEditingAuth
    || runningInstanceIds.has(instance.id)
    || isSavingSettings
    || draftDirty
    || !earliestValid
    || !settingsValid
  const saveBlockReason = describeConnectorSaveActionReason({
    isSaving: isSavingSettings,
    settingsSaveAllowed,
    settingsBlockReason: settingsSaveAllowed ? null : settingsBlockReason,
  })
  const runBlockReason = runBlocked
    ? describeConnectorRunActionReason({
      isRunning: runningInstanceIds.has(instance.id),
      isSavingSettings,
      isEditingAuth,
      draftDirty,
      settingsValid,
      earliestValid,
      earliestMessage,
      authReady,
      connectorEnabled: instance.enabled,
      draftEnabled: draft.enabled,
      settingsBlockReason: settingsSaveAllowed ? null : settingsBlockReason,
    })
    : null
  const saveReasonId = `connector-save-reason-${instance.id}`
  const runReasonId = `connector-run-reason-${instance.id}`
  const credentialsReady = isConnectorCredentialDraftReady(credentialDraft)
  const credentialBlockReason = describeConnectorCredentialBlockReason(credentialDraft)
  const credentialReasonId = `connector-credential-reason-${instance.id}`
  const emailInvalid = credentialDraft.email.trim().length > 0
    && !isBrowserAlignedEmail(credentialDraft.email)
  const cardHeadingId = `connector-heading-${instance.id}`
  const credentialsHeadingId = `connector-credentials-heading-${instance.id}`
  const connectorSettingsHeadingId = `connector-settings-heading-${instance.id}`
  const executionHeadingId = `connector-execution-heading-${instance.id}`
  const managementHeadingId = `connector-management-heading-${instance.id}`
  const executionActionsDescribedBy = runBlockReason ? runReasonId : undefined
  const scheduleSummary = capabilityLoadError
    ? 'Schedule unavailable'
    : scheduleIsLoading
      ? 'Schedule loading'
      : scheduleCanonical?.state === 'paused'
        ? 'Schedule paused'
        : scheduleCanonical
          ? 'Scheduled'
          : 'Manual only'
  const latestRunSummary = latestSynchronization?.label
    ?? (latestRunStatus ? `Run ${latestRunStatus}` : 'No runs yet')
  const interactionBusy = isSavingAll || isSavingSettings || scheduleIsSaving
  const hasUnsavedChanges = draftDirty || scheduleIsDirty
  const unifiedSaveBlockReason = isEditingAuth
    ? 'Save or cancel the credential update before saving other changes.'
    : saveBlockReason
  const wouldRemovePersistedSchedule = scheduleIsDirty
    && scheduleDraft.mode === 'manual'
    && scheduleCanonical !== null

  function cancelEditing() {
    if (interactionBusy) return
    onDiscardSettings(instance)
    onDiscardSchedule(instance)
    if (isEditingAuth) onCancelCredentialEdit(instance.id)
    setEditing(false)
  }

  async function persistChanges() {
    if (interactionBusy || !hasUnsavedChanges || unifiedSaveBlockReason) return
    setIsSavingAll(true)
    try {
      if (draftDirty && !(await onSaveSettings(instance))) return
      if (scheduleIsDirty && !(await onSaveSchedule(instance))) return
      setSaveConfirmationOpen(false)
    } finally {
      setIsSavingAll(false)
    }
  }

  function saveChanges() {
    if (wouldRemovePersistedSchedule) {
      setSaveConfirmationOpen(true)
      return
    }
    void persistChanges()
  }

  function handleDetailsOpenChange(open: boolean) {
    if (!open && editing) return
    setDetailsOpen(open)
  }

  return (
    <Dialog open={detailsOpen} onOpenChange={handleDetailsOpenChange}>
      <Collapsible
        className="rounded-md border border-border bg-card text-sm"
        data-testid={`connector-instance-summary-${instance.id}`}
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
      >
        <div className="flex min-w-0 items-center gap-3 p-3">
          <CollapsibleTrigger asChild>
            <Button
              aria-label={`${summaryOpen ? 'Collapse' : 'Expand'} ${instance.displayName} summary`}
              className="shrink-0"
              size="icon"
              type="button"
              variant="ghost"
            >
              <ChevronDown
                aria-hidden="true"
                className={`size-4 transition-transform ${summaryOpen ? '' : '-rotate-90'}`}
              />
            </Button>
          </CollapsibleTrigger>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium text-foreground" id={cardHeadingId}>
              {instance.displayName}
            </h3>
            <p className="truncate text-xs text-muted-foreground">{instance.connectorId}</p>
          </div>
          <Badge variant={instance.enabled ? 'success' : 'secondary'}>
            {instance.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        <CollapsibleContent>
          <div className="grid gap-3 border-t border-border/70 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="flex min-w-0 flex-wrap gap-2">
              <Badge variant={authSummaryVariant(authReady, authConfigured)}>{authLabel}</Badge>
              <Badge variant="outline">{scheduleSummary}</Badge>
              <Badge variant="outline">{latestRunSummary}</Badge>
              {draftDirty || scheduleIsDirty ? <Badge variant="warning">Unsaved changes</Badge> : null}
            </div>
            <DialogTrigger asChild>
              <Button type="button" variant="outline">
                View {instance.displayName} details
              </Button>
            </DialogTrigger>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        data-testid={editing ? `connector-instance-card-${instance.id}` : undefined}
        onEscapeKeyDown={(event) => {
          if (editing) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (editing) event.preventDefault()
        }}
        showCloseButton={!editing}
      >
        <DialogHeader
          className={editing
            ? 'border-b border-border px-6 py-5'
            : 'border-b border-border px-6 py-5 pr-16'}
        >
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DialogTitle>{instance.displayName} details</DialogTitle>
                {editing ? <Badge variant="warning">Editing</Badge> : null}
              </div>
              <DialogDescription className="mt-1">
                {instance.connectorId}. Review connector status and configuration.
              </DialogDescription>
            </div>
            {!editing ? (
              <Button onClick={() => setEditing(true)} type="button">
                <Pencil aria-hidden="true" className="size-4" />
                Edit connector
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-0 px-6 pb-6 text-sm">

      <section
        aria-labelledby={`${cardHeadingId} ${credentialsHeadingId}`}
        className="grid gap-3 border-b border-border/70 py-5"
      >
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground" id={credentialsHeadingId}>
              Credentials
            </h4>
            {isJobrightInstance ? (
              <p className="mt-1 text-xs text-muted-foreground">
                A Jobright password is required. A Gmail address is only the username and does
                not initiate Google OAuth. Google-only Jobright accounts are currently
                unsupported until Jobright provides a supported desktop handoff.
              </p>
            ) : null}
          </div>
          <div
            className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end"
            data-testid={`connector-auth-actions-${instance.id}`}
          >
            <p className="text-xs font-medium text-muted-foreground">
              Status: {authLabel}
            </p>
            {editing && !isEditingAuth ? (
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
            {editing && authConfigured && !isEditingAuth ? (
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

        {editing && isEditingAuth ? (
          <div
            className="grid min-w-0 gap-3 border-t border-border/70 pt-4 lg:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto] xl:items-end"
            data-testid={`connector-credential-form-${instance.id}`}
          >
            <Field
              className="grid gap-1 text-xs font-medium text-muted-foreground"
              data-invalid={emailInvalid ? true : undefined}
            >
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId(`connector-${instance.id}`, 'Jobright email')}
              >
                Jobright email
              </FieldLabel>
              <Input
                aria-describedby={credentialBlockReason ? credentialReasonId : undefined}
                aria-invalid={emailInvalid}
                autoComplete="off"
                id={fieldControlId(`connector-${instance.id}`, 'Jobright email')}
                required
                type="email"
                value={credentialDraft.email}
                onChange={(event) =>
                  onUpdateCredentialDraft(instance.id, { email: event.target.value })}
              />
            </Field>
            <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId(`connector-${instance.id}`, 'Jobright password')}
              >
                Jobright password
              </FieldLabel>
              <Input
                aria-describedby={credentialBlockReason ? credentialReasonId : undefined}
                autoComplete="new-password"
                id={fieldControlId(`connector-${instance.id}`, 'Jobright password')}
                required
                type="password"
                value={credentialDraft.password}
                onChange={(event) =>
                  onUpdateCredentialDraft(instance.id, { password: event.target.value })}
              />
            </Field>
            <div
              aria-describedby={credentialBlockReason ? credentialReasonId : undefined}
              aria-label="Credential save actions"
              className="grid gap-2 sm:grid-cols-[auto_auto] sm:items-end xl:col-span-2"
              data-testid={`connector-credential-actions-${instance.id}`}
              role="group"
              tabIndex={credentialBlockReason ? 0 : undefined}
            >
              {credentialBlockReason ? (
                <p
                  className="text-xs text-warning sm:col-span-2"
                  id={credentialReasonId}
                >
                  {credentialBlockReason}
                </p>
              ) : null}
              <Button
                type="button"
                aria-describedby={credentialBlockReason ? credentialReasonId : undefined}
                disabled={authenticatingInstanceId === instance.id || !credentialsReady}
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

        {credentialEditFeedback ? (
          <p className="text-xs text-muted-foreground" role="status">
            {credentialEditFeedback}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby={`${cardHeadingId} ${connectorSettingsHeadingId}`}
        className="grid gap-3 border-b border-border/70 py-5"
      >
        <div className="grid gap-1">
          <h4 className="text-sm font-semibold text-foreground" id={connectorSettingsHeadingId}>
            Connector settings
          </h4>
          <p className="text-xs text-muted-foreground">
            These changes
            {isJobrightInstance ? ', including the earliest backfill date,' : ''}
            {' '}are included when you save the connector.
          </p>
        </div>

        {!descriptorCompatible ? (
          <Alert role="alert" variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Connector descriptor is unavailable</AlertTitle>
            <AlertDescription>
              These saved settings cannot be checked for compatibility, so saving is blocked.
            </AlertDescription>
          </Alert>
        ) : null}

        {descriptor?.configSchema ? (
          <ConnectorSynchronizationConfiguration
            allowMissingRootRequired={!draft.enabled}
            config={draft.config}
            declaration={descriptor.configSchema}
            disabled={!editing || isSavingSettings}
            instanceId={instance.id}
            regionLabel={`${instance.displayName} synchronization configuration`}
            onChange={(config) => onUpdateDraft(instance.id, { config })}
          />
        ) : null}

        {descriptor?.filterSchema && connectorsApi.options ? (
          <ConnectorProviderFilters
            api={connectorsApi.options}
            allowMissingRootRequired={!draft.enabled}
            descriptor={descriptor}
            disabled={!editing || isSavingSettings}
            filters={draft.filters}
            instanceId={instance.id}
            regionLabel={`${instance.displayName} provider filters`}
            onChange={(filters) => onUpdateDraft(instance.id, { filters })}
            compatibilityAlertRole={configIssues.length === 0 ? 'alert' : 'status'}
            onCompatibilityChange={setProviderFiltersCompatible}
          />
        ) : null}

        <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-4">
          <div>
            <p className="text-sm font-medium text-foreground">Connector enabled</p>
            <p className="text-xs text-muted-foreground">
              Disabled connectors cannot start manual or scheduled work.
            </p>
          </div>
          <Switch
            aria-label={isJobrightInstance
              ? 'Jobright connector enabled'
              : !settingsValid
                ? 'Enabled'
                : `${instance.displayName} connector enabled`}
            checked={draft.enabled}
            disabled={!editing || isSavingSettings || (!filtersValid && !draft.enabled)}
            onCheckedChange={(enabled) => onUpdateDraft(instance.id, { enabled })}
          />
        </div>

        {isJobrightInstance ? (
          <ConnectorEarliestBackfillDateControl
            createdAt={instance.createdAt}
            disabled={!editing || isSavingSettings}
            instanceId={instance.id}
            value={draft.earliestBackfillDate}
            onChange={(earliestBackfillDate) =>
              onUpdateDraft(instance.id, { earliestBackfillDate })}
          />
        ) : null}

      </section>

      <ConnectorScheduleControls
        capability={schedulingCapability}
        capabilityLoadError={capabilityLoadError}
        canonical={scheduleCanonical}
        connectorDisplayName={instance.displayName}
        connectorEnabled={draft.enabled}
        draft={scheduleDraft}
        isDirty={scheduleIsDirty}
        isLoading={scheduleIsLoading}
        isSaving={scheduleIsSaving}
        loadFailure={scheduleLoadFailure}
        statusMessage={scheduleStatusMessage}
        statusTone={scheduleStatusTone}
        validationField={scheduleValidationField}
        readOnly={!editing}
        showDraftActions={false}
        onDiscard={() => onDiscardSchedule(instance)}
        onDraftChange={(patch) => onScheduleDraftChange(instance.id, patch)}
        onPause={() => onPauseSchedule(instance)}
        onResume={() => onResumeSchedule(instance)}
        onRetryLoad={onRetryScheduleLoad}
        onSave={() => onSaveSchedule(instance)}
      />

      {isJobrightInstance ? (
        <section
          aria-labelledby={`${cardHeadingId} ${executionHeadingId}`}
          className="grid gap-3 border-b border-border/70 py-5"
        >
          <h4 className="text-sm font-semibold text-foreground" id={executionHeadingId}>
            Execution and status
          </h4>
          <div
            aria-describedby={executionActionsDescribedBy}
            aria-label={`${instance.displayName} run actions`}
            className="grid min-w-0 gap-3 lg:grid-cols-2"
            data-testid={`connector-run-actions-${instance.id}`}
            role="group"
            tabIndex={executionActionsDescribedBy ? 0 : undefined}
          >
            <p className="text-xs text-muted-foreground lg:col-span-2">
              Run now advances the newest frontier, historical backfill, and pending link resolution.
            </p>
            {runBlockReason ? (
              <p className="text-xs text-warning lg:col-span-2" id={runReasonId}>
                {runBlockReason}
              </p>
            ) : null}
            <Button
              type="button"
              aria-describedby={runBlockReason ? runReasonId : undefined}
              disabled={runBlocked}
              onClick={() => onRunNow(instance)}
            >
              {runningInstanceIds.has(instance.id) ? 'Running...' : 'Run Jobright now'}
            </Button>
          </div>
          {latestRunStatus ? (
            <div className="grid min-w-0 gap-2">
              <p
                aria-atomic={!latestRun ? 'true' : undefined}
                aria-label={!latestRun ? `${instance.displayName} run progress` : undefined}
                aria-live={!latestRun ? 'polite' : undefined}
                className="min-w-0 break-words text-xs font-medium text-muted-foreground"
                role={!latestRun ? 'status' : undefined}
              >
                Latest synchronization: {latestSynchronization?.label ?? 'Starting'}
              </p>
              {latestRun ? (
                <ConnectorRunSynchronizationDetails
                  ariaLabel={`${instance.displayName} run progress`}
                  run={latestRun}
                />
              ) : null}
              {latestRun ? <ConnectorRunLifecycleDetails run={latestRun} /> : null}
              {latestRun ? (
                <Button
                  aria-label={`View ${latestRun.id} in Connector Runs`}
                  className="w-fit max-w-full min-w-0 whitespace-normal"
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => onOpenConnectorRuns?.(latestRun.id)}
                >
                  View in Connector Runs
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby={`${cardHeadingId} ${managementHeadingId}`}
        className="grid gap-3 pt-5"
      >
        <h4 className="text-sm font-semibold text-foreground" id={managementHeadingId}>
          Connector management
        </h4>
        {editing ? <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={isRemoving}
              >
                {isRemoving ? 'Removing...' : `Remove ${instance.displayName}`}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {instance.displayName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Configuration, schedules, and authentication references will be removed.
                  Historical runs and sourcing lineage are preserved. Workspace secrets remain
                  available for separate secret administration.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => onRemove(instance)}
                >
                  Remove connector
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div> : (
          <p className="text-xs text-muted-foreground">
            Enter edit mode to remove this connector.
          </p>
        )}
      </section>
          </div>
        </div>
        {editing ? (
          <div
            aria-describedby={unifiedSaveBlockReason ? saveReasonId : undefined}
            aria-label={`${instance.displayName} edit actions`}
            className="grid gap-3 border-t border-border bg-card px-6 py-4"
            data-testid={`connector-edit-actions-${instance.id}`}
            role="group"
            tabIndex={unifiedSaveBlockReason ? 0 : undefined}
          >
            {settingsSaveError ? <FormFailureAlert message={settingsSaveError} /> : null}
            {unifiedSaveBlockReason ? (
              <p className="text-xs text-warning" id={saveReasonId}>
                {unifiedSaveBlockReason}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                disabled={interactionBusy}
                onClick={cancelEditing}
                type="button"
                variant="outline"
              >
                Discard changes
              </Button>
              <Button
                aria-describedby={unifiedSaveBlockReason ? saveReasonId : undefined}
                disabled={
                  interactionBusy
                  || !hasUnsavedChanges
                  || !settingsSaveAllowed
                  || isEditingAuth
                }
                onClick={saveChanges}
                type="button"
              >
                {interactionBusy ? 'Saving changes...' : 'Save changes'}
              </Button>
            </div>
          </div>
        ) : null}

        <AlertDialog
          open={saveConfirmationOpen}
          onOpenChange={(open) => {
            if (!interactionBusy) setSaveConfirmationOpen(open)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Save changes and remove the schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                Saving these changes permanently removes the persisted automatic schedule.
                The connector will still support manual runs.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={interactionBusy}>Cancel</AlertDialogCancel>
              <Button
                disabled={interactionBusy}
                onClick={() => void persistChanges()}
                type="button"
                variant="destructive"
              >
                {interactionBusy ? 'Saving changes...' : 'Save and remove schedule'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

function authSummaryVariant(
  ready: boolean,
  configured: boolean,
): BadgeProps['variant'] {
  if (ready) return 'success'
  return configured ? 'warning' : 'secondary'
}
