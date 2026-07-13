import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScrollArea } from './scroll-area'

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

describe('ScrollArea', () => {
  it('renders a labeled viewport with the shared root and scrollbar slots', () => {
    const { container } = render(
      <ScrollArea aria-label="Scrollable results" type="always" className="h-24 w-24 custom-scroll-area">
        <div style={{ height: 200, width: 200 }}>Scrollable content</div>
      </ScrollArea>,
    )

    expect(screen.getByLabelText('Scrollable results')).toHaveAttribute('data-slot', 'scroll-area')
    expect(screen.getByLabelText('Scrollable results')).toHaveClass('relative', 'custom-scroll-area')
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toHaveClass(
      'focus-visible:ring-[3px]',
    )
    expect(container.querySelectorAll('[data-slot="scroll-area-scrollbar"]').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Scrollable content')).toBeInTheDocument()
  })
})
