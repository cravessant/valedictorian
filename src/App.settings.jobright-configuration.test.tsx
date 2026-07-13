import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  openSettingsPage
} from './App.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

describe('Jobright configuration', () => {
  it('saves released Jobright config without connector filters', async () => {
    const connectorsApi = createConnectorsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()

    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    fireEvent.change(await screen.findByLabelText('Discovery page size'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          discoveryCount: 3,
        },
        connectorInstanceId: 'jobright-default',
        filters: {},
      })
    })
  })

  it('blocks Run while connector settings draft is dirty without auto-saving', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {
          discoveryCount: 100,
        },
        filters: {},
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Discovery page size'), {
      target: { value: '25' },
    })
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('blocks Run and freezes connector settings while a save is still pending', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    let resolveUpdate: ((value: Awaited<ReturnType<typeof connectorsApi.update>>) => void) | undefined
    const pendingUpdate = new Promise<Awaited<ReturnType<typeof connectorsApi.update>>>((resolve) => {
      resolveUpdate = resolve
    })
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {
          discoveryCount: 100,
        },
        filters: {},
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.update).mockReturnValueOnce(pendingUpdate)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()

    const discoveryCount = screen.getByLabelText('Discovery page size')
    fireEvent.change(discoveryCount, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByLabelText('Discovery page size')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Discard unsaved settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdate?.({
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {
          discoveryCount: 25,
        },
        filters: {},
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:01:00.000Z',
      })
    })

    expect(await screen.findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(screen.getByLabelText('Discovery page size')).toBeEnabled()
    expect(screen.getByLabelText('Discovery page size')).toHaveValue(25)
    expect(screen.getByText(/Discovery page size/i)).toBeInTheDocument()
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
  })

  it('keeps concurrent Jobright saves frozen independently per instance card', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    type UpdatedInstance = Awaited<ReturnType<typeof connectorsApi.update>>
    let resolveUpdateA: ((value: UpdatedInstance) => void) | undefined
    let resolveUpdateB: ((value: UpdatedInstance) => void) | undefined
    const pendingUpdateA = new Promise<UpdatedInstance>((resolve) => {
      resolveUpdateA = resolve
    })
    const pendingUpdateB = new Promise<UpdatedInstance>((resolve) => {
      resolveUpdateB = resolve
    })
    const instanceA = {
      id: 'jobright-a',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright Alpha',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password' as const,
        label: 'Jobright username and password',
        configured: true,
      }],
      config: {
        discoveryCount: 100,
      },
      filters: {},
      earliestBackfillDate: '2026-07-02',
      createdAt: '2026-07-09T15:00:00.000Z',
      updatedAt: '2026-07-09T15:00:00.000Z',
    }
    const instanceB = {
      ...instanceA,
      id: 'jobright-b',
      displayName: 'Jobright Beta',
    }
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [instanceA, instanceB],
    })
    vi.mocked(connectorsApi.update).mockImplementation(async (input) => {
      if (input.connectorInstanceId === 'jobright-a') {
        return pendingUpdateA
      }
      if (input.connectorInstanceId === 'jobright-b') {
        return pendingUpdateB
      }
      throw new Error(`Unexpected connector instance: ${input.connectorInstanceId}`)
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    const cardA = await screen.findByTestId('connector-instance-card-jobright-a')
    const cardB = screen.getByTestId('connector-instance-card-jobright-b')
    expect(await within(cardA).findByText('Auth verified')).toBeInTheDocument()
    expect(await within(cardB).findByText('Auth verified')).toBeInTheDocument()

    fireEvent.change(within(cardA).getByLabelText('Discovery page size'), {
      target: { value: '21' },
    })
    fireEvent.click(within(cardA).getByRole('button', { name: 'Save Jobright settings' }))
    fireEvent.change(within(cardB).getByLabelText('Discovery page size'), {
      target: { value: '22' },
    })
    fireEvent.click(within(cardB).getByRole('button', { name: 'Save Jobright settings' }))

    expect(await within(cardA).findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(await within(cardB).findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(cardA).getByLabelText('Discovery page size')).toBeDisabled()
    expect(within(cardB).getByLabelText('Discovery page size')).toBeDisabled()
    expect(within(cardA).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(within(cardB).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(within(cardA).getByRole('button', { name: 'Run Jobright now' }))
    fireEvent.click(within(cardB).getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdateA?.({
        ...instanceA,
        config: { discoveryCount: 21 },
        updatedAt: '2026-07-09T15:01:00.000Z',
      })
    })

    expect(await within(cardA).findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(within(cardA).getByLabelText('Discovery page size')).toBeEnabled()
    expect(within(cardA).getByLabelText('Discovery page size')).toHaveValue(21)
    expect(within(cardB).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(cardB).getByLabelText('Discovery page size')).toBeDisabled()
    expect(within(cardB).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    fireEvent.click(within(cardB).getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdateB?.({
        ...instanceB,
        config: { discoveryCount: 22 },
        updatedAt: '2026-07-09T15:02:00.000Z',
      })
    })

    expect(await within(cardB).findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(within(cardB).getByLabelText('Discovery page size')).toBeEnabled()
    expect(within(cardB).getByLabelText('Discovery page size')).toHaveValue(22)
    expect(within(cardA).getByLabelText('Discovery page size')).toHaveValue(21)
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
  })

  it('exposes only released Jobright connector settings', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {},
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.update).mockImplementation(async (input) => ({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: input.config ?? {},
      filters: input.filters ?? {},
      createdAt: '2026-07-09T15:00:00.000Z',
      updatedAt: '2026-07-09T15:01:00.000Z',
    }))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    fireEvent.click(await screen.findByText('Connector settings'))
    expect(screen.getByLabelText('Discovery page size')).toHaveValue(20)
    expect(screen.queryByLabelText('Role terms')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Useful results target')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Discovery page limit')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Discovery record limit')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Requested detail-resolution attempts')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Discovery page size'), {
      target: { value: '30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          discoveryCount: 30,
        },
        connectorInstanceId: 'jobright-default',
        filters: {},
      })
    })
  })

})
