// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceLauncherPage } from './WorkspaceLauncherPage'

afterEach(cleanup)

describe('WorkspaceLauncherPage layout', () => {
  it('keeps the empty recent-workspaces message near the top of the sidebar', () => {
    render(
      <WorkspaceLauncherPage
        launchState={{
          devOptions: { canSeedSampleData: false },
          recentWorkspaces: [],
          status: 'needs-workspace',
        }}
        onChooseCreateParentFolder={vi.fn(async () => null)}
        onCreateWorkspace={vi.fn()}
        onOpenFolder={vi.fn()}
        onOpenRecent={vi.fn()}
        onRemoveRecent={vi.fn()}
      />,
    )

    expect(screen.getByRole('complementary', { name: 'Recent workspaces' }))
      .toHaveClass('pt-14')
    expect(screen.getByText('No recent workspaces')).toBeInTheDocument()
  })
})
