import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConnectorsApi, createProfileApi } from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

afterEach(cleanup)

function createUnavailableScheduleApi(): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: { available: false as const },
    })),
    getSchedule: vi.fn(async () => null),
    upsertSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    pauseSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    resumeSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    deleteSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
  }
}

describe('ConnectorSettingsPanel', () => {
  it('renders Empty for zero connector instances while preserving the Add Jobright card', async () => {
    render(
      <ConnectorSettingsPanel
        connectorsApi={createConnectorsApi()}
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const addButton = await screen.findByRole('button', { name: 'Add Jobright connector' })
    expect(addButton).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Jobright internslist' })).toBeInTheDocument()

    const empty = screen.getByLabelText('Empty connector instances')
    expect(empty).toHaveAttribute('data-slot', 'empty')
    expect(within(empty).getByRole('heading', { name: 'No connector instances' })).toBeInTheDocument()
    expect(
      within(empty).getByText(
        'Add the Jobright connector above to configure authentication and schedules.',
      ),
    ).toBeInTheDocument()
    expect(within(empty).queryByRole('button', { name: 'Add Jobright connector' })).not.toBeInTheDocument()
    expect(screen.queryByText('No connector instances configured.')).not.toBeInTheDocument()
  })
})
