import { useId } from 'react'
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
          <p className="text-xs font-medium text-muted-foreground">Manual only</p>
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
  const scheduleStateLabel = !connectorEnabled
    ? 'Connector disabled'
    : canonical?.state === 'paused'
      ? 'Paused'
      : canonical
        ? 'Enabled'
        : 'Manual only'

  return (
    <section
      aria-label={`${connectorDisplayName} schedule`}
      className="grid gap-3 rounded-md border border-border bg-background/40 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Automatic schedule</h4>
        <p className="text-xs font-medium text-muted-foreground">{scheduleStateLabel}</p>
      </div>

      <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={modeId}>
        Schedule mode
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
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
          <option value="manual">Manual only</option>
          {presets.length > 0 ? <option value="preset">Common preset</option> : null}
          {capability.supportedCadences.includes('interval') ? (
            <option value="custom-interval">Custom interval</option>
          ) : null}
          {capability.supportedCadences.includes('daily') ? (
            <option value="custom-daily">Custom daily</option>
          ) : null}
          {capability.supportedCadences.includes('weekly') ? (
            <option value="custom-weekly">Custom weekly</option>
          ) : null}
        </select>
      </label>

      {draft.mode === 'preset' ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={presetId}>
          Preset
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            disabled={isSaving}
            id={presetId}
            value={draft.presetId ?? ''}
            onChange={(event) => onDraftChange({ presetId: event.target.value || null })}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
      ) : null}

      {draft.mode === 'custom-interval' ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={intervalId}>
          Every minutes
          <input
            aria-label="Every minutes"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            disabled={isSaving}
            id={intervalId}
            inputMode="numeric"
            max={MAX_CONNECTOR_SCHEDULE_INTERVAL_MINUTES}
            min={capability.minimumIntervalMinutes}
            type="number"
            value={draft.everyMinutes}
            onChange={(event) => onDraftChange({ everyMinutes: event.target.value })}
          />
        </label>
      ) : null}

      {draft.mode === 'custom-daily' ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={dailyTimeId}>
          Daily local time
          <input
            aria-label="Daily local time"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            disabled={isSaving}
            id={dailyTimeId}
            pattern="[0-2][0-9]:[0-5][0-9]"
            placeholder="HH:mm"
            value={draft.localTime}
            onChange={(event) => onDraftChange({ localTime: event.target.value })}
          />
        </label>
      ) : null}

      {draft.mode === 'custom-weekly' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={weeklyDayId}>
            Weekday
            <select
              aria-label="Weekday"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              disabled={isSaving}
              id={weeklyDayId}
              value={draft.dayOfWeek}
              onChange={(event) => onDraftChange({ dayOfWeek: event.target.value })}
            >
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={weeklyTimeId}>
            Weekly local time
            <input
              aria-label="Weekly local time"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              disabled={isSaving}
              id={weeklyTimeId}
              pattern="[0-2][0-9]:[0-5][0-9]"
              placeholder="HH:mm"
              value={draft.localTime}
              onChange={(event) => onDraftChange({ localTime: event.target.value })}
            />
          </label>
        </div>
      ) : null}

      {draft.mode !== 'manual' ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor={timezoneId}>
          Timezone
          <select
            aria-label="Timezone"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            disabled={isSaving}
            id={timezoneId}
            value={draft.timezone}
            onChange={(event) => onDraftChange({ timezone: event.target.value })}
          >
            {timezones.map((timezone) => (
              <option key={timezone} value={timezone}>{timezone}</option>
            ))}
          </select>
        </label>
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
        <button
          className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground disabled:opacity-50"
          disabled={isSaving || !isDirty}
          type="button"
          onClick={onSave}
        >
          {isSaving ? 'Saving...' : 'Save schedule'}
        </button>
        <button
          className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground disabled:opacity-50"
          disabled={isSaving || !isDirty}
          type="button"
          onClick={onDiscard}
        >
          Discard
        </button>
        {canonical?.state === 'enabled' ? (
          <button
            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground disabled:opacity-50"
            disabled={isSaving || isDirty}
            type="button"
            onClick={onPause}
          >
            Pause schedule
          </button>
        ) : null}
        {canonical?.state === 'paused' ? (
          <button
            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground disabled:opacity-50"
            disabled={isSaving || isDirty}
            type="button"
            onClick={onResume}
          >
            Resume schedule
          </button>
        ) : null}
      </div>

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
