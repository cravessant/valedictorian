import { describe, expect, it } from 'vitest'
import type { ProfileRepository } from '../modules/profile/profile.repository'
import { registerProfileIpc } from './profile.ipc'

describe('profile IPC registration', () => {
  it('registers profile and secret handlers against the repository', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
    const repository: ProfileRepository = {
      async deleteSecret() {},
      async getAgentContext() {
        return { answers: [], basics: { fullName: 'Kenny Lin' } }
      },
      async getProfile() {
        return {
          addressLine1: null,
          addressLine2: null,
          answers: [],
          city: null,
          country: null,
          citizenship: null,
          classStanding: null,
          coverLetterPath: null,
          degree: null,
          email: null,
          fullName: 'Kenny Lin',
          githubUrl: null,
          graduationDate: null,
          highSchool: null,
          language: null,
          linkedinUrl: null,
          major: null,
          phone: null,
          phoneDeviceType: null,
          portfolioUrl: null,
          preferredName: null,
          region: null,
          relocation: null,
          requireSponsorship: null,
          requireSponsorshipFuture: null,
          satScore: null,
          school: null,
          transcriptPath: null,
          travel: null,
          workAuthorization: null,
        }
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
      async listSecrets() {
        return [{ key: 'greenhouse_password', kind: 'password', label: 'Greenhouse', updatedAt: 'now' }]
      },
      async revealSecret() {
        return {
          key: 'greenhouse_password',
          kind: 'password',
          label: 'Greenhouse',
          updatedAt: 'now',
          value: 'secret',
        }
      },
      async updateProfile(input) {
        return {
          addressLine1: null,
          addressLine2: null,
          answers: [],
          city: null,
          country: null,
          citizenship: null,
          classStanding: null,
          coverLetterPath: null,
          degree: null,
          email: null,
          fullName: input.fullName ?? null,
          githubUrl: null,
          graduationDate: null,
          highSchool: null,
          language: null,
          linkedinUrl: null,
          major: null,
          phone: null,
          phoneDeviceType: null,
          portfolioUrl: null,
          preferredName: null,
          region: null,
          relocation: null,
          requireSponsorship: null,
          requireSponsorshipFuture: null,
          satScore: null,
          school: null,
          transcriptPath: null,
          travel: null,
          workAuthorization: null,
        }
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
      async upsertSecret(input) {
        return { key: input.key, kind: input.kind, label: input.label, updatedAt: 'now' }
      },
    }

    registerProfileIpc(repository, {
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
    await expect(
      handlers.get('profile:secrets:delete')?.({}, 'greenhouse_password'),
    ).resolves.toBeUndefined()
  })
})
