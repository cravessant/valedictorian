import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPgliteSecretService } from '@sparxie/valedictorian-local-runtime/testing/modules/secrets/secret.composition'
import {
  createWorkspaceSecretScope,
  type SecretCodec,
} from '@sparxie/valedictorian-local-runtime/protected-secrets'
import { identitySsnLast4SecretKey } from '@sparxie/valedictorian-local-runtime/testing/modules/secrets/secret.identity'
import { initializeWorkspace } from '@sparxie/valedictorian-local-runtime/workspace-runtime'
import { createFileWorkspaceRegistryStore } from '@sparxie/valedictorian-local-runtime/workspace-files'
import { createLocalWorkspaceManager } from '@sparxie/valedictorian-local-runtime/workspace-runtime'
import {
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
} from '../runtime/local-valedictorian-client.test-harness'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
  createTempFilePath,
  readJson,
} from './local-server.http-test-harness'

const CANARY = 'resolve-canary-token-4d7a'
const CANARY_A = 'workspace-a-canary-token-11aa'
const CANARY_B = 'workspace-b-canary-token-22bb'

const availableCodec: SecretCodec = {
  isAvailable: () => true,
  decrypt(value) {
    return value.replace(/^enc:/, '')
  },
  encrypt(value) {
    return `enc:${value}`
  },
}

const createResettableLocalClient = useResettablePgliteTestLocalValedictorianClient()

