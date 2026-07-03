import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceFolderPicker } from './workspace.dialog'

describe('workspace folder dialog', () => {
  it('uses a parent window when showing a workspace folder picker', async () => {
    const parentWindow = { id: 1 }
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['/Users/keni/Job Search'],
    }))
    const chooseWorkspaceRoot = createWorkspaceFolderPicker({
      buttonLabel: 'Open workspace',
      showOpenDialog,
      title: 'Choose Valedictorian workspace',
    })

    await expect(chooseWorkspaceRoot({ parentWindow })).resolves.toBe('/Users/keni/Job Search')

    expect(showOpenDialog).toHaveBeenCalledWith(parentWindow, {
      buttonLabel: 'Open workspace',
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Valedictorian workspace',
    })
  })

  it('uses the unparented folder picker when no parent window is available', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['/Users/keni/Job Search'],
    }))
    const chooseWorkspaceRoot = createWorkspaceFolderPicker({
      buttonLabel: 'Open workspace',
      showOpenDialog,
      title: 'Choose Valedictorian workspace',
    })

    await expect(chooseWorkspaceRoot({ parentWindow: null })).resolves.toBe(
      '/Users/keni/Job Search',
    )

    expect(showOpenDialog).toHaveBeenCalledWith({
      buttonLabel: 'Open workspace',
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Valedictorian workspace',
    })
  })
})
