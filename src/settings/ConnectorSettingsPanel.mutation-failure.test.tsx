import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'
import App from '../App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  openConnectorEditor,
  openSettingsPage,
} from '../App.test-helpers'

const sonnerToast = vi.hoisted(() => {
  let nextId = 0
  const toastFn = vi.fn(() => `toast-default-${nextId++}`)
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(() => `toast-error-${nextId++}`),
    success: vi.fn(() => `toast-success-${nextId++}`),
    resetIds() {
      nextId = 0
    },
  })
})

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonnerToast,
}))

afterEach(cleanup)

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  clearDestructiveToastDedupe()
  sonnerToast.resetIds()
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.dismiss.mockClear()
  sonnerToast.success.mockClear()
})

describe('ConnectorSettingsPanel mutation failure ownership', () => {
  it('owns per-instance save rejection with FormFailureAlert inside the card and keeps the draft', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })
    vi.mocked(connectorsApi.update).mockRejectedValueOnce(
      new Error('save dump /secret'),
    )

    renderApp(connectorsApi)
    await openConnectors()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', {
      name: 'Save Jobright internslist connector settings',
    }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).toHaveTextContent('Connector settings could not be saved.')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByText('Connector action failed')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Jobright connector enabled')).not.toBeChecked()
  })

  it('owns non-blocking manual run rejection as one deduplicated destructive toast', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })
    vi.mocked(connectorsApi.runs.trigger).mockRejectedValue(
      new Error('run dump /secret'),
    )

    renderApp(connectorsApi)
    await openConnectors()

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))

    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    })
    expect(sonnerToast.error).toHaveBeenCalledWith(
      'Action failed',
      expect.objectContaining({
        description: 'Jobright run could not be completed.',
      }),
    )
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')
    expect(screen.queryByText('Connector action failed')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalledTimes(2)
    })
    expect(sonnerToast.error).toHaveBeenCalledTimes(1)
  })

  it('keeps save FormFailureAlert scoped per instance when one of two concurrent saves fails', async () => {
    const connectorsApi = createConnectorsApi()
    const first = {
      ...instanceFixture(),
      id: 'jobright-a',
      displayName: 'Jobright A',
    }
    const second = {
      ...instanceFixture(),
      id: 'jobright-b',
      displayName: 'Jobright B',
    }
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [first, second] })
    vi.mocked(connectorsApi.update).mockRejectedValueOnce(
      new Error('save dump /secret'),
    )

    renderApp(connectorsApi)
    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    await openConnectorEditor('Jobright A')
    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', {
      name: 'Save Jobright A connector settings',
    }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).toHaveTextContent('Connector settings could not be saved.')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByText('Connector action failed')).not.toBeInTheDocument()
    expect(screen.getByText('Jobright B')).toBeInTheDocument()
  })

  it('preserves successful save behavior without a panel-top action alert', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })
    vi.mocked(connectorsApi.update).mockResolvedValueOnce(
      instanceFixture({ enabled: false }),
    )

    renderApp(connectorsApi)
    await openConnectors()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', {
      name: 'Save Jobright internslist connector settings',
    }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        connectorInstanceId: 'jobright-default',
        enabled: false,
      })
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Connector action failed')).not.toBeInTheDocument()
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })
})

function instanceFixture(overrides: { enabled?: boolean } = {}) {
  return {
    id: 'jobright-default',
    connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0',
    displayName: 'Jobright internslist',
    enabled: overrides.enabled ?? true,
    auth: [{
      id: 'jobright',
      mode: 'username_password' as const,
      label: 'Jobright username and password',
      configured: true,
    }],
    config: { discoveryCount: 100 },
    filters: { providerOwned: 'preserve-me' },
    earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
  }
}

function renderApp(connectorsApi: ReturnType<typeof createConnectorsApi>) {
  return render(
    <App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorsApi={connectorsApi}
      profileApi={createProfileApi()}
      settingsApi={createSettingsApi()}
    />,
  )
}

async function openConnectors() {
  await openSettingsPage()
  const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
  fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
  await openConnectorEditor()
}
