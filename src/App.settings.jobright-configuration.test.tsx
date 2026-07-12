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
  it('saves Jobright filters from connector settings before refresh', async () => {
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

    fireEvent.change(await screen.findByLabelText('Role terms'), {
      target: { value: 'intern, backend' },
    })
    fireEvent.change(screen.getByLabelText('Useful results target'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          usefulTarget: 3,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern', 'backend'],
        },
      })
    })
  })

  it('saves exact useful results target 500 as bounded backfill intent without migrating legacy resolution caps', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.6.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        secretKey: 'connector_jobright_credentials_jobright_default',
      }],
      config: {
        customKeep: 'preserve-me',
        discoveryCount: 25,
      },
      filters: {
        maxResolutionCount: 50,
        roleTerms: ['intern'],
      },
    })
    vi.mocked(connectorsApi.create).mockClear()
    vi.mocked(connectorsApi.update).mockClear()

    const firstRender = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    const usefulTarget = await screen.findByLabelText('Useful results target')
    expect(usefulTarget).toHaveValue(100)
    expect(screen.getByText(/bounded backfill intent across runs/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Max links per refresh')).not.toBeInTheDocument()

    fireEvent.change(usefulTarget, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          customKeep: 'preserve-me',
          discoveryCount: 25,
          usefulTarget: 500,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern'],
        },
      })
    })
    expect(connectorsApi.update).not.toHaveBeenCalledWith(expect.objectContaining({
      config: {},
    }))

    firstRender.unmount()
    vi.mocked(connectorsApi.update).mockClear()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const reloadedNavigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(reloadedNavigation).getByRole('button', { name: 'Connectors' }))

    expect(await screen.findByLabelText('Useful results target')).toHaveValue(500)
    expect(screen.getByText(/Saved useful results target: 500/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Advanced connector limits'))
    expect(screen.getByLabelText('Discovery page size')).toHaveValue(25)
    expect(screen.getByLabelText('Requested detail-resolution attempts')).toHaveValue(50)
    expect(screen.getByText(/Requested detail-resolution attempts \(saved\): 50 \(legacy\)/i))
      .toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Role terms'), {
      target: { value: 'intern, backend' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          customKeep: 'preserve-me',
          discoveryCount: 25,
          usefulTarget: 500,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern', 'backend'],
        },
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
          usefulTarget: 100,
        },
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
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

    fireEvent.change(screen.getByLabelText('Useful results target'), {
      target: { value: '250' },
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
          usefulTarget: 100,
        },
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
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

    const usefulTarget = screen.getByLabelText('Useful results target')
    fireEvent.change(usefulTarget, { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByLabelText('Useful results target')).toBeDisabled()
    expect(screen.getByLabelText('Role terms')).toBeDisabled()
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
          usefulTarget: 250,
        },
        filters: {
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:01:00.000Z',
      })
    })

    expect(await screen.findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(screen.getByLabelText('Useful results target')).toBeEnabled()
    expect(screen.getByLabelText('Useful results target')).toHaveValue(250)
    expect(screen.getByText(/Saved useful results target: 250/i)).toBeInTheDocument()
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
        usefulTarget: 100,
      },
      filters: {
        maxResolutionCount: 10,
        roleTerms: ['intern'],
      },
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

    fireEvent.change(within(cardA).getByLabelText('Useful results target'), {
      target: { value: '210' },
    })
    fireEvent.click(within(cardA).getByRole('button', { name: 'Save Jobright settings' }))
    fireEvent.change(within(cardB).getByLabelText('Useful results target'), {
      target: { value: '220' },
    })
    fireEvent.click(within(cardB).getByRole('button', { name: 'Save Jobright settings' }))

    expect(await within(cardA).findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(await within(cardB).findByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(cardA).getByLabelText('Useful results target')).toBeDisabled()
    expect(within(cardB).getByLabelText('Useful results target')).toBeDisabled()
    expect(within(cardA).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(within(cardB).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(within(cardA).getByRole('button', { name: 'Run Jobright now' }))
    fireEvent.click(within(cardB).getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdateA?.({
        ...instanceA,
        config: { usefulTarget: 210 },
        updatedAt: '2026-07-09T15:01:00.000Z',
      })
    })

    expect(await within(cardA).findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(within(cardA).getByLabelText('Useful results target')).toBeEnabled()
    expect(within(cardA).getByLabelText('Useful results target')).toHaveValue(210)
    expect(within(cardB).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(cardB).getByLabelText('Useful results target')).toBeDisabled()
    expect(within(cardB).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    fireEvent.click(within(cardB).getByRole('button', { name: 'Run Jobright now' }))
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpdateB?.({
        ...instanceB,
        config: { usefulTarget: 220 },
        updatedAt: '2026-07-09T15:02:00.000Z',
      })
    })

    expect(await within(cardB).findByRole('button', { name: 'Save Jobright settings' })).toBeEnabled()
    expect(within(cardB).getByLabelText('Useful results target')).toBeEnabled()
    expect(within(cardB).getByLabelText('Useful results target')).toHaveValue(220)
    expect(within(cardA).getByLabelText('Useful results target')).toHaveValue(210)
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
  })

  it('distinguishes saved, draft, and effective values for legacy resolution caps', async () => {
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
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern'],
        },
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })

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

    expect(await screen.findByLabelText('Useful results target')).toHaveValue(100)
    expect(screen.getByText(/Saved useful results target: default 100/i)).toBeInTheDocument()
    expect(screen.getByText(/Requested detail-resolution attempts \(saved\): 50 \(legacy\)/i))
      .toBeInTheDocument()
    expect(screen.getByText(/Effective detail-resolution attempts: 10/i)).toBeInTheDocument()
    expect(screen.getByText(/host request budget 10/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Useful results target'), {
      target: { value: '200' },
    })
    expect(screen.getByText(/Unsaved draft useful results target: 200/i)).toBeInTheDocument()
    expect(screen.getByText(/Saved useful results target: default 100/i)).toBeInTheDocument()
  })

  it('exposes advanced discovery controls and rejects resolution attempts above the host budget', async () => {
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
        config: {
          customKeep: 'still-here',
        },
        filters: {
          maxResolutionCount: 50,
          roleTerms: ['intern'],
        },
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
      config: input.config ?? { customKeep: 'still-here' },
      filters: input.filters ?? {
        maxResolutionCount: 50,
        roleTerms: ['intern'],
      },
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

    fireEvent.click(await screen.findByText('Advanced connector limits'))
    expect(screen.getByLabelText('Discovery page size')).toHaveValue(20)
    expect(screen.getByLabelText('Discovery page limit')).toHaveValue(40)
    expect(screen.getByLabelText('Discovery record limit')).toHaveValue(500)
    expect(screen.getByText(/Host request budget: effective 10 requests\/run/i)).toBeInTheDocument()
    expect(screen.getByText(/connector-supported maximum 25/i)).toBeInTheDocument()
    expect(screen.getByText(/takes precedence/i)).toBeInTheDocument()
    expect(screen.getByText(/Pacing: concurrency 1, 1–10 seconds between bounded requests/i))
      .toBeInTheDocument()
    expect(screen.getByLabelText('Requested detail-resolution attempts')).toHaveValue(50)
    expect(screen.getByText(/Saved value is labeled legacy/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Requested detail-resolution attempts'), {
      target: { value: '11' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))
    expect(await screen.findByText(
      'Requested detail-resolution attempts cannot exceed the effective host request budget of 10.',
    )).toBeInTheDocument()
    expect(connectorsApi.update).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Requested detail-resolution attempts'), {
      target: { value: '8' },
    })
    fireEvent.change(screen.getByLabelText('Discovery page size'), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByLabelText('Discovery page limit'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText('Discovery record limit'), {
      target: { value: '200' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        config: {
          customKeep: 'still-here',
          discoveryCount: 30,
          maxDiscoveryPages: 12,
          maxDiscoveryRecords: 200,
          usefulTarget: 100,
        },
        connectorInstanceId: 'jobright-default',
        filters: {
          maxResolutionCount: 8,
          roleTerms: ['intern'],
        },
      })
    })
  })

})
