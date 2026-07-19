import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createConnectorStatusResult,
  createListResult,
  createSettingsApi,
  openConnectorEditor,
  openSettingsPage,
} from './App.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
})
describe('connector backend availability', () => {
  it('keeps a failed list distinct from empty and recovers persisted state on retry', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list)
      .mockRejectedValueOnce(new TypeError('fetch failed: secret session detail'))
      .mockResolvedValueOnce({ items: [jobrightInstance()] })
    renderApp(connectorsApi)
    await openConnectors()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).toHaveTextContent('Connector state could not be loaded.')
    expect(alert).not.toHaveTextContent(/secret session detail/i)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Empty connector instances')).not.toBeInTheDocument()
    expect(screen.queryByText('No connector instances configured.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Jobright connector' })).not.toBeInTheDocument()
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(connectorsApi.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('1 connector instance configured.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Jobright connector' })).not.toBeInTheDocument()
  })
  it('does not treat a forged bare 409 create rejection as already configured', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.create).mockRejectedValue(Object.assign(
      new Error('duplicate credential session abc123'),
      { status: 409 },
    ))
    renderApp(connectorsApi)
    await openConnectors()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    expect(await screen.findByText(
      'The connector action was rejected. Reload connector state before trying again.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/already configured/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/abc123/i)).not.toBeInTheDocument()
  })

  it('sanitizes a schema-validated already-configured create rejection', async () => {
    const { ValedictorianHttpError } = await import('sparxie')
    const { canonicalAlreadyConfiguredBody } = await import('./app/error-presentation')
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.create).mockRejectedValue(new ValedictorianHttpError({
      body: { ...canonicalAlreadyConfiguredBody },
      message: 'Request failed',
      status: 409,
    }))
    renderApp(connectorsApi)
    await openConnectors()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    expect(await screen.findByText(
      'Jobright is already configured. Reload connector state and manage the existing instance.',
    )).toBeInTheDocument()
  })
  it('reloads through the same renderer when the verified backend binding recovers', async () => {
    const connectorsApi = createConnectorsApi()
    let resolveStaleList!: (value: { items: ReturnType<typeof jobrightInstance>[] }) => void
    vi.mocked(connectorsApi.list)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStaleList = resolve }))
      .mockResolvedValueOnce({ items: [jobrightInstance()] })
    let lifecycleListener: ((state: { status: string }) => void) | undefined
    ;(window as Window & { valedictorianHttp?: unknown }).valedictorianHttp = {
      onBackendStateChanged(listener: (state: { status: string }) => void) {
        lifecycleListener = listener
        return () => undefined
      },
    }
    renderApp(connectorsApi)
    await openConnectors()
    await waitFor(() => expect(connectorsApi.list).toHaveBeenCalledOnce())
    expect(screen.getByText('Loading connector instances...')).toBeInTheDocument()
    expect(screen.queryByLabelText('Empty connector instances')).not.toBeInTheDocument()
    lifecycleListener?.({ status: 'unavailable' })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).toHaveTextContent('Connector state could not be loaded.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    resolveStaleList({ items: [jobrightInstance()] })
    await waitFor(() => expect(screen.queryByText('1 connector instance configured.')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'scoped-load-failure')
    lifecycleListener?.({ status: 'available' })
    expect(await screen.findByText('1 connector instance configured.')).toBeInTheDocument()
    expect(screen.queryByText('Loading connector instances...')).not.toBeInTheDocument()
    expect(connectorsApi.list).toHaveBeenCalledTimes(2)
  })

  it('invalidates stale Overview actions immediately and reloads after lifecycle recovery', async () => {
    const lifecycleListeners = new Set<(state: { status: string }) => void>()
    ;(window as Window & { valedictorianHttp?: unknown }).valedictorianHttp = {
      onBackendStateChanged(listener: (state: { status: string }) => void) {
        lifecycleListeners.add(listener)
        return () => lifecycleListeners.delete(listener)
      },
    }
    let resolveStaleOverview!: (value: ReturnType<typeof createConnectorStatusResult>) => void
    const connectorStatusLoader = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStaleOverview = resolve }))
      .mockResolvedValueOnce(createConnectorStatusResult())
    render(<App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorStatusLoader={connectorStatusLoader}
      connectorsApi={createConnectorsApi()}
      settingsApi={createSettingsApi()}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    await waitFor(() => expect(connectorStatusLoader).toHaveBeenCalledOnce())

    lifecycleListeners.forEach((listener) => listener({ status: 'unavailable' }))
    expect(await screen.findByText('Connector status is unavailable for this runtime.')).toBeInTheDocument()
    resolveStaleOverview(createConnectorStatusResult())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reconnect Fixture Jobs' })).not.toBeInTheDocument())
    expect(screen.getByText('Connector status is unavailable for this runtime.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect Fixture Jobs' })).not.toBeInTheDocument()
    lifecycleListeners.forEach((listener) => listener({ status: 'available' }))

    expect(await screen.findByRole('button', { name: 'Reconnect Fixture Jobs' })).toBeInTheDocument()
    expect(connectorStatusLoader).toHaveBeenCalledTimes(2)
  })

  it('keeps the newest same-generation Overview refresh when callbacks resolve out of order', async () => {
    const pendingReloads: Array<(value: ReturnType<typeof createConnectorStatusResult>) => void> = []
    const connectorStatusLoader = vi.fn()
      .mockResolvedValueOnce(createConnectorStatusResult())
      .mockImplementation(() => new Promise((resolve) => { pendingReloads.push(resolve) }))
    const connectorsApi = createConnectorsApi()
    render(<App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorStatusLoader={connectorStatusLoader}
      connectorsApi={connectorsApi}
      settingsApi={createSettingsApi()}
    />)
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(await screen.findByRole('button', { name: 'Reconnect Fixture Jobs' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add Jobright connector' }))
    await waitFor(() => expect(connectorsApi.create).toHaveBeenCalledOnce())
    await openConnectorEditor()
    await act(async () => undefined)
    expect(connectorStatusLoader).toHaveBeenCalledTimes(2)

    fireEvent.click(await screen.findByRole('switch', { name: 'Jobright connector enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright internslist connector settings' }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledOnce())
    await act(async () => undefined)
    expect(connectorStatusLoader).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await act(async () => {
      pendingReloads[1]?.(createConnectorStatusResult([]))
    })
    expect(await screen.findByRole('heading', { name: 'No enabled connectors' })).toBeInTheDocument()

    await act(async () => {
      pendingReloads[0]?.(createConnectorStatusResult())
    })
    expect(screen.getByRole('heading', { name: 'No enabled connectors' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect Fixture Jobs' })).not.toBeInTheDocument()
  })
})
function renderApp(connectorsApi: ReturnType<typeof createConnectorsApi>) {
  render(<App
    applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
    connectorsApi={connectorsApi}
    settingsApi={createSettingsApi()}
  />)
}
async function openConnectors() {
  await openSettingsPage()
  fireEvent.click(within(screen.getByRole('complementary', {
    name: 'Settings navigation',
  })).getByRole('button', { name: 'Connectors' }))
  if (screen.queryByRole('button', { name: 'View Jobright internslist details' })) {
    await openConnectorEditor()
  }
}
function jobrightInstance() {
  return {
    id: 'jobright-default', connectorId: 'jobright.resolver', connectorVersion: '0.11.0',
    displayName: 'Jobright internslist', enabled: true,
    auth: [{ id: 'jobright', mode: 'username_password' as const, label: 'Jobright credentials', configured: false }],
    config: {}, filters: {}, earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z', updatedAt: '2026-07-09T15:00:00.000Z',
  }
}
