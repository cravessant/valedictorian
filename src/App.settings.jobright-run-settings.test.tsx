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
  createConnectorStatusResult,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  createSourcingResult,
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

async function authenticateJobrightInSettings({
  connectorsApi,
  profileApi,
  email = 'demo@example.com',
  password = ' pass with spaces ',
}: {
  connectorsApi: ReturnType<typeof createConnectorsApi>
  profileApi: ReturnType<typeof createProfileApi>
  email?: string
  password?: string
}) {
  const editButton = await screen.findByRole('button', {
    name: /^(Add credentials|Update credentials)$/,
  })
  fireEvent.click(editButton)
  fireEvent.change(await screen.findByLabelText('Jobright email'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByLabelText('Jobright password'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))
  await screen.findByText('Auth verified')
  expect(profileApi.secrets.upsert).toHaveBeenCalled()
  expect(connectorsApi.status.reconnect).toHaveBeenCalled()
  expect(screen.queryByDisplayValue(email)).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue(password)).not.toBeInTheDocument()
}

describe('App settings and chrome', () => {
  it('shows sanitized secure-storage failure when revalidation returns it', async () => {
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
          maxResolutionCount: 10,
          roleTerms: ['intern'],
        },
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    vi.mocked(connectorsApi.status.reconnect).mockResolvedValue({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      grants: [{
        id: 'jobright',
        mode: 'username_password',
        reason: 'secure_storage_unavailable',
        status: 'action_required',
      }],
      message: 'Secure storage is unavailable. Enable platform encryption, then try again.',
      reason: 'secure_storage_unavailable',
      status: 'failed',
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

    expect(await screen.findByText(
      'Secure storage is unavailable. Enable platform encryption, then try again.',
    )).toBeInTheDocument()
    expect(screen.getByText('Auth failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument()
  })

  it('keeps failed validation non-ready and clears credential inputs', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.status.reconnect).mockResolvedValue({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      grants: [
        {
          id: 'jobright',
          mode: 'username_password',
          reason: 'jobright_login_rejected',
          status: 'action_required',
        },
      ],
      message: 'Connector credentials were rejected. Update email and password, then validate again.',
      reason: 'jobright_login_rejected',
      status: 'action_required',
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
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: 'wrong-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    expect(await screen.findByText(
      'Connector credentials were rejected. Update email and password, then validate again.',
    )).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('wrong-password')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
  })

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

  it('runs an authenticated Jobright connector from settings', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()

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
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    const runButtonBeforeAuth = await screen.findByRole('button', { name: 'Run Jobright now' })
    expect(runButtonBeforeAuth).toBeDisabled()

    await authenticateJobrightInSettings({ connectorsApi, profileApi })

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledWith(expect.objectContaining({
        connectorInstanceId: 'jobright-default',
        mode: 'manual',
        reason: 'settings_manual_refresh',
      }))
    })
    expect(await screen.findByText('Latest run: completed')).toBeInTheDocument()
  })

  it('shows two persisted non-terminal progress snapshots before terminal connector counts', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const connectorStatusLoader = vi.fn(async () => createConnectorStatusResult([]))
    const sourcingLoader = vi.fn(async () => createSourcingResult([]))
    type ConnectorRun = Awaited<ReturnType<typeof connectorsApi.runs.trigger>>
    let resolveRun: ((run: ConnectorRun) => void) | undefined
    const pendingRun = new Promise<ConnectorRun>((resolve) => {
      resolveRun = resolve
    })
    vi.mocked(connectorsApi.runs.trigger).mockReturnValueOnce(pendingRun)
    const lifecycleCounts = (source: 'live_current' | 'frozen_terminal') => ({
      version: 'connector-run-lifecycle-counts/v1',
      source,
      scope: { kind: 'connector_run', connectorRunId: 'connector-run-progress' },
      provider: {
        returnedRows: 0,
        validRecords: 0,
        invalidRecords: 0,
        sourceDuplicates: 0,
        capturedRecords: 0,
        occurrenceCount: 0,
        captureShortfall: 0,
        unclassifiedRows: 0,
        invariant: 'reported_stats_missing',
        gaps: [
          'missing_provider_returned',
          'missing_provider_valid',
          'missing_provider_invalid',
          'missing_source_duplicates',
        ],
      },
      destination: {
        normalized: 0,
        resolvedEmployerOrAts: 0,
        resolvedThirdParty: 0,
        unresolved: 0,
        pending: 0,
        gateRejected: 0,
        unclassified: 0,
        invariant: 'reconciled',
      },
      sourcing: {
        added: 0,
        queueDuplicate: 0,
        notFit: 0,
        rejected: 0,
        actionableReview: 0,
        unclassified: 0,
        invariant: 'reconciled',
      },
    })
    const progressRun = (stage: string, stats: Record<string, unknown>): ConnectorRun => ({
      id: 'connector-run-progress',
      connectorInstanceId: 'jobright-default',
      mode: 'manual',
      status: 'running',
      coverage: {
        start: '2026-07-09T15:00:00.000Z',
        end: '2026-07-09T16:00:00.000Z',
      },
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      stats: { stage, ...stats, lifecycleCounts: lifecycleCounts('live_current') },
      warnings: [],
      retryHints: null,
      startedAt: '2026-07-09T16:00:00.000Z',
      completedAt: null,
    })
    vi.mocked(connectorsApi.runs.list)
      .mockResolvedValueOnce({
        items: [progressRun('authenticating', {
          discovered: 0,
          lastProgressAt: '2026-07-09T16:00:00.250Z',
        })],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [progressRun('normalizing', {
          attempted: 3,
          discovered: 20,
          lastProgressAt: '2026-07-09T16:00:01.000Z',
          remainingTarget: 6,
          resolvedEmployerOrAts: 1,
          resolvedThirdParty: 1,
          unresolved: 1,
          wait: {
            maxDelayMs: 2_000,
            minDelayMs: 1_000,
            reason: 'jobright_resolution',
          },
        })],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        connectorsApi={connectorsApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await authenticateJobrightInSettings({ connectorsApi, profileApi })

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    expect(await screen.findByText('Stage: Authenticating')).toBeInTheDocument()
    expect(await screen.findByText('Stage: Normalizing', {}, { timeout: 2_000 })).toBeInTheDocument()
    expect(screen.getByText('Live counts derived from current persisted lineage.')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 20')).toBeInTheDocument()
    expect(screen.getByText('Resolved employer / ATS: 1')).toBeInTheDocument()
    expect(screen.getByText('Resolved third-party: 1')).toBeInTheDocument()
    expect(screen.getByText('Remaining target: 6')).toBeInTheDocument()
    expect(screen.getByText('Waiting between bounded Jobright API requests.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Jobright internslist run progress' })).toHaveAttribute(
      'aria-live',
      'polite',
    )
    expect(screen.getByRole('button', { name: 'View connector-run-progress in Connector Runs' }))
      .toBeInTheDocument()

    await act(async () => {
      resolveRun?.({
        id: 'connector-run-progress',
        connectorInstanceId: 'jobright-default',
        mode: 'manual',
        status: 'partial_success',
        coverage: {
          start: '2026-07-09T15:00:00.000Z',
          end: '2026-07-09T16:00:00.000Z',
        },
        filterSignature: 'filters:{}',
        observationCount: 8,
        warningCount: 1,
        stats: {
          attempted: 3,
          authRequired: 1,
          discovered: 12,
          eligible: 8,
          failures: 2,
          observations: 8,
          projectedUsable: 2,
          retainedForReview: 6,
          resolved: 2,
          resolvedEmployerOrAts: 1,
          resolvedThirdParty: 1,
          stage: 'finalizing',
          stopReason: 'source_exhausted',
          lifecycleCounts: lifecycleCounts('frozen_terminal'),
        },
        warnings: [],
        retryHints: {
          reason: 'auth_required',
        },
        startedAt: '2026-07-09T16:00:00.000Z',
        completedAt: '2026-07-09T16:00:02.000Z',
      })
    })

    expect(await screen.findByText('Latest run: partial_success')).toBeInTheDocument()
    expect(screen.getByText('Frozen at terminal completion.')).toBeInTheDocument()
    expect(screen.getByText('Discovered jobs: 12')).toBeInTheDocument()
    expect(screen.getByText('Detail attempts: 3')).toBeInTheDocument()
    expect(screen.getByText('Auth-required requests: 1')).toBeInTheDocument()
    expect(screen.queryByText('Eligible: 8')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected usable: 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Retained for review: 6')).not.toBeInTheDocument()
    expect(screen.getByText('Warnings: 1')).toBeInTheDocument()
    expect(screen.getByText('Failures: 2')).toBeInTheDocument()
    expect(screen.queryByText('auth_required')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(connectorStatusLoader).toHaveBeenCalledTimes(1)
      expect(sourcingLoader).toHaveBeenCalledTimes(1)
    })
  })

})
