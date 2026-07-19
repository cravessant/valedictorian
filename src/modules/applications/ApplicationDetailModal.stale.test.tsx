import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDetailModal } from './ApplicationDetailModal'
import {
  createApplicationDetail,
  createAttemptResult,
  createEventsResult,
  createLinksResult,
} from '../../App.test-helpers'
import type { ErrorPresentation } from '../../app/error-presentation'

beforeEach(() => {
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
})

function scopedFailure(message: string): ErrorPresentation {
  return {
    message,
    retryable: true,
    surface: 'scoped_load',
    title: 'Load failed',
  }
}

describe('ApplicationDetailModal stale subsection preservation', () => {
  it('keeps stale Links, Events, and Attempts visible beside load failures without skeletons', async () => {
    const onRetryLoad = vi.fn()
    const links = createLinksResult().items
    const events = createEventsResult().items
    const attempts = createAttemptResult().items
    const baseProps = {
      application: createApplicationDetail(),
      attempts,
      attemptsError: null as ErrorPresentation | null,
      detailError: null as ErrorPresentation | null,
      events,
      eventsError: null as ErrorPresentation | null,
      isAttemptsLoading: false,
      isDetailLoading: false,
      isEventsLoading: false,
      isLinksLoading: false,
      links,
      linksError: null as ErrorPresentation | null,
      onClose: () => undefined,
      onRetryLoad,
    }

    const { rerender } = render(<ApplicationDetailModal {...baseProps} />)

    expect(screen.getAllByRole('link', { name: links[0]!.label }).length).toBeGreaterThan(0)
    expect(screen.getByText('Application created from sourcing.')).toBeInTheDocument()
    expect(screen.getByText('Needs exact availability dates.')).toBeInTheDocument()

    rerender(
      <ApplicationDetailModal
        {...baseProps}
        isLinksLoading
        isEventsLoading
        isAttemptsLoading
        linksError={scopedFailure('Links could not be loaded.')}
        eventsError={scopedFailure('Events could not be loaded.')}
        attemptsError={scopedFailure('Attempts could not be loaded.')}
      />,
    )

    expect(screen.getAllByRole('link', { name: links[0]!.label }).length).toBeGreaterThan(0)
    expect(screen.getByText('Application created from sourcing.')).toBeInTheDocument()
    expect(screen.getByText('Needs exact availability dates.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Application links loading')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Application events loading')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Attempts loading')).not.toBeInTheDocument()
    expect(screen.getByText('Links could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Events could not be loaded.')).toBeInTheDocument()
    expect(screen.getByText('Attempts could not be loaded.')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!)
    await waitFor(() => expect(onRetryLoad).toHaveBeenCalledTimes(1))
  })
})
