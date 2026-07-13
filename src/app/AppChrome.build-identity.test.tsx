import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppTopbar } from './AppChrome'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('validation build identity', () => {
  it('visibly distinguishes a validation branch and build', () => {
    vi.stubEnv('VITE_VALEDICTORIAN_BUILD_IDENTITY', 'validation fix/issue-177@abc1234')

    render(
      <TooltipProvider>
        <AppTopbar
          isFullScreen={false}
          sidebarCollapsed={false}
          title="Applications"
          onToggleSidebar={() => undefined}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('validation fix/issue-177@abc1234')).toBeVisible()
  })
})
