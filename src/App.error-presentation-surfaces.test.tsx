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
  createActionQueueResult,
  createListResult,
  createSettingsApi,
  createSourcingResult,
} from './App.test-helpers'
import { classifyErrorPresentation } from './app/error-presentation'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('error presentation production surfaces', () => {
  it('renders AuthenticationFailure for typed authentication load failures', async () => {
    const applicationLoader = vi.fn(async () => {
      throw new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'auth dump secret',
        status: 401,
      })
    })

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'authentication-failure')
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      valedictorianFailureKindMessages.authentication,
    )
    expect(screen.queryByText(/auth dump secret/i)).not.toBeInTheDocument()
  })

  it('renders GlobalFailureAlert for typed transport unavailability', async () => {
    const applicationLoader = vi.fn(async () => {
      throw new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/secret/socket'),
      })
    })

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      valedictorianFailureKindMessages.unavailable,
    )
    expect(screen.queryByText(/ECONNREFUSED/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret\/socket/i)).not.toBeInTheDocument()
  })

  it('settles an initial Applications AbortError to usable empty UI without a load-failure owner', async () => {
    const applicationLoader = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByText('No applications found.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument()
    expect(applicationLoader).toHaveBeenCalledTimes(1)
  })

  it('keeps one app-wide GlobalFailureAlert across navigation with a single Retry contract', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/secret/socket'),
      }))
      .mockResolvedValue(createListResult([]))
    const sourcingLoader = vi.fn(async () => createSourcingResult([]))

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(
      valedictorianFailureKindMessages.unavailable,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Opportunities' })).toBeInTheDocument()
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'global-failure')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('owns simultaneous global producers by source so unrelated recovery does not clear the displayed failure', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/apps/secret'),
      }))
      .mockResolvedValue(createListResult([]))
    const actionQueueLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/queue/secret'),
      }))
      .mockResolvedValue(createActionQueueResult([]))
    const sourcingLoader = vi.fn(async () => createSourcingResult([]))

    render(
      <App
        actionQueueLoader={actionQueueLoader}
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
        sourcingLoader={sourcingLoader}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(applicationLoader).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    await waitFor(() => expect(actionQueueLoader).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Opportunities' })).toBeInTheDocument()
    })
    await waitFor(() => expect(sourcingLoader).toHaveBeenCalled())
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(actionQueueLoader).toHaveBeenCalledTimes(1)
    expect(applicationLoader).toHaveBeenCalledTimes(1)

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    // Action Queue retry is gated until that view is active again.
    expect(actionQueueLoader).toHaveBeenCalledTimes(1)
    expect(applicationLoader).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    await waitFor(() => expect(actionQueueLoader).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(applicationLoader).toHaveBeenCalledTimes(1)

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(actionQueueLoader).toHaveBeenCalledTimes(2)
  })

  it('clears a prior Applications global entry when the same producer settles AbortError', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/apps/secret'),
      }))
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByText('No applications found.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('replaces an Applications global entry with authentication on the next settlement', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/apps/secret'),
      }))
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'auth dump secret',
        status: 401,
      }))

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))

    await waitFor(() => {
      expect(document.querySelector('[data-slot="authentication-failure"]')).not.toBeNull()
    })
    expect(document.querySelector('[data-slot="global-failure"]')).toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByText(/auth dump secret/i)).not.toBeInTheDocument()
  })

  it('keeps an unrelated Action Queue global after Applications settles AbortError', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/apps/secret'),
      }))
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
    const actionQueueLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/queue/secret'),
      }))
      .mockResolvedValueOnce(createActionQueueResult([]))

    render(
      <App
        actionQueueLoader={actionQueueLoader}
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    await waitFor(() => expect(actionQueueLoader).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Applications' }))
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'abort-query' } })
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByText('No applications found.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(actionQueueLoader).toHaveBeenCalledTimes(1)

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    // Action Queue retry is gated until that view is active again.
    expect(actionQueueLoader).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    await waitFor(() => expect(actionQueueLoader).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('keeps background classifier outputs as background surface, not request errors', () => {
    expect(
      classifyErrorPresentation(new Error('poll tick'), {
        scope: 'background',
        trigger: 'background',
      }),
    ).toMatchObject({
      surface: 'background',
    })
  })

  it('retries Applications after typed transport/global load failures', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/secret/socket'),
      }))
      .mockResolvedValueOnce(createListResult([]))

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/ECONNREFUSED/i)).not.toBeInTheDocument()
  })

  it('retries Applications after typed authentication load failures', async () => {
    const applicationLoader = vi.fn()
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'auth dump secret',
        status: 401,
      }))
      .mockResolvedValueOnce(createListResult([]))

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'authentication-failure')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(applicationLoader).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/auth dump secret/i)).not.toBeInTheDocument()
  })
})