describe.sequential('local secret resolution HTTP route', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('advertises and serves authenticated workspace-scoped resolution with no-store', async () => {
    const workspaceId = 'workspace-resolve'
    const client = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const secretService = createPgliteSecretService(
      getTestLocalValedictorianDatabase(client),
      availableCodec,
      createWorkspaceSecretScope(workspaceId),
    )
    await secretService.upsert({
      key: 'jobright',
      kind: 'password',
      label: 'Jobright',
      value: ` ${CANARY} `,
    })

    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async (id) => {
        if (id !== workspaceId) {
          throw Object.assign(new Error('Workspace not found'), { statusCode: 404 })
        }
        return client
      },
      token: 'server-token',
    })

    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      localSecretResolution: true,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://jobright' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(response)).resolves.toEqual({
      value: ` ${CANARY} `,
      handling: { cache: 'no-store', sensitivity: 'secret' },
    })
  })

  it('blocks reserved identity resolution from authenticated shared HTTP while ordinary secrets resolve', async () => {
    const workspaceId = 'workspace-shared-identity-boundary'
    const client = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const secretService = createPgliteSecretService(
      getTestLocalValedictorianDatabase(client),
      availableCodec,
      createWorkspaceSecretScope(workspaceId),
    )
    await secretService.upsertTrustedIdentitySsnLast4('5125')
    await secretService.upsert({
      key: 'ordinary_token',
      kind: 'token',
      label: 'Ordinary token',
      value: 'ordinary-value',
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => client,
      token: 'server-token',
    })
    const resolve = (key: string) => fetch(
      `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: `secret://${key}` },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    for (const key of [
      identitySsnLast4SecretKey,
      'IDENTITY_SSN_LAST4',
      'identity-ssn-last4',
    ]) {
      const identityResponse = await resolve(key)
      expect(identityResponse.status).toBe(404)
      expect(identityResponse.headers.get('cache-control')).toContain('no-store')
      expect(JSON.stringify(await readJson(identityResponse))).not.toContain('5125')
    }

    const ordinaryResponse = await resolve('ordinary_token')
    expect(ordinaryResponse.status).toBe(200)
    await expect(readJson(ordinaryResponse)).resolves.toMatchObject({ value: 'ordinary-value' })
  })

  it('returns typed unauthorized and missing outcomes with no-store', async () => {
    const workspaceId = 'workspace-resolve-errors'
    const enabledClient = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const server = await fixture.start({
      client: enabledClient,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => enabledClient,
      token: 'server-token',
    })
    const base = `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`

    const unauthorized = await fetch(base, {
      body: JSON.stringify({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(unauthorized.status).toBe(403)
    expect(unauthorized.headers.get('cache-control')).toContain('no-store')
    const unauthorizedBody = await readJson(unauthorized)
    expect(unauthorizedBody).toEqual({
      code: 'local_secret_resolution_unauthorized',
      message: 'Local secret resolution is unauthorized.',
    })
    expect(JSON.stringify(unauthorizedBody)).not.toContain(CANARY)

    const missing = await fetch(base, {
      body: JSON.stringify({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://missing' },
      }),
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(missing)).resolves.toEqual({
      code: 'secret_not_found',
      message: 'The secret was not found.',
    })
  })

  it('requires authentication before unsupported when policy is disabled', async () => {
    const workspaceId = 'workspace-resolve-auth-first'
    const disabledClient = await createResettableLocalClient({
      localSecretResolutionEnabled: false,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const server = await fixture.start({
      client: disabledClient,
      localSecretResolutionEnabled: false,
      resolveWorkspaceClient: async () => disabledClient,
      token: 'server-token',
    })
    const base = `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`

    const missingBearer = await fetch(base, {
      body: JSON.stringify({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(missingBearer.status).toBe(403)
    expect(missingBearer.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(missingBearer)).resolves.toEqual({
      code: 'local_secret_resolution_unauthorized',
      message: 'Local secret resolution is unauthorized.',
    })

    const wrongBearer = await fetch(base, {
      body: JSON.stringify({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(wrongBearer.status).toBe(403)
    expect(wrongBearer.headers.get('cache-control')).toContain('no-store')

    const unsupported = await fetch(base, {
      body: JSON.stringify({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(unsupported.status).toBe(409)
    expect(unsupported.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(unsupported)).resolves.toEqual({
      code: 'local_secret_resolution_unsupported',
      message: 'Local secret resolution is unsupported.',
    })
  })

  it('returns unauthorized when the server has no token configured', async () => {
    const workspaceId = 'workspace-resolve-no-server-token'
    const client = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://jobright' },
        }),
        headers: {
          authorization: 'Bearer anything',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(response)).resolves.toEqual({
      code: 'local_secret_resolution_unauthorized',
      message: 'Local secret resolution is unauthorized.',
    })
  })

  it('keeps the unscoped root resolve path as canonical 404 no-store', async () => {
    const client = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId: 'workspace-root',
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      token: 'server-token',
    })

    const response = await fetch(`${server.url}/v1/secrets/local/resolve`, {
      body: JSON.stringify({
        purpose: { kind: 'subprocess_injection' },
        reference: { $valedictorianRef: 'secret://jobright' },
      }),
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(readJson(response)).resolves.toEqual({ message: 'Not found' })
  })

  it('returns value-free 404 no-store when workspace resolution fails', async () => {
    const workspaceId = 'workspace-missing'
    const client = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId: 'workspace-active',
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => {
        throw new Error(`Workspace resolver failed containing ${CANARY}`)
      },
      token: 'server-token',
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://jobright' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = await readJson(response)
    expect(body).toEqual({ message: 'Not found' })
    expect(JSON.stringify(body)).not.toContain(CANARY)
  })

  it('marks every sensitive-route method outcome as no-store including OPTIONS', async () => {
    const workspaceId = 'workspace-methods'
    const client = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => client,
      token: 'server-token',
    })
    const base = `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`

    for (const method of ['GET', 'PUT'] as const) {
      const response = await fetch(base, {
        headers: { authorization: 'Bearer server-token' },
        method,
      })
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toContain('no-store')
    }

    const options = await fetch(base, {
      headers: { authorization: 'Bearer server-token' },
      method: 'OPTIONS',
    })
    expect(options.status).toBe(204)
    expect(options.headers.get('cache-control')).toContain('no-store')
    expect(await options.text()).toBe('')
  })

  it('returns value-free 400 no-store for schema-invalid resolve input', async () => {
    const workspaceId = 'workspace-schema'
    const client = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => client,
      token: 'server-token',
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify({ purpose: { kind: 'not-a-purpose' } }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = await readJson(response)
    expect(body).toEqual({ message: 'Invalid local secret resolution request' })
    expect(JSON.stringify(body)).not.toContain(CANARY)
  })

  it('returns fixed 400 no-store for malformed JSON before secret resolution', async () => {
    const workspaceId = 'workspace-malformed-json'
    let createCalls = 0
    let resolveCalls = 0
    const client = createBoundaryWorkspaceClient(() => {
      createCalls += 1
    }, {
      secrets: {
        local: {
          async resolve() {
            resolveCalls += 1
            throw new Error('secret resolution should not be called')
          },
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => client,
      token: 'server-token',
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: `{"private":"${CANARY}"`,
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = await readJson(response)
    expect(body).toEqual({ message: 'The request is invalid.' })
    expect(JSON.stringify(body)).not.toContain(CANARY)
    expect(createCalls).toBe(0)
    expect(resolveCalls).toBe(0)
  })

  it('never echoes forged downstream error bodies and keeps canonical no-store outcomes', async () => {
    const SECRET_CANARY = 'forged-downstream-secret-canary-9f3c'
    const workspaceId = 'workspace-forged-errors'
    const baseClient = await createResettableLocalClient({
      localSecretResolutionEnabled: true,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const resolveBody = {
      purpose: { kind: 'subprocess_injection' },
      reference: { $valedictorianRef: 'secret://jobright' },
    }
    const resolveHeaders = {
      authorization: 'Bearer server-token',
      'content-type': 'application/json',
    }

    const withForgedResolve = (
      throwError: () => never,
    ) => ({
      ...baseClient,
      secrets: {
        ...baseClient.secrets,
        local: {
          resolve: async () => throwError(),
        },
      },
    })

    const forgedSharedCodeClient = withForgedResolve(() => {
      throw Object.assign(new Error('forged shared code'), {
        body: { code: 'secret_not_found', message: SECRET_CANARY },
        statusCode: 400,
      })
    })
    const forgedSharedServer = await fixture.start({
      client: forgedSharedCodeClient,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => forgedSharedCodeClient,
      token: 'server-token',
    })
    const forgedSharedResponse = await fetch(
      `${forgedSharedServer.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify(resolveBody),
        headers: resolveHeaders,
        method: 'POST',
      },
    )
    expect(forgedSharedResponse.status).toBe(404)
    expect(forgedSharedResponse.headers.get('cache-control')).toContain('no-store')
    const forgedSharedBody = await readJson(forgedSharedResponse)
    expect(forgedSharedBody).toEqual({
      code: 'secret_not_found',
      message: 'The secret was not found.',
    })
    expect(JSON.stringify(forgedSharedBody)).not.toContain(SECRET_CANARY)

    const forgedMessageClient = withForgedResolve(() => {
      throw Object.assign(new Error('forged message body'), {
        body: { message: SECRET_CANARY },
        statusCode: 400,
      })
    })
    const forgedMessageServer = await fixture.start({
      client: forgedMessageClient,
      localSecretResolutionEnabled: true,
      resolveWorkspaceClient: async () => forgedMessageClient,
      token: 'server-token',
    })
    const forgedMessageResponse = await fetch(
      `${forgedMessageServer.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify(resolveBody),
        headers: resolveHeaders,
        method: 'POST',
      },
    )
    expect(forgedMessageResponse.status).toBe(500)
    expect(forgedMessageResponse.headers.get('cache-control')).toContain('no-store')
    const forgedMessageBody = await readJson(forgedMessageResponse)
    expect(forgedMessageBody).toEqual({
      code: 'internal_error',
      message: 'An unexpected error occurred.',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(forgedMessageBody)).not.toContain(SECRET_CANARY)
  })

  it('keeps capability false and unsupported when policy disables resolution', async () => {
    const workspaceId = 'workspace-resolve-disabled'
    const disabledClient = await createResettableLocalClient({
      localSecretResolutionEnabled: false,
      secretCodec: availableCodec,
      seedDataMode: 'sample',
      workspaceId,
    })
    const disabledServer = await fixture.start({
      client: disabledClient,
      localSecretResolutionEnabled: false,
      resolveWorkspaceClient: async () => disabledClient,
      token: 'server-token',
    })
    await expect(fetch(`${disabledServer.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      localSecretResolution: false,
    })
    const unsupported = await fetch(
      `${disabledServer.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://jobright' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    expect(unsupported.status).toBe(409)
    expect(unsupported.headers.get('cache-control')).toContain('no-store')
  })

  it('resolves same-named secrets only within each workspace through the manager', async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-workspace-a-'))
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-workspace-b-'))
    const workspaceA = initializeWorkspace(rootA, { createId: () => 'secret-ws-a' })
    const workspaceB = initializeWorkspace(rootB, { createId: () => 'secret-ws-b' })
    const manager = createLocalWorkspaceManager({
      registryStore: createFileWorkspaceRegistryStore(createTempFilePath('workspaces.json')),
      secretCodec: availableCodec,
    })
    await manager.open({ path: workspaceA.rootPath })
    await manager.open({ path: workspaceB.rootPath })

    const clientA = await manager.resolveClient(workspaceA.id)
    const clientB = await manager.resolveClient(workspaceB.id)
    await clientA.secrets.upsert({
      key: 'jobright',
      kind: 'password',
      label: 'Jobright',
      value: CANARY_A,
    })
    await clientB.secrets.upsert({
      key: 'jobright',
      kind: 'password',
      label: 'Jobright',
      value: CANARY_B,
    })

    const server = await fixture.start({
      client: clientA,
      localSecretResolutionEnabled: true,
      token: 'server-token',
      workspaceManager: manager,
    })

    const secretsBase = `${server.url}/v1/workspaces/${workspaceA.id}/secrets`
    const authHeaders = {
      authorization: 'Bearer server-token',
      'content-type': 'application/json',
    }
    const writeOnlyUpsert = await fetch(`${secretsBase}/greenhouse_password`, {
      body: JSON.stringify({
        kind: 'password',
        label: 'Greenhouse',
        value: 'correct horse battery staple',
      }),
      headers: authHeaders,
      method: 'PUT',
    })
    const writeOnlyPayload = (await readJson(writeOnlyUpsert)) as Record<string, unknown>
    const writeOnlyList = await fetch(secretsBase, {
      headers: { authorization: 'Bearer server-token' },
    })
    const writeOnlyListPayload = (await readJson(writeOnlyList)) as {
      items: Array<Record<string, unknown>>
    }
    const writeOnlyReveal = await fetch(`${secretsBase}/greenhouse_password`, {
      headers: { authorization: 'Bearer server-token' },
    })
    expect(writeOnlyUpsert.status).toBe(200)
    expect(writeOnlyPayload).toMatchObject({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse',
    })
    expect(writeOnlyPayload).not.toHaveProperty('value')
    expect(writeOnlyListPayload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse',
      }),
    ]))
    expect(writeOnlyListPayload.items.every((item) => !('value' in item))).toBe(true)
    expect(writeOnlyReveal.status).toBe(404)

    const profileUpdateResponse = await fetch(
      `${server.url}/v1/workspaces/${workspaceA.id}/profile`,
      {
        body: JSON.stringify({ dateOfBirth: '1999-05-12', disabilityStatus: 'No' }),
        headers: authHeaders,
        method: 'PATCH',
      },
    )
    const profilePayload = (await readJson(profileUpdateResponse)) as Record<string, unknown>
    expect(profileUpdateResponse.status).toBe(200)
    expect(profilePayload).toMatchObject({
      dateOfBirth: '1999-05-12',
      disabilityStatus: 'No',
    })
    expect(JSON.stringify(profilePayload)).not.toContain('ssn')

    const deleteResponse = await fetch(`${secretsBase}/greenhouse_password`, {
      headers: { authorization: 'Bearer server-token' },
      method: 'DELETE',
    })
    expect(deleteResponse.status).toBe(200)
    const emptyList = (await readJson(await fetch(secretsBase, {
      headers: { authorization: 'Bearer server-token' },
    }))) as {
      items: Array<{ key: string }>
    }
    expect(emptyList.items.every((item) => item.key !== 'greenhouse_password')).toBe(true)

    const resolve = async (workspaceId: string) => fetch(
      `${server.url}/v1/workspaces/${workspaceId}/secrets/local/resolve`,
      {
        body: JSON.stringify({
          purpose: { kind: 'subprocess_injection' },
          reference: { $valedictorianRef: 'secret://jobright' },
        }),
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    const responseA = await resolve(workspaceA.id)
    expect(responseA.status).toBe(200)
    await expect(readJson(responseA)).resolves.toEqual({
      value: CANARY_A,
      handling: { cache: 'no-store', sensitivity: 'secret' },
    })

    const responseB = await resolve(workspaceB.id)
    expect(responseB.status).toBe(200)
    const bodyB = await readJson(responseB)
    expect(bodyB).toEqual({
      value: CANARY_B,
      handling: { cache: 'no-store', sensitivity: 'secret' },
    })
    expect(JSON.stringify(bodyB)).not.toContain(CANARY_A)
    await manager.close()
  })
})
