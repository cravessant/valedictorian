import { useEffect, useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type {
  ConnectorScheduleSummary,
  ConnectorSchedulingCapability,
} from 'sparxie'
import {
  CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION,
  formatConnectorScheduleCadence,
  listIanaTimeZones,
  supportedSchedulePresets,
} from './connector-schedule.helpers'
import type { ConnectorScheduleDraft } from './connector-schedule.types'
import { MAX_CONNECTOR_SCHEDULE_INTERVAL_MINUTES } from 'sparxie'

const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
]

export function ConnectorScheduleControls({
  capability,
  capabilityLoadError,
  canonical,
  connectorDisplayName,
  connectorEnabled,
  draft,
  isDirty,
  isLoading,
  isSaving,
  statusMessage,
  statusTone,
  onDiscard,
  onDraftChange,
  onPause,
  onResume,
  onSave,
}: {
  capability: ConnectorSchedulingCapability | null
  capabilityLoadError: string | null
  canonical: ConnectorScheduleSummary | null
  connectorDisplayName: string
  connectorEnabled: boolean
  draft: ConnectorScheduleDraft
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  statusMessage: string | null
  statusTone: 'idle' | 'success' | 'error'
  onDiscard: () => void
  onDraftChange: (patch: Partial<ConnectorScheduleDraft>) => void
  onPause: () => void
  onResume: () => void
  onSave: () => void
}) {
  const modeId = useId()
  const timezoneId = useId()
  const presetId = useId()
  const intervalId = useId()
  const dailyTimeId = useId()
  const weeklyDayId = useId()
  const weeklyTimeId = useId()
  const [manualRemoveOpen, setManualRemoveOpen] = useState(false)
  const [manualRemoveError, setManualRemoveError] = useState<string | null>(null)
  const wouldRemovePersistedSchedule = draft.mode === 'manual' && canonical !== null

  useEffect(() => {
    if (!manualRemoveOpen || isSaving) {
      return
    }

    if (statusTone === 'success' && !canonical) {
      setManualRemoveOpen(false)
      setManualRemoveError(null)
      return
    }

    if (statusTone === 'error' && statusMessage) {
      setManualRemoveError(statusMessage)
    }
  }, [manualRemoveOpen, isSaving, statusTone, statusMessage, canonical])

  if (capabilityLoadError) {
    return (
      <section
        aria-label={`${connectorDisplayName} schedule`}
        className="grid gap-2 rounded-md border border-border bg-background/40 p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">Automatic schedule</h4>
          <p className="text-xs font-medium text-muted-foreground">Unavailable to load</p>
        </div>
        <div
          aria-atomic="true"
          aria-label={`${connectorDisplayName} schedule status`}
          aria-live="polite"
          className="text-xs font-medium text-destructive"
          role="status"
        >
          {capabilityLoadError}
        </div>
      </section>
    )
  }

  if (capability === null) {
    return (
      <section
        aria-label={`${connectorDisplayName} schedule`}
        className="grid gap-2 rounded-md border border-border bg-background/40 p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">Automatic schedule</h4>
        </div>
        <p className="text-xs text-muted-foreground">Loading scheduler capability...</p>
      </section>
    )
  }

  if (!capability.available) {
    return (
      <section
        aria-label={`${connectorDisplayName} schedule`}
        className="grid gap-2 rounded-md border border-border bg-background/40 p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">Automatic schedule</h4>
          <p className="text-xs font-medium text-muted-foreground">Persisted: Not loaded</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION}
        </p>
        {!connectorEnabled ? (
          <p className="text-xs text-muted-foreground">
            This connector is disabled. Enable it before scheduling automatic runs.
          </p>
        ) : null}
      </section>
    )
  }

  if (isLoading) {
    return (
      <section
        aria-label={`${connectorDisplayName} schedule`}
        className="grid gap-2 rounded-md border border-border bg-background/40 p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">Automatic schedule</h4>
        </div>
        <div
          aria-atomic="true"
          aria-label={`${connectorDisplayName} schedule status`}
          aria-live="polite"
          className="text-xs text-muted-foreground"
          role="status"
        >
          Loading schedule...
        </div>
      </section>
    )
  }

  const presets = supportedSchedulePresets(capability)
  const timezones = listIanaTimeZones(draft.timezone)
  const timezoneOptions = timezones.map((timezone) => ({ label: timezone, value: timezone }))
  const scheduleStateLabel = canonical?.state === 'paused'
    ? 'Paused'
    : canonical
      ? 'Enabled'
      : 'Manual only'
  const draftModeLabel = draft.mode === 'manual'
    ? 'Manual only'
    : draft.mode === 'preset'
      ? 'Common preset'
      : draft.mode === 'custom-interval'
        ? 'Custom interval'
        : draft.mode === 'custom-daily'
          ? 'Custom daily'
          : 'Custom weekly'

  return (
    <section
      aria-label={`${connectorDisplayName} schedule`}
      className="grid gap-3 rounded-md border border-border bg-background/40 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Automatic schedule</h4>
        <div className="grid gap-0.5 text-right text-xs font-medium text-muted-foreground">
          <p>Persisted: {scheduleStateLabel}</p>
          {isDirty ? <p>Draft: {draftModeLabel}</p> : null}
        </div>
      </div>

      <Field
        className="grid gap-1 text-xs font-medium text-muted-foreground"
        data-disabled={isSaving ? true : undefined}
      >
        <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={modeId}>
          Schedule mode
        </FieldLabel>
        <NativeSelect
          disabled={isSaving}
          id={modeId}
          value={draft.mode}
          onChange={(event) => {
            const mode = event.target.value as ConnectorScheduleDraft['mode']
            onDraftChange({
              mode,
              presetId: mode === 'preset' ? (draft.presetId ?? presets[0]?.id ?? null) : null,
            })
          }}
        >
          <NativeSelectOption value="manual">Manual only</NativeSelectOption>
          {presets.length > 0 ? <NativeSelectOption value="preset">Common preset</NativeSelectOption> : null}
          {capability.supportedCadences.includes('interval') ? (
            <NativeSelectOption value="custom-interval">Custom interval</NativeSelectOption>
          ) : null}
          {capability.supportedCadences.includes('daily') ? (
            <NativeSelectOption value="custom-daily">Custom daily</NativeSelectOption>
          ) : null}
          {capability.supportedCadences.includes('weekly') ? (
            <NativeSelectOption value="custom-weekly">Custom weekly</NativeSelectOption>
          ) : null}
        </NativeSelect>
      </Field>

      {draft.mode === 'preset' ? (
        <Field
          className="grid gap-1 text-xs font-medium text-muted-foreground"
          data-disabled={isSaving ? true : undefined}
        >
          <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={presetId}>
            Preset
          </FieldLabel>
          <NativeSelect
            disabled={isSaving}
            id={presetId}
            value={draft.presetId ?? ''}
            onChange={(event) => onDraftChange({ presetId: event.target.value || null })}
          >
            {presets.map((preset) => (
              <NativeSelectOption key={preset.id} value={preset.id}>{preset.label}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      {draft.mode === 'custom-interval' ? (
        <Field
          className="grid gap-1 text-xs font-medium text-muted-foreground"
          data-disabled={isSaving ? true : undefined}
        >
          <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={intervalId}>
            Every minutes
          </FieldLabel>
          <Input
            disabled={isSaving}
            id={intervalId}
            inputMode="numeric"
            max={MAX_CONNECTOR_SCHEDULE_INTERVAL_MINUTES}
            min={capability.minimumIntervalMinutes}
            type="number"
            value={draft.everyMinutes}
            onChange={(event) => onDraftChange({ everyMinutes: event.target.value })}
          />
        </Field>
      ) : null}

      {draft.mode === 'custom-daily' ? (
        <Field
          className="grid gap-1 text-xs font-medium text-muted-foreground"
          data-disabled={isSaving ? true : undefined}
        >
          <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={dailyTimeId}>
            Daily local time
          </FieldLabel>
          <Input
            disabled={isSaving}
            id={dailyTimeId}
            pattern="[0-2][0-9]:[0-5][0-9]"
            placeholder="HH:mm"
            value={draft.localTime}
            onChange={(event) => onDraftChange({ localTime: event.target.value })}
          />
        </Field>
      ) : null}

      {draft.mode === 'custom-weekly' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            className="grid gap-1 text-xs font-medium text-muted-foreground"
            data-disabled={isSaving ? true : undefined}
          >
            <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={weeklyDayId}>
              Weekday
            </FieldLabel>
            <NativeSelect
              disabled={isSaving}
              id={weeklyDayId}
              value={draft.dayOfWeek}
              onChange={(event) => onDraftChange({ dayOfWeek: event.target.value })}
            >
              {WEEKDAY_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field
            className="grid gap-1 text-xs font-medium text-muted-foreground"
            data-disabled={isSaving ? true : undefined}
          >
            <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={weeklyTimeId}>
              Weekly local time
            </FieldLabel>
            <Input
              disabled={isSaving}
              id={weeklyTimeId}
              pattern="[0-2][0-9]:[0-5][0-9]"
              placeholder="HH:mm"
              value={draft.localTime}
              onChange={(event) => onDraftChange({ localTime: event.target.value })}
            />
          </Field>
        </div>
      ) : null}

      {draft.mode !== 'manual' ? (
        <Field
          className="grid gap-1 text-xs font-medium text-muted-foreground"
          data-disabled={isSaving ? true : undefined}
        >
          <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={timezoneId}>
            Timezone
          </FieldLabel>
          <Combobox
            disabled={isSaving}
            emptyText="No timezone found."
            id={timezoneId}
            options={timezoneOptions}
            placeholder="Select timezone"
            searchPlaceholder="Search timezone..."
            value={draft.timezone}
            onValueChange={(timezone) => onDraftChange({ timezone })}
          />
        </Field>
      ) : null}

      {canonical ? (
        <div className="grid gap-1 text-xs text-muted-foreground">
          <p>Cadence: {formatConnectorScheduleCadence(canonical.cadence)}</p>
          <p>Timezone: {canonical.timezone}</p>
          <p>Next eligible: {formatInstant(canonical.nextEligibleAt)}</p>
          <p>
            Last occurrence:{' '}
            {canonical.lastOccurrence
              ? `${canonical.lastOccurrence.outcome} at ${formatInstant(canonical.lastOccurrence.nominalAt)}`
              : 'None yet'}
          </p>
          <p>
            Last scheduled run:{' '}
            {canonical.lastRun
              ? `${canonical.lastRun.status} (${canonical.lastRun.mode})`
              : 'None yet'}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No automatic schedule is persisted. Manual runs remain available.
        </p>
      )}

      {!connectorEnabled ? (
        <p className="text-xs text-muted-foreground">
          This connector is disabled. Saved schedules stay paused from dispatch until the connector is enabled.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isSaving || !isDirty}
          type="button"
          onClick={() => {
            if (wouldRemovePersistedSchedule) {
              setManualRemoveError(null)
              setManualRemoveOpen(true)
              return
            }
            onSave()
          }}
        >
          {isSaving ? 'Saving...' : 'Save schedule'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isSaving || !isDirty}
          type="button"
          onClick={onDiscard}
        >
          Discard unsaved schedule
        </Button>
        {canonical?.state === 'enabled' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving || isDirty}
            type="button"
            onClick={onPause}
          >
            Pause schedule
          </Button>
        ) : null}
        {canonical?.state === 'paused' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isSaving || isDirty}
            type="button"
            onClick={onResume}
          >
            Resume schedule
          </Button>
        ) : null}
      </div>

      <AlertDialog
        open={manualRemoveOpen}
        onOpenChange={(open) => {
          if (isSaving) {
            return
          }
          setManualRemoveOpen(open)
          if (!open) {
            setManualRemoveError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove automatic schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Saving Manual only permanently removes the persisted ${connectorDisplayName} schedule.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {manualRemoveError ? (
            <p className="text-sm text-destructive" role="alert">
              {manualRemoveError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={isSaving}
              onClick={() => {
                setManualRemoveError(null)
                onSave()
              }}
            >
              {isSaving ? 'Removing...' : 'Remove schedule'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        aria-atomic="true"
        aria-label={`${connectorDisplayName} schedule status`}
        aria-live="polite"
        className={
          statusTone === 'error'
            ? 'text-xs font-medium text-destructive'
            : statusTone === 'success'
              ? 'text-xs font-medium text-success'
              : 'text-xs text-muted-foreground'
        }
        role="status"
      >
        {statusMessage ?? ''}
      </div>
    </section>
  )
}

function formatInstant(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}
