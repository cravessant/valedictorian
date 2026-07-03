import { describe, expect, it } from 'vitest'
import { createWorkspaceWindowTitle } from './workspace.window'

describe('workspace window identity', () => {
  it('uses the workspace display name for the main window title without exposing the canonical id', () => {
    const title = createWorkspaceWindowTitle({
      id: 'workspace-canonical-id',
      name: 'Job Search',
    })

    expect(title).toBe('Job Search - Valedictorian')
    expect(title).not.toContain('workspace-canonical-id')
  })
})
