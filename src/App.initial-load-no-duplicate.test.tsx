import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createActionQueueItem,
  createActionQueueResult,
  createApplication,
  createConnectorStatusResult,
  createListResult,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
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

describe('App initial-load effects stay single-shot after success', () => {
  it('does not re-request Applications after the first successful load settles', async () => {
    const applicationLoader = vi.fn(async () => createListResult([createApplication()]))

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(applicationLoader).toHaveBeenCalledTimes(1)
  })

  it('does not re-request Action Queue after the first successful load settles', async () => {
    const actionQueueLoader = vi.fn(async () => createActionQueueResult([createActionQueueItem()]))

    render(
      <App
        actionQueueLoader={actionQueueLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    expect(await screen.findByRole('table', { name: 'Action Queue' })).toBeInTheDocument()
    await waitFor(() => expect(actionQueueLoader).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(actionQueueLoader).toHaveBeenCalledTimes(1)
  })

  it('does not re-request Connector Status after the first successful load settles', async () => {
    const connectorStatusLoader = vi.fn(async () => createConnectorStatusResult())

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await openConnectorsOverview()
    await waitFor(() => expect(connectorStatusLoader).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(connectorStatusLoader).toHaveBeenCalledTimes(1)
  })

  it('does not re-request Sourcing after the first successful load settles', async () => {
    const sourcingLoader = vi.fn(async () => createSourcingResult([createSourcingFinding()]))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    expect(await screen.findByRole('table', { name: 'Opportunities' })).toBeInTheDocument()
    await waitFor(() => expect(sourcingLoader).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sourcingLoader).toHaveBeenCalledTimes(1)
  })
})
