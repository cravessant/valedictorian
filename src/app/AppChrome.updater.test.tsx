import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppTopbar } from './AppChrome'

afterEach(cleanup)

describe('AppChrome updater presentation', () => {
  it('renders fixed safe updater copy and keeps Retry actionable', () => {
    const onCheck = vi.fn()
    render(
      <TooltipProvider>
        <AppTopbar
          isFullScreen={false}
          sidebarCollapsed={false}
          title="Applications"
          updateState={{
            currentVersion: '0.1.0',
            message: 'feed://internal/provider-secret stack dump',
            status: 'error',
          }}
          onCheckForUpdates={onCheck}
          onToggleSidebar={() => undefined}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Update check failed')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(screen.queryByText(/feed:\/\//i)).not.toBeInTheDocument()
    expect(screen.queryByText(/provider-secret/i)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })
})
