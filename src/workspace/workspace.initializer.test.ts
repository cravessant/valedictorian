import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAppSettings } from '../settings/app-settings'
import { initializeWorkspace } from './workspace.initializer'
import { resolveWorkspaceLayout } from './workspace.paths'

function createTempWorkspaceRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-workspace-'))
}

describe('workspace initializer', () => {
  it('creates workspace metadata and editable folders while deferring local persistence', () => {
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
      pgliteDataPath: layout.pgliteDataPath,
    })
    expect(JSON.parse(fs.readFileSync(layout.manifestPath, 'utf8'))).toEqual({
      app: 'valedictorian',
      workspaceVersion: 1,
      id: 'workspace-1',
      name: path.basename(rootPath),
      createdAt: '2026-06-08T12:00:00.000Z',
      updatedAt: '2026-06-08T12:00:00.000Z',
    })
    expect(JSON.parse(fs.readFileSync(layout.appSettingsPath, 'utf8'))).toEqual(
      defaultAppSettings,
    )
    expect(fs.existsSync(layout.pgliteDataPath)).toBe(false)
    expect(fs.existsSync(layout.automationsPath)).toBe(true)
    expect(fs.existsSync(layout.promptsPath)).toBe(true)
    expect(fs.existsSync(layout.templatesPath)).toBe(true)
    expect(fs.existsSync(layout.notesPath)).toBe(true)
    expect(fs.existsSync(layout.profilePath)).toBe(false)
  })

  it('uses discovered project config when naming a new workspace manifest', () => {
    const rootPath = createTempWorkspaceRoot()

    fs.writeFileSync(
      path.join(rootPath, 'valedictorian.config.json'),
      JSON.stringify({ version: 1, workspace: { name: '  Summer Search  ' } }),
      'utf8',
    )

    const workspace = initializeWorkspace(rootPath, {
      createId: () => 'workspace-configured',
      now: new Date('2026-06-08T12:00:00.000Z'),
    })
    const layout = resolveWorkspaceLayout(rootPath)

    expect(workspace).toMatchObject({
      id: 'workspace-configured',
      name: 'Summer Search',
    })
    expect(JSON.parse(fs.readFileSync(layout.manifestPath, 'utf8'))).toMatchObject({
      id: 'workspace-configured',
      name: 'Summer Search',
    })
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
