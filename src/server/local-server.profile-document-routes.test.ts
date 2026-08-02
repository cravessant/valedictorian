import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryProfileStores } from '../modules/profile/profile.memory.store'
import { createJsonProfileService } from '@sparxie/valedictorian-local-runtime/testing/modules/profile/profile.composition'
import { createProfileService } from '@sparxie/valedictorian-local-runtime/testing/modules/profile/profile.service'
import { createWorkspaceProfileMethods } from '@sparxie/valedictorian-local-runtime/testing/runtime/local-profile-secret-client'
import { createConnectorSecretResolver } from '@sparxie/valedictorian-local-runtime/testing/modules/secrets/connector-secret-resolver'
import { createPgliteSecretService } from '@sparxie/valedictorian-local-runtime/testing/modules/secrets/secret.composition'
import { createWorkspaceSecretScope } from '@sparxie/valedictorian-local-runtime/protected-secrets'
import type { LocalValedictorianClient } from '@sparxie/valedictorian-local-runtime/local-client'
import {
  createBoundaryWorkspaceClient,
  createSeededLocalClient as createLocalValedictorianClient,
  createTempDatabasePath,
  readJson,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'
import { getLocalValedictorianTestDatabase } from './local-valedictorian-client.test-harness'

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

  async function startWorkspaceServer(options: { token?: string } = {}) {
    const pgliteDataPath = createTempDatabasePath()
    const client = await createLocalValedictorianClient({
      secretCodec: testCodec,
      pgliteDataPath,
      workspaceId: 'workspace-profile',
    })
    const server = await fixture.start({
      client,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => client,
      ...(options.token === undefined ? {} : { token: options.token }),
    })
    return { client, server, pgliteDataPath }
  }

  function trustedReveal(client: LocalValedictorianClient) {
    return createConnectorSecretResolver(createPgliteSecretService(
      getLocalValedictorianTestDatabase(client),
      testCodec,
      createWorkspaceSecretScope('workspace-profile'),
    ))
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
    const unauthorizedResolve = await fetch(`${base}/secrets/local/resolve`, { method: 'POST' })
    expect(unauthorizedResolve.status).toBe(403)
    expect(unauthorizedResolve.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(unauthorizedResolve)).resolves.toEqual({
      code: 'local_secret_resolution_unauthorized',
      message: 'Local secret resolution is unauthorized.',
    })
    const unscopedResolve = await fetch(`${server.url}/v1/secrets/local/resolve`, { method: 'POST' })
    expect(unscopedResolve.status).toBe(404)
    expect(unscopedResolve.headers.get('cache-control')).toContain('no-store')
  })

  it('returns unsupported only after authentication when local resolution is disabled', async () => {
    const { server } = await startWorkspaceServer({ token: 'server-token' })
    const base = `${server.url}/v1/workspaces/workspace-profile`

    const unsupportedResolve = await fetch(`${base}/secrets/local/resolve`, {
      headers: { authorization: 'Bearer server-token' },
      method: 'POST',
    })
    expect(unsupportedResolve.status).toBe(409)
    expect(unsupportedResolve.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(unsupportedResolve)).resolves.toEqual({
      code: 'local_secret_resolution_unsupported',
      message: 'Local secret resolution is unsupported.',
    })
  })

  it('rejects ordinary HTTP administration of the reserved identity secret', async () => {
    const { client, server } = await startWorkspaceServer()
    const base = `${server.url}/v1/workspaces/workspace-profile`
    const identityCanary = 'identity-http-canary-5125'

    const secretService = createPgliteSecretService(
      getLocalValedictorianTestDatabase(client),
      testCodec,
      createWorkspaceSecretScope('workspace-profile'),
    )
    await secretService.upsertTrustedIdentitySsnLast4('5125')

    const list = await fetch(`${base}/secrets`).then(readJson) as { items: Array<{ key: string }> }
    expect(list.items.every((item) => item.key !== 'identity_ssn_last4')).toBe(true)
    expect(JSON.stringify(list)).not.toContain('identity_ssn_last4')
    expect(JSON.stringify(list)).not.toContain(identityCanary)

    const upsert = await fetch(`${base}/secrets/identity_ssn_last4`, {
      body: JSON.stringify({
        kind: 'password',
        label: 'SSN last four',
        value: identityCanary,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(upsert.status).toBe(500)
    const upsertBody = await readJson(upsert)
    expect(upsertBody).toMatchObject({
      code: 'internal_error',
      message: 'An unexpected error occurred.',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(upsertBody)).not.toContain(identityCanary)

    const remove = await fetch(`${base}/secrets/identity_ssn_last4`, { method: 'DELETE' })
    expect(remove.status).toBe(500)
    const removeBody = await readJson(remove)
    expect(removeBody).toMatchObject({
      code: 'internal_error',
      message: 'An unexpected error occurred.',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(removeBody)).not.toContain(identityCanary)

    await expect(secretService.resolve('identity_ssn_last4')).resolves.toMatchObject({
      value: '5125',
    })
  })

  it('round-trips opaque secret values including whitespace and empty string through HTTP upsert', async () => {
    const { client, server } = await startWorkspaceServer()
    const base = `${server.url}/v1/workspaces/workspace-profile`
    const reveal = trustedReveal(client)

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
            // A hostile store answers with a schema version the contract forbids.
          } as unknown as typeof current
        },
        async update(input) {
          updateCalls += 1
          return stores.profileStore.update(input)
        },
      },
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
