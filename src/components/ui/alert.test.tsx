import { render, within } from '@testing-library/react'
import { AlertCircle } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { Alert, AlertDescription, AlertTitle } from './alert'

describe('Alert', () => {
  it('composes an accessible informational alert with icon-aware shadcn slots', () => {
    const view = render(
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Restart required</AlertTitle>
        <AlertDescription>Restart the app to apply this change.</AlertDescription>
      </Alert>,
    )

    const alert = within(view.container).getByRole('alert')

    expect(alert).toHaveAttribute('data-slot', 'alert')
    expect(alert).toHaveClass('grid', 'has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr]')
    expect(within(alert).getByText('Restart required')).toHaveAttribute('data-slot', 'alert-title')
    expect(within(alert).getByText('Restart the app to apply this change.')).toHaveAttribute(
      'data-slot',
      'alert-description',
    )
  })

  it('retains the app semantic tokens for destructive alerts', () => {
    const view = render(
      <Alert variant="destructive">
        <AlertTitle>Save failed</AlertTitle>
        <AlertDescription>The application could not be saved.</AlertDescription>
      </Alert>,
    )

    const alert = within(view.container).getByRole('alert')

    expect(alert).toHaveClass('border-destructive/40', 'bg-card', 'text-destructive')
    expect(within(alert).getByText('The application could not be saved.')).toHaveClass(
      'text-muted-foreground',
    )
  })
})
