import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ValedictorianProtocolError } from 'sparxie'
import App from './App'
import {
  createActionQueueItem,
  createActionQueueResult,
  createApplication,
  createApplicationDetail,
  createConnectorStatusResult,
  createListResult,
  createPolicyApi,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
  openSettingsPage,
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
  delete (window as Window & { actionQueue?: unknown }).actionQueue
  delete (window as Window & { connectors?: unknown }).connectors
})

async function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  const connectorsTrigger = within(appNavigation).getByRole('button', { name: 'Connectors' })
  if (!within(appNavigation).queryByRole('button', { name: 'Overview' })) {
    fireEvent.click(connectorsTrigger)
  }
  fireEvent.click(await within(appNavigation).findByRole('button', { name: 'Overview' }))
  return appNavigation
}

describe('load failure Retry wiring', () => {
  it('retries Applications, Action Queue, Connector Status, and Sourcing loaders from scoped alerts', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'applications down' }))
      .mockResolvedValue(createListResult([createApplication()]))
    const actionQueueLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'queue down' }))
      .mockResolvedValue(createActionQueueResult([createActionQueueItem()]))
    const connectorStatusLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'connectors down' }))
      .mockResolvedValue(createConnectorStatusResult())
    const sourcingLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'sourcing down' }))
      .mockResolvedValue(createSourcingResult([createSourcingFinding()]))

    render(
      <App
        actionQueueLoader={actionQueueLoader}
        applicationLoader={applicationLoader}
        connectorStatusLoader={connectorStatusLoader}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    expect(await screen.findByText('Applications could not be loaded.')).toBeInTheDocument()
    const applicationsAlert = screen.getByRole('alert')
    expect(applicationsAlert).toHaveAttribute('data-slot', 'scoped-load-failure')
    fireEvent.click(within(applicationsAlert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    expect(await screen.findByText('Action Queue could not be loaded.')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(actionQueueLoader).toHaveBeenCalledTimes(2))

    await openConnectorsOverview()
    expect(await screen.findByText('Connector status could not be loaded.')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(connectorStatusLoader).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByText('Opportunities could not be loaded.')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(sourcingLoader).toHaveBeenCalledTimes(2))
  })

  it('retries Policy settings load and application detail subsection loads', async () => {
    const policyApi = createPolicyApi()
    const defaultConfig = await policyApi.config.get()
    vi.mocked(policyApi.config.get)
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'policy store unavailable' }))
      .mockResolvedValue(defaultConfig)

    const applicationDetailLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'detail down' }))
      .mockResolvedValue(createApplicationDetail())
    const applicationLinksLoader = vi.fn().mockRejectedValue(new ValedictorianProtocolError({ message: 'links down' }))
    const applicationEventsLoader = vi.fn().mockRejectedValue(new ValedictorianProtocolError({ message: 'events down' }))
    const attemptLoader = vi.fn().mockRejectedValue(new ValedictorianProtocolError({ message: 'attempts down' }))

    render(
      <App
        applicationDetailLoader={applicationDetailLoader}
        applicationEventsLoader={applicationEventsLoader}
        applicationLinksLoader={applicationLinksLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        attemptLoader={attemptLoader}
        policyApi={policyApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))
    expect(await screen.findByText('An unexpected error occurred.')).toBeInTheDocument()
    const policyCallsBeforeRetry = vi.mocked(policyApi.config.get).mock.calls.length
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(policyApi.config.get.mock.calls.length).toBeGreaterThan(policyCallsBeforeRetry)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }))
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByText('Astranis Space Technologies'))

    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })
    expect(await within(dialog).findByText('Application detail could not be loaded.')).toBeInTheDocument()
    const detailCallsBeforeRetry = applicationDetailLoader.mock.calls.length
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Retry' })[0]!)
    await waitFor(() => {
      expect(applicationDetailLoader.mock.calls.length).toBeGreaterThan(detailCallsBeforeRetry)
    })
  })
})
