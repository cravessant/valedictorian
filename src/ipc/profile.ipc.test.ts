import { describe, expect, it } from 'vitest'
import { defaultUserProfile } from '@sparxie/sdk'
import type { ProfileService } from '@sparxie/valedictorian-local-runtime/profile'
import type { SecretService } from '@sparxie/valedictorian-local-runtime/secrets'
import { registerProfileIpc } from './profile.ipc'

describe('profile IPC registration', () => {
  it('registers profile and secret handlers against owned services', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
    const profileService: ProfileService = {
      dispose() {},
      getLastKnownGoodPreview() {
        return null
      },
      subscribe() {
        return () => undefined
      },
      async formatDocument() {
        throw new Error('unused')
      },
      async get() {
        return { ...defaultUserProfile, fullName: 'Kenny Lin' }
      },
      async getAgentContext() {
        return { answers: [], basics: { fullName: 'Kenny Lin' }, education: [] }
      },
      async getDocument() {
        throw new Error('unused')
      },
      async restoreDocument() {
        throw new Error('unused')
      },
      async update(input) {
        return { ...defaultUserProfile, fullName: input.fullName ?? null }
      },
      async updateDocument() {
        throw new Error('unused')
      },
      async validateDocument() {
        throw new Error('unused')
      },
    }
    let identitySetCalls = 0
    const secretService: SecretService = {
      async delete() {},
      async hasTrustedIdentitySsnLast4() {
        return true
      },
      async list() {
        return [{ key: 'greenhouse_password', kind: 'password', label: 'Greenhouse', updatedAt: 'now' }]
      },
      async listResult() {
        return { items: await this.list() }
      },
      async resolve() {
        return null
      },
      async upsert(input) {
        return { key: input.key, kind: input.kind, label: input.label, updatedAt: 'now' }
      },
      async upsertTrustedIdentitySsnLast4() {
        identitySetCalls += 1
      },
      scope: { workspaceId: 'ipc-workspace' } as never,
    }

    registerProfileIpc(profileService, secretService, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('profile:get')?.({}, undefined)).resolves.toMatchObject({
      fullName: 'Kenny Lin',
    })
    await expect(
      handlers.get('profile:update')?.({}, { fullName: 'Kenny Lin' }),
    ).resolves.toMatchObject({ fullName: 'Kenny Lin' })
    await expect(handlers.get('profile:agent-context:get')?.({}, undefined)).resolves.toMatchObject({
      basics: { fullName: 'Kenny Lin' },
    })
    expect(handlers.has('profile:sensitive:get')).toBe(false)
    expect(handlers.has('profile:sensitive:update')).toBe(false)
    await expect(handlers.get('profile:identity:status')?.({}, undefined)).resolves.toBe(true)
    await expect(handlers.get('profile:identity:set')?.({}, '0000')).resolves.toBeUndefined()
    expect(identitySetCalls).toBe(1)
    await expect(handlers.get('profile:secrets:list')?.({}, undefined)).resolves.toHaveLength(1)
    await expect(
      handlers.get('profile:secrets:upsert')?.(
        {},
        { key: 'greenhouse_password', kind: 'password', label: 'Greenhouse', value: 'secret' },
      ),
    ).resolves.toMatchObject({ key: 'greenhouse_password' })
    expect(handlers.has('profile:secrets:reveal')).toBe(false)
    expect(handlers.has('secrets:local:resolve')).toBe(false)
    await expect(
      handlers.get('profile:secrets:delete')?.({}, 'greenhouse_password'),
    ).resolves.toBeUndefined()
  })
})
