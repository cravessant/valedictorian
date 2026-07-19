import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorSchedulingCapability } from 'sparxie'
import { ConnectorScheduleControls } from './ConnectorScheduleControls'
import { createEmptyConnectorScheduleDraft } from './connector-schedule.helpers'
import type { ConnectorScheduleDraft } from './connector-schedule.types'

afterEach(cleanup)

const availableCapability: Extract<ConnectorSchedulingCapability, { available: true }> = {
  available: true,
  supportedCadences: ['interval', 'daily', 'weekly'],
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana',
  missedOccurrencePolicy: 'coalesce_one',
}

function renderControls({
  canonical = null,
  draft = createEmptyConnectorScheduleDraft('UTC'),
  isDirty = true,
  onSave = vi.fn(),
}: {
  canonical?: Parameters<typeof ConnectorScheduleControls>[0]['canonical']
  draft?: ConnectorScheduleDraft
  isDirty?: boolean
  onSave?: () => void
} = {}) {
  return render(
    <ConnectorScheduleControls
      capability={availableCapability}
      capabilityLoadError={null}
      loadFailure={null}
      validationField={null}
      canonical={canonical}
      connectorDisplayName="Jobright"
      connectorEnabled
      draft={draft}
      isDirty={isDirty}
      isLoading={false}
      isSaving={false}
      statusMessage={null}
      statusTone="idle"
      onDiscard={vi.fn()}
      onDraftChange={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onSave={onSave}
    />,
  )
}

describe('ConnectorScheduleControls manual-only confirmation', () => {
  it('labels persisted schedule state separately from an unsaved draft and scopes discard', () => {
    renderControls({
      canonical: {
        id: 'schedule-1',
        connectorInstanceId: 'jobright-default',
        revision: 'rev-1',
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 60 },
        timezone: 'UTC',
        nextEligibleAt: '2026-07-12T13:00:00.000Z',
        createdAt: '2026-07-12T12:00:00.000Z',
        updatedAt: '2026-07-12T12:00:00.000Z',
        lastOccurrence: null,
        lastRun: null,
      },
      draft: {
        ...createEmptyConnectorScheduleDraft('UTC'),
        mode: 'preset',
        presetId: 'interval-30',
      },
      isDirty: true,
    })

    expect(screen.getByText(/Persisted:\s*Enabled/i)).toBeInTheDocument()
    expect(screen.getByText(/Draft:\s*Common preset/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard unsaved schedule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  })

  it('saves Manual only without confirmation when no automatic schedule is persisted', () => {
    const onSave = vi.fn()
    renderControls({
      canonical: null,
      draft: { ...createEmptyConnectorScheduleDraft('UTC'), mode: 'manual' },
      isDirty: true,
      onSave,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('asks for confirmation before saving Manual only when a schedule is persisted', () => {
    const onSave = vi.fn()
    renderControls({
      canonical: {
        id: 'schedule-1',
        connectorInstanceId: 'jobright-default',
        revision: 'rev-1',
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 60 },
        timezone: 'UTC',
        nextEligibleAt: '2026-07-12T13:00:00.000Z',
        createdAt: '2026-07-12T12:00:00.000Z',
        updatedAt: '2026-07-12T12:00:00.000Z',
        lastOccurrence: null,
        lastRun: null,
      },
      draft: { ...createEmptyConnectorScheduleDraft('UTC'), mode: 'manual' },
      isDirty: true,
      onSave,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(screen.getByRole('alertdialog', { name: 'Remove automatic schedule?' })).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })
})
