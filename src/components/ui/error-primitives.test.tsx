import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthenticationFailure,
  FormFailureAlert,
  GlobalFailureAlert,
  ScopedLoadFailure,
} from './error-primitives'

afterEach(cleanup)

describe('error presentation primitives', () => {
  it('focuses each failure primitive when newly presented and keeps Retry wired', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    const { rerender } = render(
      <FormFailureAlert message="Policy settings failed to save." />,
    )
    const formAlert = screen.getByRole('alert')
    expect(formAlert).toHaveAttribute('tabIndex', '-1')
    expect(document.activeElement).toBe(formAlert)
    expect(formAlert).toHaveTextContent('Could not save')
    expect(formAlert).toHaveTextContent('Policy settings failed to save.')

    rerender(
      <ScopedLoadFailure
        message="Opportunities could not be loaded."
        onRetry={onRetry}
      />,
    )
    const loadAlert = screen.getByRole('alert')
    expect(loadAlert).toHaveAttribute('tabIndex', '-1')
    expect(document.activeElement).toBe(loadAlert)
    expect(loadAlert).toHaveTextContent('Opportunities could not be loaded.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(
      <GlobalFailureAlert
        message="The workspace backend is unavailable."
        onRetry={onRetry}
      />,
    )
    const globalAlert = screen.getByRole('alert')
    expect(globalAlert).toHaveAttribute('aria-live', 'assertive')
    expect(globalAlert).toHaveAttribute('tabIndex', '-1')
    expect(document.activeElement).toBe(globalAlert)
    expect(globalAlert).toHaveTextContent('Service unavailable')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(2)

    rerender(
      <AuthenticationFailure
        message="Authentication is required."
        onRetry={onRetry}
      />,
    )
    const authAlert = screen.getByRole('alert')
    expect(authAlert).toHaveAttribute('tabIndex', '-1')
    expect(document.activeElement).toBe(authAlert)
    expect(authAlert).toHaveTextContent('Authentication required')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(3)
  })
})
