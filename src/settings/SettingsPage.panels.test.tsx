import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectorsApi,
  createProfileApi,
  createSettingsApi,
  createWorkspaceApi,
  createWorkspaceSummary,
} from '../App.test-helpers'
import { defaultAppSettings } from './app-settings'
import { SettingsPage, SettingsSidebar } from './SettingsPage'
import { SETTINGS_PANELS } from '../app/types'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'

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

describe('SettingsPage developer and panel navigation', () => {
  it('exposes a labeled Developer settings Switch that persists showDebugData', async () => {
    const onSettingsPatch = vi.fn(async () => undefined)
    const settings = { ...defaultAppSettings, showDebugData: false }

    const { rerender } = render(
      <SettingsPage
        connectorsApi={createConnectorsApi()}
        connectorScheduleApi={createUnavailableScheduleApi()}
        contentColumnClass=""
        policyApi={{ get: vi.fn(), update: vi.fn(), reset: vi.fn() }}
        profileApi={createProfileApi()}
        restartRequired={false}
        selectedPanel={SETTINGS_PANELS.ADVANCED}
        settings={settings}
        settingsLoadFailure={null}
        onRetrySettingsLoad={vi.fn()}
        workspace={null}
        workspaceApi={createWorkspaceApi()}
        workspaceLoadFailure={null}
        onRetryWorkspaceLoad={vi.fn()}
        onConnectorRunSettled={vi.fn()}
        onOpenSourcingRuns={vi.fn()}
        onSettingsPatch={onSettingsPatch}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Developer settings' })).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Show debug data' })
    expect(toggle).toHaveAttribute('data-state', 'unchecked')
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(onSettingsPatch).toHaveBeenCalledWith({ showDebugData: true })
    })

    rerender(
      <SettingsPage
        connectorsApi={createConnectorsApi()}
        connectorScheduleApi={createUnavailableScheduleApi()}
        contentColumnClass=""
        policyApi={{ get: vi.fn(), update: vi.fn(), reset: vi.fn() }}
        profileApi={createProfileApi()}
        restartRequired={false}
        selectedPanel={SETTINGS_PANELS.ADVANCED}
        settings={{ ...settings, showDebugData: true }}
        settingsLoadFailure={null}
        onRetrySettingsLoad={vi.fn()}
        workspace={null}
        workspaceApi={createWorkspaceApi()}
        workspaceLoadFailure={null}
        onRetryWorkspaceLoad={vi.fn()}
        onConnectorRunSettled={vi.fn()}
        onOpenSourcingRuns={vi.fn()}
        onSettingsPatch={onSettingsPatch}
      />,
    )

    expect(screen.getByRole('switch', { name: 'Show debug data' })).toHaveAttribute(
      'data-state',
      'checked',
    )
  })

  it('renders functional settings panels and coming-later sidebar items', async () => {
    const settingsApi = createSettingsApi()
    const workspace = createWorkspaceSummary()
    const workspaceApi = createWorkspaceApi(workspace)
    const onSettingsPatch = vi.fn(async (patch) => {
      await settingsApi.update(patch)
    })

    const baseProps = {
      connectorsApi: createConnectorsApi(),
      connectorScheduleApi: createUnavailableScheduleApi(),
      contentColumnClass: '',
      policyApi: { get: vi.fn(), update: vi.fn(), reset: vi.fn() },
      profileApi: createProfileApi(),
      restartRequired: false,
      settings: defaultAppSettings,
      settingsLoadFailure: null,
      onRetrySettingsLoad: vi.fn(),
      workspace,
      workspaceApi,
      workspaceLoadFailure: null,
      onRetryWorkspaceLoad: vi.fn(),
      onConnectorRunSettled: vi.fn(),
      onOpenSourcingRuns: vi.fn(),
      onSettingsPatch,
    } as const

    function PanelHarness() {
      const [selectedPanel, setSelectedPanel] = useState(SETTINGS_PANELS.GENERAL)
      return (
        <>
          <SettingsSidebar
            selectedPanel={selectedPanel}
            temporary={false}
            onBack={vi.fn()}
            onMouseLeave={vi.fn()}
            onPanelChange={setSelectedPanel}
          />
          <SettingsPage {...baseProps} selectedPanel={selectedPanel} />
        </>
      )
    }

    render(<PanelHarness />)

    const settingsSidebar = screen.getByRole('complementary', {
      name: 'Settings navigation',
    })
    const settingsNavigation = within(settingsSidebar).getByRole('navigation', {
      name: 'Settings sections',
    })
    expect(
      within(settingsNavigation)
        .getAllByRole('button')
        .slice(0, 3)
        .map((button) => button.textContent),
    ).toEqual(['Profile', 'General', 'Appearance'])

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Local desktop' })).toBeInTheDocument()
    expect(screen.getByText('PGlite through Electron IPC, no local HTTP server.')).toBeInTheDocument()
    expect(screen.getByLabelText('Show advanced filters')).toBeInTheDocument()

    fireEvent.click(within(settingsNavigation).getByRole('button', { name: 'Configuration' }))
    expect(screen.getByLabelText('Remote API URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Local API host')).toBeInTheDocument()
    expect(screen.getByLabelText('Local API port')).toBeInTheDocument()
    expect(screen.getByLabelText('API token')).toBeInTheDocument()

    fireEvent.click(within(settingsNavigation).getByRole('button', { name: 'Data' }))
    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Workspace path')).toHaveValue('/Users/keni/Job Search')
    })
    expect(screen.getByRole('button', { name: 'Choose workspace' })).toBeInTheDocument()

    fireEvent.click(within(settingsNavigation).getByRole('button', { name: 'Agent access' }))
    expect(screen.getByText('Local API is available in local-shared mode.')).toBeInTheDocument()

    fireEvent.click(within(settingsNavigation).getByRole('button', { name: 'Appearance' }))
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()

    fireEvent.click(within(settingsNavigation).getByRole('button', { name: 'Profile' }))
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument()
  })

  it('emits full-page backend settings patches', async () => {
    const onSettingsPatch = vi.fn(async () => undefined)

    render(
      <SettingsPage
        connectorsApi={createConnectorsApi()}
        connectorScheduleApi={createUnavailableScheduleApi()}
        contentColumnClass=""
        policyApi={{ get: vi.fn(), update: vi.fn(), reset: vi.fn() }}
        profileApi={createProfileApi()}
        restartRequired={false}
        selectedPanel={SETTINGS_PANELS.GENERAL}
        settings={defaultAppSettings}
        settingsLoadFailure={null}
        onRetrySettingsLoad={vi.fn()}
        workspace={null}
        workspaceApi={createWorkspaceApi()}
        workspaceLoadFailure={null}
        onRetryWorkspaceLoad={vi.fn()}
        onConnectorRunSettled={vi.fn()}
        onOpenSourcingRuns={vi.fn()}
        onSettingsPatch={onSettingsPatch}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Remote' }))

    await waitFor(() => {
      expect(onSettingsPatch).toHaveBeenCalledWith({ runtimeMode: 'remote' })
    })
  })
})
