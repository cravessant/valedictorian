import { describe, expect, it } from 'vitest'
import { createPgliteTestDatabase, createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createApplicationFileSecretStore } from '../../settings/app-secret.composition'
import {
  createApplicationSecretScope,
  createWorkspaceSecretScope,
} from './secret.scope'
import type { SecretCodec } from './secret.codec'
import { createPgliteSecretService } from './secret.composition'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const testCodec: SecretCodec = {
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    return `enc:${value}`
  },
}

async function createWorkspaceService(workspaceId: string) {
  const owner = await createPgliteTestOwner()
  return {
    service: createPgliteSecretService(
      owner.database,
      testCodec,
      createWorkspaceSecretScope(workspaceId),
    ),
    async cleanup() {
      await owner.close()
    },
  }
}

describe('secret scopes', () => {
  it('creates immutable application and workspace scopes', () => {
    const application = createApplicationSecretScope()
    const workspace = createWorkspaceSecretScope('ws-a')

    expect(application).toEqual({ domain: 'application' })
    expect(workspace).toEqual({ domain: 'workspace', workspaceId: 'ws-a' })
    expect(Object.isFrozen(application)).toBe(true)
    expect(Object.isFrozen(workspace)).toBe(true)
    expect(() => {
      ;(application as { domain: string }).domain = 'workspace'
    }).toThrow()
    expect(() => {
      ;(workspace as { workspaceId: string }).workspaceId = 'ws-b'
    }).toThrow()
  })

  it('rejects empty workspace ids', () => {
    expect(() => createWorkspaceSecretScope('')).toThrow('workspaceId is required')
  })

  it('binds application and workspace stores to construction scopes through composition', async () => {
    const applicationScope = createApplicationSecretScope()
    const workspaceScope = createWorkspaceSecretScope('ws-a')
    const secretsPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-app-secrets-')),
      'secrets.json',
    )
    const database = await createPgliteTestDatabase()
    const appStore = createApplicationFileSecretStore(secretsPath, testCodec)
    const service = createPgliteSecretService(database, testCodec, workspaceScope)

    expect(appStore.scope).toEqual(applicationScope)
    expect(service.scope).toEqual(workspaceScope)
    expect(appStore.scope.domain).toBe('application')
  })

  it('isolates two workspace-scoped secret services', async () => {
    const fixtureA = await createWorkspaceService('workspace-a')
    const fixtureB = await createWorkspaceService('workspace-b')
    try {
      const { service: serviceA } = fixtureA
      const { service: serviceB } = fixtureB

      await serviceA.upsert({
        key: 'shared_key',
        kind: 'token',
        label: 'Shared',
        value: 'token-a',
      })
      await serviceB.upsert({
        key: 'shared_key',
        kind: 'token',
        label: 'Shared',
        value: 'token-b',
      })

      expect(serviceA.scope).toEqual({ domain: 'workspace', workspaceId: 'workspace-a' })
      expect(serviceB.scope).toEqual({ domain: 'workspace', workspaceId: 'workspace-b' })
      await expect(serviceA.resolve('shared_key')).resolves.toMatchObject({ value: 'token-a' })
      await expect(serviceB.resolve('shared_key')).resolves.toMatchObject({ value: 'token-b' })
      expect(serviceA.scope).not.toEqual(serviceB.scope)
    } finally {
      await fixtureA.cleanup()
      await fixtureB.cleanup()
    }
  })

  it('does not accept a scope selector on service operations', async () => {
    const fixture = await createWorkspaceService('ws-a')
    const { service } = fixture
    try {
      await service.upsert({
        key: 'api_token',
        kind: 'token',
        label: 'API token',
        value: 'tok',
      })

      expect(service.upsert.length).toBe(1)
      expect(service.resolve.length).toBe(1)
      expect(service.delete.length).toBe(1)
      expect(service.list.length).toBe(0)
    } finally {
      await fixture.cleanup()
    }
  })
})
