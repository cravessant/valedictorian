import { describe, expect, it } from 'vitest'
import { createMemoryProfileStores } from './profile.memory.store'
import { createProfileService } from './profile.service'
import { computeProfileRevision } from './profile.revision'

describe('ProfileService', () => {
  it('normalizes updates, projects agent context, and excludes SSN', async () => {
    const stores = createMemoryProfileStores()
    const service = createProfileService(stores)

    const profile = await service.update({
      answers: [
        {
          answer: 'LinkedIn',
          category: 'source',
          includeInAgentContext: true,
          key: 'how heard',
          label: 'How I heard about the role',
          questionPattern: 'How did you hear about us?',
        },
        {
          answer: 'Private answer.',
          includeInAgentContext: false,
          key: 'private',
          label: 'Private',
          questionPattern: 'Sensitive question',
        },
      ],
      dateOfBirth: '2004-03-16',
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
      gender: 'Man',
      raceEthnicity: 'Asian',
      veteranStatus: 'Not a protected veteran',
    })

    expect(profile.dateOfBirth).toBe('2004-03-16')
    expect(profile.answers[0]?.key).toBe('how_heard')
    expect(JSON.stringify(profile)).not.toContain('ssn')
    expect(JSON.stringify(profile)).not.toContain('5125')

    await service.updateSensitiveDetails({ ssnLast4: '5125' })
    const afterSsn = await service.get()
    expect(JSON.stringify(afterSsn)).not.toContain('5125')
    expect(afterSsn.dateOfBirth).toBe('2004-03-16')

    await expect(service.getAgentContext()).resolves.toMatchObject({
      answers: [expect.objectContaining({ key: 'how_heard', includeInAgentContext: true })],
      basics: expect.objectContaining({
        dateOfBirth: '2004-03-16',
        email: 'kenny@example.com',
        gender: 'Man',
      }),
    })
    expect(JSON.stringify(await service.getAgentContext())).not.toContain('5125')
  })

  it('rejects invalid dates and keeps content-derived revisions stable across SSN-only changes', async () => {
    const stores = createMemoryProfileStores()
    const service = createProfileService(stores)

    await expect(service.update({ dateOfBirth: '2024-02-30' })).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })

    const first = await service.update({
      dateOfBirth: '2004-03-16',
      email: 'kenny@example.com',
      gender: 'Man',
    })
    const document = await service.getDocument()
    expect(document.revision).toBe(computeProfileRevision(first))
    expect(document.schemaVersion).toBe(1)

    const beforeSsn = document.revision
    await service.updateSensitiveDetails({ ssnLast4: '5125' })
    expect((await service.getDocument()).revision).toBe(beforeSsn)

    await service.updateSensitiveDetails({
      birthDay: '17',
      birthMonth: '03',
      birthYear: '2004',
      gender: 'Woman',
    })
    const afterMoved = await service.getDocument()
    expect(afterMoved.revision).not.toBe(beforeSsn)
    expect(afterMoved.profile.dateOfBirth).toBe('2004-03-17')
    expect(afterMoved.profile.gender).toBe('Woman')
  })

  it('enforces document revision conflicts, validates, no-ops format, and fails restore closed', async () => {
    const stores = createMemoryProfileStores()
    const service = createProfileService(stores)

    const created = await service.update({ email: 'kenny@example.com' })
    const document = await service.getDocument()
    expect(document.profile.email).toBe(created.email)

    await expect(
      service.updateDocument({
        expectedRevision: 'stale-revision',
        profile: { fullName: 'Other' },
      }),
    ).rejects.toMatchObject({ code: 'profile_revision_conflict' })

    const updated = await service.updateDocument({
      expectedRevision: document.revision,
      profile: { fullName: 'Kenny Lin' },
    })
    expect(updated.profile.fullName).toBe('Kenny Lin')
    expect(updated.revision).not.toBe(document.revision)

    await expect(service.validateDocument()).resolves.toEqual({
      revision: updated.revision,
      schemaVersion: 1,
    })
    await expect(
      service.formatDocument({ expectedRevision: updated.revision }),
    ).resolves.toEqual(updated)
    await expect(
      service.formatDocument({ expectedRevision: document.revision }),
    ).rejects.toMatchObject({ code: 'profile_revision_conflict' })
    await expect(service.restoreDocument({ expectedRevision: null })).rejects.toMatchObject({
      code: 'profile_backup_unavailable',
      body: {
        code: 'profile_backup_unavailable',
        message: 'The profile document backup is unavailable.',
      },
    })
  })

  it('validates format/restore inputs with shared schemas before outcome mapping', async () => {
    const stores = createMemoryProfileStores()
    const service = createProfileService(stores)
    const document = await service.getDocument()

    await expect(service.formatDocument({ expectedRevision: '' })).rejects.toMatchObject({
      code: 'invalid_profile_document',
      body: expect.objectContaining({
        code: 'invalid_profile_document',
        path: ['expectedRevision'],
      }),
    })
    await expect(
      service.formatDocument({ expectedRevision: document.revision, unexpected: true } as never),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    await expect(service.restoreDocument({} as never)).rejects.toMatchObject({
      code: 'invalid_profile_document',
      body: expect.objectContaining({
        code: 'invalid_profile_document',
        path: ['expectedRevision'],
      }),
    })
    await expect(
      service.restoreDocument({ expectedRevision: null, unexpected: true } as never),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    await expect(service.restoreDocument({ expectedRevision: null })).rejects.toMatchObject({
      code: 'profile_backup_unavailable',
    })
  })

  it('maps answer/education normalizer failures to canonical invalid_profile_document paths', async () => {
    const stores = createMemoryProfileStores()
    const service = createProfileService(stores)

    await expect(
      service.update({
        answers: [{ answer: 'x', questionPattern: 'q' }],
      }),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
      body: expect.objectContaining({
        code: 'invalid_profile_document',
        path: ['answers', 0, 'label'],
        message: 'The profile document is invalid.',
      }),
    })

    const document = await service.getDocument()
    await expect(
      service.updateDocument({
        expectedRevision: document.revision,
        profile: {
          education: [{ school: 'CU' }],
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
      body: expect.objectContaining({
        code: 'invalid_profile_document',
        path: ['profile', 'education', 0, 'educationType'],
        message: 'The profile document is invalid.',
      }),
    })
  })

  it('rejects malformed store documents on reads and mutations without writing', async () => {
    const stores = createMemoryProfileStores()
    let updateCalls = 0
    const hostileStore = {
      async get() {
        return {
          profile: {
            ...(await stores.profileStore.get()).profile,
            dateOfBirth: '2024-02-30',
          },
          revision: 'hostile-revision',
          schemaVersion: 1,
        } as Awaited<ReturnType<typeof stores.profileStore.get>>
      },
      async update(input: Parameters<typeof stores.profileStore.update>[0]) {
        updateCalls += 1
        return stores.profileStore.update(input)
      },
    }
    const service = createProfileService({
      profileStore: hostileStore,
      sensitiveStore: stores.sensitiveStore,
    })

    await expect(service.get()).rejects.toMatchObject({
      code: 'invalid_profile_document',
      body: expect.objectContaining({
        code: 'invalid_profile_document',
        message: 'The profile document is invalid.',
      }),
    })
    await expect(service.getAgentContext()).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    await expect(service.update({ email: 'kenny@example.com' })).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    await expect(
      service.updateDocument({
        expectedRevision: 'hostile-revision',
        profile: { email: 'kenny@example.com' },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    await expect(
      service.formatDocument({ expectedRevision: 'hostile-revision' }),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    expect(updateCalls).toBe(0)
  })

  it('rejects unsupported schema versions before writes with the canonical outcome', async () => {
    const stores = createMemoryProfileStores()
    let updateCalls = 0
    const base = await stores.profileStore.get()
    const hostileStore = {
      async get() {
        return {
          ...base,
          schemaVersion: 2,
        } as Awaited<ReturnType<typeof stores.profileStore.get>>
      },
      async update(input: Parameters<typeof stores.profileStore.update>[0]) {
        updateCalls += 1
        return stores.profileStore.update(input)
      },
    }
    const service = createProfileService({
      profileStore: hostileStore,
      sensitiveStore: stores.sensitiveStore,
    })

    await expect(service.get()).rejects.toMatchObject({
      code: 'unsupported_profile_schema_version',
      statusCode: 409,
      body: {
        code: 'unsupported_profile_schema_version',
        message: 'The profile document schema version is unsupported.',
      },
    })
    await expect(service.getDocument()).rejects.toMatchObject({
      code: 'unsupported_profile_schema_version',
    })
    await expect(service.validateDocument()).rejects.toMatchObject({
      code: 'unsupported_profile_schema_version',
    })
    await expect(service.update({ email: 'kenny@example.com' })).rejects.toMatchObject({
      code: 'unsupported_profile_schema_version',
    })
    await expect(
      service.updateDocument({
        expectedRevision: base.revision,
        profile: { email: 'kenny@example.com' },
      }),
    ).rejects.toMatchObject({
      code: 'unsupported_profile_schema_version',
    })
    await expect(
      service.formatDocument({ expectedRevision: base.revision }),
    ).rejects.toMatchObject({
      code: 'unsupported_profile_schema_version',
    })
    expect(updateCalls).toBe(0)
  })

  it('passes only explicitly changed moved sensitive fields to the profile store', async () => {
    const stores = createMemoryProfileStores()
    const seen: Array<unknown> = []
    const recordingStore = {
      get: () => stores.profileStore.get(),
      async update(input: Parameters<typeof stores.profileStore.update>[0]) {
        seen.push(input.movedSensitiveChanges ?? {})
        return stores.profileStore.update(input)
      },
    }
    const service = createProfileService({
      profileStore: recordingStore,
      sensitiveStore: stores.sensitiveStore,
    })

    await service.update({ email: 'kenny@example.com' })
    expect(seen.at(-1)).toEqual({})

    await service.update({ gender: 'Man', raceEthnicity: 'Asian' })
    expect(seen.at(-1)).toEqual({
      gender: 'Man',
      raceEthnicity: 'Asian',
    })

    const document = await service.getDocument()
    await service.updateDocument({
      expectedRevision: document.revision,
      profile: { email: 'next@example.com' },
    })
    expect(seen.at(-1)).toEqual({})
  })

  it('normalizes sensitive compatibility patches in policy before the store and rejects impossible dates', async () => {
    const saved: Array<Record<string, unknown>> = []
    const stores = createMemoryProfileStores()
    const recordingStore = {
      get: () => stores.sensitiveStore.get(),
      async update(details: Awaited<ReturnType<typeof stores.sensitiveStore.get>>) {
        saved.push({ ...details })
        return stores.sensitiveStore.update(details)
      },
    }
    const service = createProfileService({
      profileStore: stores.profileStore,
      sensitiveStore: recordingStore,
    })

    await service.updateSensitiveDetails({
      birthDay: '6',
      birthMonth: '3',
      birthYear: ' 2004 ',
      gender: ' Male ',
      ssnLast4: ' 5125 ',
    })
    expect(saved.at(-1)).toEqual({
      birthDay: '06',
      birthMonth: '03',
      birthYear: '2004',
      disabilityStatus: null,
      gender: 'Male',
      hispanicLatino: null,
      raceEthnicity: null,
      ssnLast4: '5125',
      veteranStatus: null,
    })

    await expect(
      service.updateSensitiveDetails({ dateOfBirth: '2024-02-30' }),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
      body: expect.objectContaining({
        code: 'invalid_profile_document',
        path: ['dateOfBirth'],
      }),
    })
    expect(JSON.stringify(saved.at(-1))).not.toContain('2024-02-30')

    await expect(
      service.updateSensitiveDetails({
        birthDay: '30',
        birthMonth: '02',
        birthYear: '2024',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_profile_document',
      body: expect.objectContaining({
        code: 'invalid_profile_document',
        path: ['dateOfBirth'],
      }),
    })
  })
})
