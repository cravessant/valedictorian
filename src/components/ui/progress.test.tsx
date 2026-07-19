import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Progress } from './progress'

afterEach(cleanup)

describe('Progress', () => {
  it('exposes a determinate progressbar value', () => {
    render(<Progress aria-label="Download progress" value={43} />)

    expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute(
      'aria-valuenow',
      '43',
    )
  })

  it('clamps overflowed values so the progressbar stays within 0..100', () => {
    render(<Progress aria-label="Update download" value={140} />)

    const progressbar = screen.getByRole('progressbar', { name: 'Update download' })
    expect(progressbar).toHaveAttribute('aria-valuenow', '100')
    expect(progressbar.firstElementChild).toHaveStyle({
      transform: 'translateX(-0%)',
    })
  })

  it('clamps underflown values so the progressbar stays within 0..100', () => {
    render(<Progress aria-label="Update download" value={-20} />)

    const progressbar = screen.getByRole('progressbar', { name: 'Update download' })
    expect(progressbar).toHaveAttribute('aria-valuenow', '0')
    expect(progressbar.firstElementChild).toHaveStyle({
      transform: 'translateX(-100%)',
    })
  })
})
