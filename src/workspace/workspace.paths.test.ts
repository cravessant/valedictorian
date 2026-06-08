import { describe, expect, it } from 'vitest'
import {
  getDefaultWorkspaceRegistryPath,
  resolveWorkspaceLayout,
} from './workspace.paths'

describe('workspace paths', () => {
  it('resolves the Obsidian-style workspace data layout from a selected folder', () => {
    expect(resolveWorkspaceLayout('/Users/keni/Job Search')).toEqual({
      rootPath: '/Users/keni/Job Search',
      dataPath: '/Users/keni/Job Search/.job-automation',
      manifestPath: '/Users/keni/Job Search/.job-automation/manifest.json',
      appSettingsPath: '/Users/keni/Job Search/.job-automation/app.json',
      sqlitePath: '/Users/keni/Job Search/.job-automation/job-app.sqlite',
      automationsPath: '/Users/keni/Job Search/.job-automation/automations',
      promptsPath: '/Users/keni/Job Search/.job-automation/prompts',
      templatesPath: '/Users/keni/Job Search/.job-automation/templates',
      notesPath: '/Users/keni/Job Search/.job-automation/notes',
    })
  })

  it('uses the app-data folder for the recent workspace registry', () => {
    expect(
      getDefaultWorkspaceRegistryPath('/Users/keni/Library/Application Support/Job App'),
    ).toBe('/Users/keni/Library/Application Support/Job App/workspaces.json')
  })
})
