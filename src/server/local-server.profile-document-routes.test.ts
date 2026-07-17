import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createDrizzleDatabase,
  createFileDatabase,
} from '../db/sqlite'
import { createMemoryProfileStores } from '../modules/profile/profile.memory.store'
import { createJsonProfileService } from '../modules/profile/profile.composition'
import { createProfileService } from '../modules/profile/profile.service'
import { createWorkspaceProfileMethods } from '../runtime/local-profile-secret-client'
import { createConnectorSecretResolver } from '../modules/secrets/connector-secret-resolver'
import { createSqliteSecretService } from '../modules/secrets/secret.composition'
import {
  createBoundaryWorkspaceClient,
  createSeededLocalClient as createLocalValedictorianClient,
  createTempSqlitePath,
  readJson,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'

const testCodec = {
  decrypt(value: string) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value: string) {
    return `enc:${value}`
  },
}

describe('local server profile document routes', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  async function startWorkspaceServer() {
    const sqlitePath = createTempSqlitePath()
    const client = createLocalValedictorianClient({
      secretCodec: testCodec,
      sqlitePath,
      workspaceId: 'workspace-profile',
    })
    const server = await fixture.start({
      client,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => client,
    })
    return { client, server, sqlitePath }
  }

  function trustedReveal(sqlitePath: string) {
    const database = createDrizzleDatabase(createFileDatabase(sqlitePath))
    return createConnectorSecretResolver(createSqliteSecretService(database, testCodec))
  }

  it('serves workspace-scoped document verbs and keeps unscoped/domain resolve closed', async () => {
    const { server } = await startWorkspaceServer()
    const base = `${server.url}/v1/workspaces/workspace-profile`

    const getDocument = await fetch(`${base}/profile/document`)
    expect(getDocument.status).toBe(200)
    const document = (await readJson(getDocument)) as {
      revision: string
      schemaVersion: number
      profile: { email: string | null }
    }
    expect(document.schemaVersion).toBe(1)
    expect(document.revision).toEqual(expect.any(String))

    const updated = await fetch(`${base}/profile/document`, {
      body: JSON.stringify({
        expectedRevision: document.revision,
        profile: { email: 'kenny@example.com' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(updated.status).toBe(200)
    const nextDocument = (await readJson(updated)) as { revision: string; profile: { email: string } }
    expect(nextDocument.profile.email).toBe('kenny@example.com')
    expect(nextDocument.revision).not.toBe(document.revision)

    await expect(
      fetch(`${base}/profile/document/validate`, { method: 'POST' }).then(readJson),
    ).resolves.toEqual({
      revision: nextDocument.revision,
      schemaVersion: 1,
    })

    await expect(
      fetch(`${base}/profile/document/format`, {
        body: JSON.stringify({ expectedRevision: nextDocument.revision }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }).then(readJson),
    ).resolves.toMatchObject({
      revision: nextDocument.revision,
      profile: { email: 'kenny@example.com' },
    })

    const profile = await fetch(`${base}/profile`)
    expect(profile.status).toBe(200)
    await expect(readJson(profile)).resolves.toMatchObject({ email: 'kenny@example.com' })

    const sensitive = await fetch(`${base}/profile/sensitive`, {
      body: JSON.stringify({ ssnLast4: '5125', gender: 'Man' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    expect(sensitive.status).toBe(200)
    await expect(readJson(sensitive)).resolves.toMatchObject({ ssnLast4: '5125', gender: 'Man' })

    const secretUpsert = await fetch(`${base}/secrets/jobright`, {
      body: JSON.stringify({
        kind: 'password',
        label: 'Jobright',
        value: 'secret',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(secretUpsert.status).toBe(200)
    await expect(fetch(`${base}/secrets`).then(readJson)).resolves.toMatchObject({
      items: [expect.objectContaining({ key: 'jobright', label: 'Jobright' })],
    })

    expect((await fetch(`${server.url}/v1/profile/document`)).status).toBe(404)
    expect((await fetch(`${base}/secrets/local/resolve`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${server.url}/v1/secrets/local/resolve`, { method: 'POST' })).status).toBe(404)
  })

  it('round-trips opaque secret values including whitespace and empty string through HTTP upsert', async () => {
    const { server, sqlitePath } = await startWorkspaceServer()
    const base = `${server.url}/v1/workspaces/workspace-profile`
    const reveal = trustedReveal(sqlitePath)

    const spaced = await fetch(`${base}/secrets/spaced_password`, {
      body: JSON.stringify({
        kind: ' password ',
        label: ' Spaced password ',
        value: ' pass with spaces ',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(spaced.status).toBe(200)
    await expect(readJson(spaced)).resolves.toMatchObject({
      key: 'spaced_password',
      kind: 'password',
      label: 'Spaced password',
    })
    await expect(reveal.revealSecret('spaced_password')).resolves.toEqual({
      key: 'spaced_password',
      value: ' pass with spaces ',
    })

    const empty = await fetch(`${base}/secrets/empty_token`, {
      body: JSON.stringify({
        kind: 'token',
        label: 'Empty',
        value: '',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(empty.status).toBe(200)
    await expect(reveal.revealSecret('empty_token')).resolves.toEqual({
      key: 'empty_token',
      value: '',
    })

    const missingValue = await fetch(`${base}/secrets/broken`, {
      body: JSON.stringify({
        kind: 'token',
        label: 'Broken',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(missingValue.status).toBeGreaterThanOrEqual(400)

    const nonStringValue = await fetch(`${base}/secrets/broken`, {
      body: JSON.stringify({
        kind: 'token',
        label: 'Broken',
        value: 12,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(nonStringValue.status).toBeGreaterThanOrEqual(400)
  })

  it('returns canonical document invalid/conflict/backup-unavailable outcomes', async () => {
    const { server } = await startWorkspaceServer()
    const base = `${server.url}/v1/workspaces/workspace-profile`
    const current = (await fetch(`${base}/profile/document`).then(readJson)) as {
      revision: string
    }

    const invalid = await fetch(`${base}/profile/document`, {
      body: JSON.stringify({
        expectedRevision: current.revision,
        profile: { dateOfBirth: '2024-02-30' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(invalid.status).toBe(422)
    await expect(readJson(invalid)).resolves.toEqual({
      code: 'invalid_profile_document',
      message: 'The profile document is invalid.',
      path: ['profile', 'dateOfBirth'],
    })

    const conflict = await fetch(`${base}/profile/document`, {
      body: JSON.stringify({
        expectedRevision: 'stale-revision',
        profile: { email: 'other@example.com' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(conflict.status).toBe(409)
    await expect(readJson(conflict)).resolves.toEqual({
      code: 'profile_revision_conflict',
      message: 'The profile document revision does not match the expected revision.',
    })

    const restore = await fetch(`${base}/profile/document/restore`, {
      body: JSON.stringify({ expectedRevision: null }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(restore.status).toBe(404)
    await expect(readJson(restore)).resolves.toEqual({
      code: 'profile_backup_unavailable',
      message: 'The profile document backup is unavailable.',
    })
  })

  it('returns canonical unsupported schema version for hostile current documents', async () => {
    const stores = createMemoryProfileStores()
    const current = await stores.profileStore.get()
    let updateCalls = 0
    const service = createProfileService({
      profileStore: {
        async get() {
          return {
            ...current,
            schemaVersion: 2,
          } as typeof current
        },
        async update(input) {
          updateCalls += 1
          return stores.profileStore.update(input)
        },
      },
      sensitiveStore: stores.sensitiveStore,
    })
    const client = createBoundaryWorkspaceClient(() => {}, {
      profile: createWorkspaceProfileMethods(service),
    })
    const server = await fixture.start({
      client,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => client,
    })
    const base = `${server.url}/v1/workspaces/workspace-profile`

    const getDocument = await fetch(`${base}/profile/document`)
    expect(getDocument.status).toBe(409)
    await expect(readJson(getDocument)).resolves.toEqual({
      code: 'unsupported_profile_schema_version',
      message: 'The profile document schema version is unsupported.',
    })

    const validate = await fetch(`${base}/profile/document/validate`, { method: 'POST' })
    expect(validate.status).toBe(409)
    await expect(readJson(validate)).resolves.toEqual({
      code: 'unsupported_profile_schema_version',
      message: 'The profile document schema version is unsupported.',
    })

    const update = await fetch(`${base}/profile/document`, {
      body: JSON.stringify({
        expectedRevision: current.revision,
        profile: { email: 'kenny@example.com' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(update.status).toBe(409)
    await expect(readJson(update)).resolves.toEqual({
      code: 'unsupported_profile_schema_version',
      message: 'The profile document schema version is unsupported.',
    })
    expect(updateCalls).toBe(0)
  })

  it('propagates JSON adapter format and restore through HTTP without exposing local filePath', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-profile-http-'))
    const profilePath = path.join(directory, 'profile.json')
    const service = createJsonProfileService(profilePath)
    const client = createBoundaryWorkspaceClient(() => {}, {
      profile: createWorkspaceProfileMethods(service),
    })
    const server = await fixture.start({
      client,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => client,
    })
    const base = `${server.url}/v1/workspaces/workspace-profile`

    const created = await fetch(`${base}/profile/document`, {
      body: JSON.stringify({
        expectedRevision: (await service.getDocument()).revision,
        profile: { email: 'kenny@example.com' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(created.status).toBe(200)
    const document = (await readJson(created)) as { revision: string; profile: { email: string } }
    expect(document.profile.email).toBe('kenny@example.com')

    const formatted = await fetch(`${base}/profile/document/format`, {
      body: JSON.stringify({ expectedRevision: document.revision }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(formatted.status).toBe(200)
    await expect(readJson(formatted)).resolves.toMatchObject({
      revision: document.revision,
      profile: { email: 'kenny@example.com' },
    })

    const restored = await fetch(`${base}/profile/document/restore`, {
      body: JSON.stringify({ expectedRevision: document.revision }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(restored.status).toBe(200)
    const restoredBody = await readJson(restored)
    expect(restoredBody).toMatchObject({
      profile: { email: null },
    })
    expect(JSON.stringify(restoredBody)).not.toContain(profilePath)
  })
})
