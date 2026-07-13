import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Progress } from './progress'

afterEach(cleanup)

describe('Progress', () => {
  it('exposes a determinate progressbar with shadcn slots and forwarded className', () => {
    render(<Progress aria-label="Download progress" className="mt-1" value={43} />)

    const progressbar = screen.getByRole('progressbar', { name: 'Download progress' })
    expect(progressbar).toHaveAttribute('data-slot', 'progress')
    expect(progressbar).toHaveAttribute('aria-valuenow', '43')
    expect(progressbar).toHaveClass(
      'relative',
      'h-2',
      'w-full',
      'overflow-hidden',
      'rounded-full',
      'bg-primary/20',
      'mt-1',
    )

    const indicator = progressbar.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).not.toBeNull()
    expect(indicator).toHaveClass('h-full', 'w-full', 'flex-1', 'bg-primary', 'transition-all')
  })

  it('clamps overflowed values so the progressbar stays within 0..100', () => {
    render(<Progress aria-label="Update download" value={140} />)

    const progressbar = screen.getByRole('progressbar', { name: 'Update download' })
    expect(progressbar).toHaveAttribute('aria-valuenow', '100')
    expect(progressbar.querySelector('[data-slot="progress-indicator"]')).toHaveStyle({
      transform: 'translateX(-0%)',
    })
  })

  it('clamps underflown values so the progressbar stays within 0..100', () => {
    render(<Progress aria-label="Update download" value={-20} />)

    const progressbar = screen.getByRole('progressbar', { name: 'Update download' })
    expect(progressbar).toHaveAttribute('aria-valuenow', '0')
    expect(progressbar.querySelector('[data-slot="progress-indicator"]')).toHaveStyle({
      transform: 'translateX(-100%)',
    })
  })
})
