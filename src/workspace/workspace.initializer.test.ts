import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAppSettings } from '../settings/app-settings'
import { initializeWorkspace } from './workspace.initializer'
import { resolveWorkspaceLayout } from './workspace.paths'

function createTempWorkspaceRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'job-app-workspace-'))
}

describe('workspace initializer', () => {
  it('creates the workspace manifest, app settings, database folder, and editable folders', () => {
    const rootPath = createTempWorkspaceRoot()

    const workspace = initializeWorkspace(rootPath, {
      createId: () => 'workspace-1',
      now: new Date('2026-06-08T12:00:00.000Z'),
    })
    const layout = resolveWorkspaceLayout(rootPath)

    expect(workspace).toMatchObject({
      id: 'workspace-1',
      name: path.basename(rootPath),
      rootPath,
      dataPath: layout.dataPath,
      appSettingsPath: layout.appSettingsPath,
      sqlitePath: layout.sqlitePath,
    })
    expect(JSON.parse(fs.readFileSync(layout.manifestPath, 'utf8'))).toEqual({
      app: 'job-automation',
      workspaceVersion: 1,
      id: 'workspace-1',
      name: path.basename(rootPath),
      createdAt: '2026-06-08T12:00:00.000Z',
      updatedAt: '2026-06-08T12:00:00.000Z',
    })
    expect(JSON.parse(fs.readFileSync(layout.appSettingsPath, 'utf8'))).toEqual(
      defaultAppSettings,
    )
    expect(fs.existsSync(layout.automationsPath)).toBe(true)
    expect(fs.existsSync(layout.promptsPath)).toBe(true)
    expect(fs.existsSync(layout.templatesPath)).toBe(true)
    expect(fs.existsSync(layout.notesPath)).toBe(true)
  })

  it('keeps existing workspace app settings when initializing an existing folder', () => {
    const rootPath = createTempWorkspaceRoot()
    const layout = resolveWorkspaceLayout(rootPath)

    fs.mkdirSync(layout.dataPath, { recursive: true })
    fs.writeFileSync(
      layout.appSettingsPath,
      `${JSON.stringify({ ...defaultAppSettings, sidebarCollapsed: true }, null, 2)}\n`,
      'utf8',
    )

    initializeWorkspace(rootPath, {
      createId: () => 'workspace-2',
      now: new Date('2026-06-08T12:00:00.000Z'),
    })

    expect(JSON.parse(fs.readFileSync(layout.appSettingsPath, 'utf8'))).toMatchObject({
      sidebarCollapsed: true,
    })
  })
})
