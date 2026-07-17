import { describe, expect, it } from 'vitest'
import { defaultUserProfile } from 'sparxie'
import type { ProfileService } from '../modules/profile/profile.service'
import type { SecretService } from '../modules/secrets/secret.service'
import { registerProfileIpc } from './profile.ipc'

describe('profile IPC registration', () => {
  it('registers profile and secret handlers against owned services', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
    const profileService: ProfileService = {
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
      async getSensitiveDetails() {
        return {
          birthDay: '16',
          birthMonth: '03',
          birthYear: '2004',
          disabilityStatus: null,
          gender: null,
          hispanicLatino: null,
          raceEthnicity: null,
          ssnLast4: '5125',
          veteranStatus: null,
        }
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
      async updateSensitiveDetails(input) {
        return {
          birthDay: input.birthDay ?? null,
          birthMonth: input.birthMonth ?? null,
          birthYear: input.birthYear ?? null,
          disabilityStatus: null,
          gender: null,
          hispanicLatino: null,
          raceEthnicity: null,
          ssnLast4: input.ssnLast4 ?? null,
          veteranStatus: null,
        }
      },
      async validateDocument() {
        throw new Error('unused')
      },
    }
    const secretService: SecretService = {
      async delete() {},
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
    await expect(handlers.get('profile:sensitive:get')?.({}, undefined)).resolves.toMatchObject({
      birthDay: '16',
      birthMonth: '03',
      birthYear: '2004',
      ssnLast4: '5125',
    })
    await expect(
      handlers.get('profile:sensitive:update')?.(
        {},
        { birthDay: '16', birthMonth: '03', birthYear: '2004', ssnLast4: '5125' },
      ),
    ).resolves.toMatchObject({
      birthDay: '16',
      birthMonth: '03',
      birthYear: '2004',
      ssnLast4: '5125',
    })
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
