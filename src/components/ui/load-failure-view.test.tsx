import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { presentLoadFailure } from '@/app/error-presentation'
import { LoadFailureView } from './load-failure-view'

afterEach(cleanup)

describe('LoadFailureView surface ownership', () => {
  it('renders null for surface none and empty cancellation messages', () => {
    const { container: noneContainer } = render(
      <LoadFailureView
        failure={{
          message: '',
          retryable: false,
          surface: 'none',
          title: '',
        }}
        onRetry={vi.fn()}
      />,
    )
    expect(noneContainer).toBeEmptyDOMElement()

    const cancelled = presentLoadFailure(new DOMException('Aborted', 'AbortError'), {
      operationId: 'load:cancelled',
      trigger: 'load',
    })
    const { container: abortContainer } = render(
      <LoadFailureView failure={cancelled} onRetry={vi.fn()} />,
    )
    expect(abortContainer).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('omits Retry for non-retryable scoped failures and keeps Retry when retryable', () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <LoadFailureView
        failure={{
          message: 'Load failed',
          retryable: false,
          surface: 'scoped_load',
          title: 'Load failed',
        }}
        onRetry={onRetry}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    rerender(
      <LoadFailureView
        failure={{
          message: 'Load failed',
          retryable: true,
          surface: 'scoped_load',
          title: 'Load failed',
        }}
        onRetry={onRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not render a blank destructive alert for cancel-trigger presentations', () => {
    const cancelled = presentLoadFailure(new Error('ignored dump /secret'), {
      operationId: 'load:cancel-trigger',
      trigger: 'cancel',
    })
    expect(cancelled.surface).toBe('none')
    expect(cancelled.message).toBe('')

    const { container } = render(
      <LoadFailureView failure={cancelled} onRetry={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('/secret')).not.toBeInTheDocument()
  })
})
