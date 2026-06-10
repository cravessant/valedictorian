import { describe, expect, it } from 'vitest'
import {
  getDefaultWorkspaceRegistryPath,
  resolveWorkspaceLayout,
} from './workspace.paths'

describe('workspace paths', () => {
  it('resolves the Obsidian-style workspace data layout from a selected folder', () => {
    expect(resolveWorkspaceLayout('/Users/keni/Job Search')).toEqual({
      rootPath: '/Users/keni/Job Search',
      dataPath: '/Users/keni/Job Search/.valedictorian',
      manifestPath: '/Users/keni/Job Search/.valedictorian/manifest.json',
      appSettingsPath: '/Users/keni/Job Search/.valedictorian/app.json',
      sqlitePath: '/Users/keni/Job Search/.valedictorian/valedictorian.sqlite',
      automationsPath: '/Users/keni/Job Search/.valedictorian/automations',
      promptsPath: '/Users/keni/Job Search/.valedictorian/prompts',
      templatesPath: '/Users/keni/Job Search/.valedictorian/templates',
      notesPath: '/Users/keni/Job Search/.valedictorian/notes',
    })
  })

  it('uses the app-data folder for the recent workspace registry', () => {
    expect(
      getDefaultWorkspaceRegistryPath('/Users/keni/Library/Application Support/Valedictorian'),
    ).toBe('/Users/keni/Library/Application Support/Valedictorian/workspaces.json')
  })
})
