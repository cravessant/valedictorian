import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ValedictorianHttpError,
  ValedictorianTransportError,
  valedictorianFailureKindMessages,
} from 'sparxie'
import App from './App'
import {
  createApplication,
  createApplicationDetail,
  createAttemptResult,
  createEventsResult,
  createLinksResult,
  createListResult,
  createSettingsApi,
} from './App.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
})

describe('application detail subsection LoadFailureView surfaces', () => {
  it('renders AuthenticationFailure for detail load and recovers via Retry', async () => {
    const applicationDetailLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'detail auth dump /secret',
        status: 401,
      }))
      .mockResolvedValueOnce(createApplicationDetail())

    render(
      <App
        applicationDetailLoader={applicationDetailLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    fireEvent.click(await screen.findByText('Astranis Space Technologies'))
    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'authentication-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.authentication)
    expect(alert).not.toHaveTextContent('/secret')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationDetailLoader).toHaveBeenCalledTimes(2))
    expect(await within(dialog).findByText(/Astranis/i)).toBeInTheDocument()
  })

  it('keeps stale Links, Events, and Attempts beside GlobalFailureAlert owners with Retry', async () => {
    const links = createLinksResult()
    const events = createEventsResult()
    const attempts = createAttemptResult()
    const applicationLinksLoader = vi.fn()
      .mockResolvedValueOnce(links)
      .mockRejectedValue(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/links/secret'),
      }))
    const applicationEventsLoader = vi.fn()
      .mockResolvedValueOnce(events)
      .mockRejectedValue(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/events/secret'),
      }))
    const attemptLoader = vi.fn()
      .mockResolvedValueOnce(attempts)
      .mockRejectedValue(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/attempts/secret'),
      }))

    render(
      <App
        applicationDetailLoader={async () => createApplicationDetail()}
        applicationEventsLoader={applicationEventsLoader}
        applicationLinksLoader={applicationLinksLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        attemptLoader={attemptLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    fireEvent.click(await screen.findByText('Astranis Space Technologies'))
    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })
    expect(await within(dialog).findByText('Application created from sourcing.')).toBeInTheDocument()
    expect(within(dialog).getByText('Needs exact availability dates.')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('link', { name: 'official' }).length).toBeGreaterThan(0)

    fireEvent.click(within(dialog).getByRole('button', { name: /Close application detail/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Application detail' })).not.toBeInTheDocument()
    })

    fireEvent.click(await screen.findByText('Astranis Space Technologies'))
    const reopened = await screen.findByRole('dialog', { name: 'Application detail' })
    await waitFor(() => {
      expect(within(reopened).getAllByRole('alert').length).toBeGreaterThan(0)
    })
    const alerts = within(reopened).getAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(3)
    for (const alert of alerts) {
      expect(alert).toHaveAttribute('data-slot', 'global-failure')
      expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
      expect(alert).not.toHaveTextContent('ECONNREFUSED')
    }
    expect(within(reopened).getAllByRole('link', { name: 'official' }).length).toBeGreaterThan(0)
    expect(within(reopened).getByText('Application created from sourcing.')).toBeInTheDocument()
    expect(within(reopened).getByText('Needs exact availability dates.')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()
    fireEvent.click(within(alerts[0]!).getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(applicationLinksLoader.mock.calls.length).toBeGreaterThan(2)
    })
  })
})
