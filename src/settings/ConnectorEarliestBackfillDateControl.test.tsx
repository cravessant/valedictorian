import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorEarliestBackfillDateControl } from './ConnectorEarliestBackfillDateControl'

afterEach(() => {
  cleanup()
})

describe('ConnectorEarliestBackfillDateControl', () => {
  it('opens and closes the date picker from the keyboard while restoring trigger focus', async () => {
    const user = userEvent.setup()
    render(
      <ConnectorEarliestBackfillDateControl
        createdAt="2026-07-11T12:00:00.000Z"
        instanceId="jobright-a"
        onChange={vi.fn()}
        value="2026-07-04"
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'Choose earliest backfill date for jobright-a',
    })
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('grid')).toBeVisible()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('prevents opening when disabled', () => {
    render(
      <ConnectorEarliestBackfillDateControl
        createdAt="2026-07-11T12:00:00.000Z"
        disabled
        instanceId="jobright-a"
        onChange={vi.fn()}
        value="2026-07-04"
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'Choose earliest backfill date for jobright-a',
    })
    expect(trigger).toBeDisabled()

    fireEvent.click(trigger)

    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('associates validation errors with the date picker trigger', () => {
    render(
      <ConnectorEarliestBackfillDateControl
        createdAt="2026-07-11T12:00:00.000Z"
        instanceId="jobright-a"
        onChange={vi.fn()}
        value="not-a-date"
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'Choose earliest backfill date for jobright-a',
    })
    const error = screen.getByRole('alert')

    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', error.id)
    expect(error.id).not.toBe('')
  })
})
