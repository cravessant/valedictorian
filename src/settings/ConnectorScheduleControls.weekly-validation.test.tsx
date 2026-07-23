import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorSchedulingCapability } from '@sparxie/sdk'
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

function renderWeeklyValidation(draft: ConnectorScheduleDraft, field: 'dayOfWeek' | 'localTime') {
  return render(
    <ConnectorScheduleControls
      capability={availableCapability}
      capabilityLoadError={null}
      loadFailure={null}
      validationField={field}
      canonical={null}
      connectorDisplayName="Jobright"
      connectorEnabled
      draft={draft}
      isDirty
      isLoading={false}
      isSaving={false}
      statusMessage={
        field === 'dayOfWeek'
          ? 'Weekly day must be an ISO weekday from 1 (Monday) through 7 (Sunday).'
          : 'Weekly time must use HH:mm.'
      }
      statusTone="error"
      onDiscard={vi.fn()}
      onDraftChange={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onSave={vi.fn()}
    />,
  )
}

describe('ConnectorScheduleControls weekly field validation ARIA', () => {
  it('marks weekly dayOfWeek invalid and links aria-describedby to FieldError', () => {
    const draft: ConnectorScheduleDraft = {
      ...createEmptyConnectorScheduleDraft('UTC'),
      mode: 'custom-weekly',
      dayOfWeek: '99',
      localTime: '09:00',
    }
    renderWeeklyValidation(draft, 'dayOfWeek')

    const control = screen.getByLabelText('Weekday')
    const error = screen.getByText(
      'Weekly day must be an ISO weekday from 1 (Monday) through 7 (Sunday).',
    )
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAttribute('aria-describedby', error.id)
    expect(error).toHaveAttribute('data-slot', 'field-error')
  })

  it('marks weekly localTime invalid and links aria-describedby to FieldError', () => {
    const draft: ConnectorScheduleDraft = {
      ...createEmptyConnectorScheduleDraft('UTC'),
      mode: 'custom-weekly',
      dayOfWeek: '1',
      localTime: 'bad',
    }
    renderWeeklyValidation(draft, 'localTime')

    const control = screen.getByLabelText('Weekly local time')
    const error = screen.getByText('Weekly time must use HH:mm.')
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAttribute('aria-describedby', error.id)
    expect(error).toHaveAttribute('data-slot', 'field-error')
  })
})
