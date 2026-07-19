import { render, within } from '@testing-library/react'
import { AlertCircle } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { Alert, AlertDescription, AlertTitle } from './alert'

describe('Alert', () => {
  it('composes an accessible informational alert with title and description', () => {
    const view = render(
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Restart required</AlertTitle>
        <AlertDescription>Restart the app to apply this change.</AlertDescription>
      </Alert>,
    )

    const alert = within(view.container).getByRole('alert')
    expect(within(alert).getByText('Restart required')).toBeInTheDocument()
    expect(within(alert).getByText('Restart the app to apply this change.')).toBeInTheDocument()
  })
})
