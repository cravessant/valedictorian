import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileWorkspaceRegistryStore } from './workspace.registry.js'

function createTempRegistryPath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-workspaces-')),
    'workspaces.json',
  )
}

describe('file workspace registry store', () => {
  it('loads an empty registry when the file does not exist', async () => {
    const store = createFileWorkspaceRegistryStore(createTempRegistryPath())

    await expect(store.get()).resolves.toEqual({
      lastOpenedWorkspaceId: null,
      workspaces: {},
    })
    await expect(store.listRecent()).resolves.toEqual([])
  })

  it('falls back to an empty registry when the file is invalid JSON', async () => {
    const registryPath = createTempRegistryPath()
    fs.mkdirSync(path.dirname(registryPath), { recursive: true })
    fs.writeFileSync(registryPath, '{nope', 'utf8')

    await expect(createFileWorkspaceRegistryStore(registryPath).get()).resolves.toEqual({
      lastOpenedWorkspaceId: null,
      workspaces: {},
    })
  })

  it('marks one workspace open and orders recent workspaces by last opened time', async () => {
    const registryPath = createTempRegistryPath()
    const store = createFileWorkspaceRegistryStore(registryPath)

    await store.markOpened(
      {
        id: 'workspace-old',
        name: 'Old Search',
        path: '/Users/keni/Old Search',
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )
    await store.markOpened(
      {
        id: 'workspace-new',
        name: 'New Search',
        path: '/Users/keni/New Search',
      },
      new Date('2026-06-08T10:00:00.000Z'),
    )

    await expect(store.get()).resolves.toEqual({
      lastOpenedWorkspaceId: 'workspace-new',
      workspaces: {
        'workspace-new': {
          id: 'workspace-new',
          name: 'New Search',
          path: '/Users/keni/New Search',
          lastOpenedAt: '2026-06-08T10:00:00.000Z',
          latestError: null,
          open: true,
        },
        'workspace-old': {
          id: 'workspace-old',
          name: 'Old Search',
          path: '/Users/keni/Old Search',
          lastOpenedAt: '2026-06-01T10:00:00.000Z',
          latestError: null,
          open: false,
        },
      },
    })
    await expect(store.listRecent()).resolves.toMatchObject([
      { id: 'workspace-new' },
      { id: 'workspace-old' },
    ])
  })

  it('stores and clears the latest workspace error', async () => {
    const registryPath = createTempRegistryPath()
    const store = createFileWorkspaceRegistryStore(registryPath)
    await store.markOpened(
      {
        id: 'workspace-error',
        name: 'Error Search',
        path: '/Users/keni/Error Search',
      },
      new Date('2026-06-08T10:00:00.000Z'),
    )

    await store.recordError(
      'workspace-error',
      'Workspace path does not exist: /Users/keni/Error Search',
      new Date('2026-06-08T10:05:00.000Z'),
    )

    await expect(store.get()).resolves.toMatchObject({
      workspaces: {
        'workspace-error': {
          latestError: {
            at: '2026-06-08T10:05:00.000Z',
            message: 'Workspace path does not exist: /Users/keni/Error Search',
          },
        },
      },
    })

    await store.clearError('workspace-error')

    await expect(store.get()).resolves.toMatchObject({
      workspaces: {
        'workspace-error': {
          latestError: null,
        },
      },
    })
  })
})
