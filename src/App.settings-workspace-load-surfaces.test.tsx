import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ValedictorianHttpError,
  ValedictorianTransportError,
  valedictorianFailureKindMessages,
} from 'sparxie'
import App from './App'
import {
  createApplication,
  createListResult,
  createSettingsApi,
  createWorkspaceApi,
  createWorkspaceSummary,
  openSettingsPage,
} from './App.test-helpers'
import { defaultAppSettings } from './settings/app-settings'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { settings?: unknown }).settings
})

describe('App settings and workspace bootstrap load surfaces', () => {
  it('renders AuthenticationFailure with Retry for typed settings get auth failures', async () => {
    const settingsApi = createSettingsApi()
    vi.mocked(settingsApi.get)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'settings auth dump /secret',
        status: 401,
      }))
      .mockResolvedValueOnce({
        ...defaultAppSettings,
        remoteApiUrl: 'https://recovered.example',
      })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'authentication-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.authentication)
    expect(alert).not.toHaveTextContent('/secret')

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(settingsApi.get).toHaveBeenCalledTimes(2))
    expect(await screen.findByDisplayValue('https://recovered.example')).toBeInTheDocument()
  })

  it('renders GlobalFailureAlert for typed workspace transport failures without treating null as success', async () => {
    const workspaceApi = createWorkspaceApi()
    vi.mocked(workspaceApi.getCurrent)
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/workspace/secret'),
      }))
      .mockResolvedValueOnce(createWorkspaceSummary({
        id: 'workspace-recovered',
        rootPath: '/tmp/recovered-workspace',
        dataPath: '/tmp/recovered-workspace/data',
        pgliteDataPath: '/tmp/recovered-workspace/data/pglite',
      }))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        workspaceApi={workspaceApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Data' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'global-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
    expect(alert).not.toHaveTextContent('ECONNREFUSED')
    expect(screen.getAllByDisplayValue('No workspace selected').length).toBeGreaterThan(0)

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(workspaceApi.getCurrent).toHaveBeenCalledTimes(2))
    expect(await screen.findByDisplayValue('/tmp/recovered-workspace')).toBeInTheDocument()
  })

  it('renders scoped LoadFailureView for generic settings get failures', async () => {
    const settingsApi = createSettingsApi()
    vi.mocked(settingsApi.get).mockRejectedValueOnce(new Error('settings dump /secret'))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).toHaveTextContent('Settings could not be loaded.')
    expect(alert).not.toHaveTextContent('/secret')
  })
})
