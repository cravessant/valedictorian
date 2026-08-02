import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  abortWorkspaceTransfer,
  activateWorkspaceTarget,
  admitPortableMutation,
  admitSchedulerClaim,
  assertWorkspaceRouterCoverage,
  createWorkspaceReceiptLedger,
  fenceWorkspaceSource,
  findWorkspaceRoute,
  isDeclaredWorkspacePath,
  prepareWorkspaceTransfer,
  releasedEndpointFailures,
  reverseWorkspaceTransfer,
  sortWorkspaceRoutes,
  workspaceNonWireOperations,
  workspaceRouteRegistry,
  workspaceFailureDefinitions,
  stageWorkspaceSnapshot,
  verifyWorkspaceFinalSnapshot,
  WorkspaceProtocolError,
} from '@sparxie/valedictorian-workspace-server'
import {
  createReleasedWorkspaceCompatibilitySnapshot,
  createWorkspaceClientSource,
  createWorkspaceOpenApiDocument,
} from '@sparxie/valedictorian-workspace-server/generator'
import {
  createWorkspaceClient,
  workspaceClientOperations,
} from '@sparxie/valedictorian-workspace-client'
import {
  assertReleasedWorkspaceCompatibility,
  assertWorkspaceContract,
} from './index'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageRoot, '../../..')
const openApiPath = path.join(repositoryRoot, 'packages/workspace/openapi/workspace.openapi.json')
const generatedClientPath = path.join(repositoryRoot, 'packages/workspace/client/src/generated.ts')
const authorityPath = path.join(repositoryRoot, 'architecture/workspace-authority.json')

function generatedPathMethods(document: Record<string, unknown>): string[] {
  const paths = document.paths as Record<string, Record<string, unknown>>
  return Object.entries(paths).flatMap(([pathName, pathItem]) =>
    Object.keys(pathItem)
      .filter((method) => ['delete', 'get', 'patch', 'post', 'put'].includes(method))
      .map((method) => `${method.toUpperCase()} ${pathName}`),
  ).sort()
}

describe('workspace API contract', () => {
  it('keeps the producer registry, spec, and generated client bijective', () => {
    const snapshot = assertWorkspaceContract()
    const document = JSON.parse(fs.readFileSync(openApiPath, 'utf8')) as Record<string, unknown>
    const routeKeys = sortWorkspaceRoutes(workspaceRouteRegistry)
      .map((route) => `${route.method} ${route.path}`)
    expect(snapshot.routeCount).toBeGreaterThan(100)
    expect(generatedPathMethods(document)).toEqual([...routeKeys].sort())
    expect(workspaceClientOperations.map((operation) => `${operation.method} ${operation.path}`).sort())
      .toEqual([...routeKeys].sort())
    const authority = JSON.parse(fs.readFileSync(authorityPath, 'utf8')) as {
      releasedOperationGroups: Array<{ operations: string[] }>
    }
    const released = authority.releasedOperationGroups.flatMap((group) => group.operations)
    const current = new Set([
      ...workspaceRouteRegistry.map((route) => route.operationId),
      ...workspaceNonWireOperations.map((operation) => operation.operationId),
    ])
    expect(released.every((operationId) => current.has(operationId))).toBe(true)
    expect([...current].filter((operationId) => !released.includes(operationId)))
      .toEqual(['receipts.getByIdempotencyKey'])
  })

  it('diffs method, path, status, and auth against the released SDK baseline', () => {
    expect(assertReleasedWorkspaceCompatibility()).toMatchObject({
      operationCount: 125,
      sdkVersion: '0.36.0',
    })
  })

  it('includes complete request, success, and error header contracts in compatibility', () => {
    const snapshot = createReleasedWorkspaceCompatibilitySnapshot()
    const mutation = snapshot.find((entry) => entry.operationId === 'companies.create')!
    expect(mutation.requestHeaders).toEqual([
      {
        name: 'Idempotency-Key',
        required: false,
        description: 'Required by portable authorities; adapted for the compatible v1 local authority.',
        schema: { type: 'string', minLength: 1 },
      },
      {
        name: 'X-Workspace-Authority-Epoch',
        required: false,
        description: 'Required by portable authorities; adapted for the compatible v1 local authority.',
        schema: { type: 'integer', minimum: 0 },
      },
      {
        name: 'X-Request-Fingerprint',
        required: false,
        description: 'Required by portable authorities; adapted for the compatible v1 local authority.',
        schema: { type: 'string', minLength: 1 },
      },
    ])
    expect(mutation.successHeaders).toEqual([
      {
        name: 'Idempotency-Replayed',
        required: false,
        schema: { type: 'boolean' },
      },
      {
        name: 'X-Workspace-Authority-Epoch',
        required: false,
        schema: { type: 'integer', minimum: 0 },
      },
    ])
    expect(mutation.errorHeaders).toEqual([
      {
        name: 'Retry-After',
        required: false,
        schema: { type: 'string' },
      },
      {
        name: 'X-Workspace-Authority-Epoch',
        required: false,
        schema: { type: 'integer', minimum: 0 },
      },
    ])
    expect(snapshot.find((entry) => entry.operationId === 'health.get')?.requestHeaders)
      .toEqual([])

    const document = createWorkspaceOpenApiDocument() as {
      paths: Record<string, Record<string, {
        parameters: Array<Record<string, unknown>>
        responses: Record<string, {
          headers: Record<string, Record<string, unknown>>
        }>
      }>>
    }
    const operation = document.paths['/v1/companies']!.post!
    expect(operation.parameters.filter(({ in: location }) => location === 'header'))
      .toEqual((mutation.requestHeaders as Array<Record<string, unknown>>)
        .map((header) => ({ in: 'header', ...header })))
    expect(operation.responses['200']!.headers)
      .toEqual(Object.fromEntries((mutation.successHeaders as Array<Record<string, unknown>>)
        .map(({ name, ...header }) => [name, header])))
    expect(operation.responses['401']!.headers)
      .toEqual(Object.fromEntries((mutation.errorHeaders as Array<Record<string, unknown>>)
        .map(({ name, ...header }) => [name, header])))
  })

  it('regenerates identical bytes and marks generated output as immutable', () => {
    const checkedInSpec = fs.readFileSync(openApiPath, 'utf8')
    const checkedInClient = fs.readFileSync(generatedClientPath, 'utf8')
    expect(`${JSON.stringify(createWorkspaceOpenApiDocument(), null, 2)}\n`).toBe(checkedInSpec)
    expect(createWorkspaceClientSource()).toBe(checkedInClient)
    expect(checkedInClient).toContain('@generated by workspace-contract-generator/2; DO NOT EDIT.')
    expect(checkedInSpec).not.toMatch(/(?:generatedAt|hostname|\/Users\/|\\Users\\)/i)
    expect(checkedInSpec).not.toContain('"additionalProperties": true')
    expect(checkedInSpec).not.toContain('packages/workspace/server/src/contract.ts')
    const document = JSON.parse(checkedInSpec) as {
      components: { schemas: Record<string, Record<string, unknown>> }
      paths: Record<string, Record<string, Record<string, unknown>>>
    }
    for (const route of workspaceRouteRegistry) {
      const operation = document.paths[route.path]![route.method.toLowerCase()]!
      if (route.requestBody) {
        const requestRef = ((((operation.requestBody as Record<string, unknown>).content as Record<string, Record<string, Record<string, string>>>)['application/json']).schema).$ref
        expect(document.components.schemas[requestRef.replace('#/components/schemas/', '')]?.['x-authored-schema']).toBe(true)
      }
      if (route.successStatus !== 204) {
        const responseRef = (((((operation.responses as Record<string, Record<string, unknown>>)[String(route.successStatus)]).content as Record<string, Record<string, Record<string, string>>>)['application/json']).schema).$ref
        expect(document.components.schemas[responseRef.replace('#/components/schemas/', '')]?.['x-authored-schema']).toBe(true)
      }
    }
  })

  it('preserves released failure code, status, and kind triples', () => {
    const authority = JSON.parse(fs.readFileSync(authorityPath, 'utf8')) as {
      failureMatrix: Array<{ code: string; httpStatus: number; kind: string }>
      releasedFailureCompatibility: {
        failures: Array<{ surface: string; code: string; httpStatus: number; kind: string }>
      }
    }
    expect(Object.entries(workspaceFailureDefinitions).map(([code, definition]) => ({
      code,
      httpStatus: definition.httpStatus,
      kind: definition.kind,
    }))).toEqual(authority.failureMatrix.map(({ code, httpStatus, kind }) => ({
      code,
      httpStatus,
      kind,
    })))
    expect(releasedEndpointFailures.map(({ surface, code, httpStatus, kind }) => ({
      surface,
      code,
      httpStatus,
      kind,
    }))).toEqual(authority.releasedFailureCompatibility.failures)
    for (const route of workspaceRouteRegistry) {
      const endpointCodes = route.endpointFailures.map(({ code }) => code)
      const crossCuttingCodes = route.safeErrors
      expect([...endpointCodes, ...crossCuttingCodes].slice(0, endpointCodes.length))
        .toEqual(endpointCodes)
    }
  })

  it('fails closed for undeclared routes instead of accepting a domain prefix', () => {
    expect(findWorkspaceRoute('/v1/captures/example', 'GET')?.operationId).toBe('captures.get')
    expect(findWorkspaceRoute('/v1/captures/example', 'POST')).toBeUndefined()
    expect(isDeclaredWorkspacePath('/v1/captures/example/undeclared')).toBe(false)
    expect(isDeclaredWorkspacePath('/v1/connectors/example/schedule')).toBe(true)
    expect(findWorkspaceRoute('/v1/secrets/local/resolve', 'POST')?.localOnly).toBe(true)
  })

  it('detects both directions of live-router registry drift', () => {
    const declared = findWorkspaceRoute('/v1/captures/example', 'GET')
    expect(() => assertWorkspaceRouterCoverage(declared, false))
      .toThrow(/declared-without-handler.*captures\.get/i)
    expect(() => assertWorkspaceRouterCoverage(undefined, true))
      .toThrow(/handler-without-registry/i)
  })

  it('keeps generated clients leaf-like and the producer independent', () => {
    const clientSource = fs.readFileSync(generatedClientPath, 'utf8')
    expect(clientSource).not.toMatch(/workspace-server|server\/src|authored-schema/i)
    const serverSource = fs.readFileSync(path.join(repositoryRoot, 'packages/workspace/server/src/contract.ts'), 'utf8')
    expect(serverSource).not.toMatch(/workspace-client|client\/src|generated/i)
    const generatorSource = fs.readFileSync(
      path.join(repositoryRoot, 'packages/workspace/server/src/generator.ts'),
      'utf8',
    )
    expect(generatorSource).not.toMatch(/process\.argv|invokedAsScript/)
    const generationEntrypoint = fs.readFileSync(
      path.join(repositoryRoot, 'packages/workspace/server/src/generate.ts'),
      'utf8',
    )
    expect(generationEntrypoint).toContain('writeWorkspaceContractArtifacts(repositoryRoot)')
  })

  it('keeps package ownership explicit without a root catch-all', () => {
    const workspaceYaml = fs.readFileSync(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspaceYaml).toContain('packages/workspace/server')
    expect(workspaceYaml).toContain('packages/workspace/client')
    expect(workspaceYaml).toContain('packages/workspace/conformance')
    expect(workspaceYaml).not.toContain('packages/workspace/*')
    for (const packageName of ['server', 'client', 'conformance']) {
      const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, `packages/workspace/${packageName}/package.json`), 'utf8')) as {
        private?: boolean
        files?: string[]
        exports?: Record<string, unknown>
      }
      expect(packageJson.private).toBe(true)
      expect(packageJson.files).toEqual(['dist'])
      expect(packageJson.exports).toBeDefined()
      if (packageName === 'server') {
        expect(Object.keys(packageJson.exports ?? {}).sort())
          .toEqual(['.', './generator', './route-registry'])
      }
    }
  })

  it('exercises a representative generated call with deterministic URL encoding', async () => {
    const requests: Request[] = []
    const client = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid/',
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return new Response('null', {
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    await client.operations['captures.get']({
      params: { captureId: 'a/b' },
    })
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.url).toBe('https://workspace.invalid/v1/captures/a%2Fb')
  })

  it('fails closed on undeclared statuses and unknown successful response fields', async () => {
    const unknownStatus = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async () => new Response('{}', {
        headers: { 'content-type': 'application/json' },
        status: 202,
      }),
    })
    await expect(unknownStatus.operations['health.get']()).rejects.toThrow(/undeclared HTTP status 202/i)
    const unknownField = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async () => new Response('{"ok":true,"extra":true}', {
        headers: { 'content-type': 'application/json' },
      }),
    })
    await expect(unknownField.operations['health.get']()).rejects.toThrow(/expected exactly/i)
  })

  it('accepts exact released workspace and capture list results and rejects shape drift', async () => {
    const workspaceResult = {
      items: [{ id: 'workspace-1', name: 'Primary', open: true, source: 'local' }],
    } as const
    const captureResult = {
      items: [],
      pageInfo: {
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
      },
    } as const
    const valid = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async (input) => new Response(
        new URL(new Request(input).url).pathname === '/v1/workspaces'
          ? JSON.stringify(workspaceResult)
          : JSON.stringify(captureResult),
        { headers: { 'content-type': 'application/json' } },
      ),
    })
    await expect(valid.operations['workspaces.list']()).resolves.toEqual(workspaceResult)
    await expect(valid.operations['captures.list']({ query: {} })).resolves.toEqual(captureResult)

    const malformed = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async () => new Response(JSON.stringify({
        ...workspaceResult,
        unexpected: true,
      }), { headers: { 'content-type': 'application/json' } }),
    })
    await expect(malformed.operations['workspaces.list']()).rejects.toThrow(/expected exactly/i)
  })

  it('validates exact released capture-create input before transport', async () => {
    let calls = 0
    const client = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async () => {
        calls += 1
        throw new Error('transport reached')
      },
    })
    const body = {
      evidenceMode: 'reported' as const,
      adapter: { id: 'manual', kind: 'manual' as const, version: '1.0.0' },
      observedAt: '2026-08-01T12:00:00.000Z',
      providerRecordId: null,
      providerSchema: null,
      payload: { title: 'Controls Intern' },
      evidence: [],
    }
    await expect(client.operations['captures.create']({ body })).rejects.toThrow('transport reached')
    expect(calls).toBe(1)
    await expect(client.operations['captures.create']({
      body: { ...body, unexpected: true } as never,
    })).rejects.toThrow(/invalid request/i)
    expect(calls).toBe(1)
  })

  it('enforces released URI formats before transport', async () => {
    let calls = 0
    const client = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async () => {
        calls += 1
        throw new Error('transport reached')
      },
    })
    const body = {
      actor: { id: 'user-1', type: 'user' as const },
      displayName: 'Example Company',
      idempotencyKey: 'company-1',
      rationale: 'Create the canonical company record.',
      websiteUrl: 'https://example.com',
    }
    await expect(client.operations['companies.create']({ body }))
      .rejects.toThrow('transport reached')
    expect(calls).toBe(1)
    await expect(client.operations['companies.create']({
      body: { ...body, websiteUrl: 'not a uri' },
    })).rejects.toThrow(/invalid request/i)
    expect(calls).toBe(1)
  })

  it('accepts only the exact released endpoint failure body before fallback errors', async () => {
    const body = {
      connectorId: 'jobright',
      connectorVersion: '1.0.0',
      displayName: 'Jobright',
      enabled: true,
      id: 'jobright-primary',
    }
    const canonical = {
      code: 'already_configured',
      message: 'This connector is already configured. Manage the existing instance.',
    }
    const exact = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async () => new Response(JSON.stringify(canonical), {
        headers: { 'content-type': 'application/json' },
        status: 409,
      }),
    })
    await expect(exact.operations['connectors.create']({ body }))
      .rejects.toMatchObject({ body: canonical, status: 409 })

    const malformed = createWorkspaceClient({
      baseUrl: 'https://workspace.invalid',
      fetch: async () => new Response(JSON.stringify({
        ...canonical,
        message: 'non-canonical',
      }), {
        headers: { 'content-type': 'application/json' },
        status: 409,
      }),
    })
    await expect(malformed.operations['connectors.create']({ body }))
      .rejects.toThrow(/undeclared or malformed failure/i)
  })

  it('fences mutation and scheduler admission with epoch and idempotency checks', () => {
    const active = {
      authorityEpoch: 7,
      authorityId: 'authority-a',
      replicaState: 'active',
      workspaceId: 'workspace-a',
    } as const
    const mutation = {
      authorityEpoch: 7,
      idempotencyKey: 'key-1',
      operation: 'applications.updateStatus',
      requestFingerprint: 'sha256:request',
      workspaceId: 'workspace-a',
    }
    expect(() => admitPortableMutation(active, mutation)).not.toThrow()
    expect(() => admitSchedulerClaim(active, mutation)).not.toThrow()
    for (const replicaState of ['fenced', 'retired'] as const) {
      expect(() => admitPortableMutation({ ...active, replicaState }, mutation))
        .toThrow(WorkspaceProtocolError)
      expect(() => admitSchedulerClaim({ ...active, replicaState }, mutation))
        .toThrow(WorkspaceProtocolError)
    }
    expect(() => admitPortableMutation(active, { ...mutation, authorityEpoch: 6 }))
      .toThrow(/epoch is stale/i)
    expect(() => admitPortableMutation(active, { ...mutation, idempotencyKey: '' }))
      .toThrow(/idempotencyKey/i)
  })

  it('looks up immutable receipts before retry and rejects fingerprint reuse', () => {
    const ledger = createWorkspaceReceiptLedger(() => '2026-08-01T00:00:00.000Z')
    const input = {
      actor: 'scheduler',
      authorityEpoch: 3,
      authorityId: 'authority-a',
      evidenceDigests: ['sha256:evidence'],
      idempotencyKey: 'key-1',
      operation: 'connectors.schedules.dispatchDue',
      outcome: { kind: 'success', value: { ok: true } } as const,
      requestFingerprint: 'sha256:request',
      revisionOrPhase: 'revision:4',
      transferId: null,
      workspaceId: 'workspace-a',
    }
    const receipt = ledger.record(input)
    expect(ledger.record(input)).toBe(receipt)
    expect(ledger.lookup(input)).toBe(receipt)
    expect(() => ledger.record({ ...input, requestFingerprint: 'sha256:different' }))
      .toThrow(/another request/i)
  })

  it('provides fence, activation, abort, and reverse-transfer fixtures', () => {
    const prepared = prepareWorkspaceTransfer({
      authorityEpoch: 4,
      sourceAuthorityId: 'authority-a',
      targetAuthorityId: 'authority-b',
      transferId: 'transfer-1',
      workspaceId: 'workspace-a',
    })
    expect(abortWorkspaceTransfer(stageWorkspaceSnapshot(prepared))).toMatchObject({
      phase: 'aborted',
      sourceState: 'active',
      targetState: 'retired',
    })
    const fenced = fenceWorkspaceSource(stageWorkspaceSnapshot(prepared))
    expect(fenced).toMatchObject({ phase: 'source_fenced', sourceState: 'fenced' })
    const activated = activateWorkspaceTarget(
      verifyWorkspaceFinalSnapshot(fenced),
      prepared.authorityEpoch,
    )
    expect(activated).toMatchObject({
      authorityEpoch: 5,
      phase: 'activated',
      sourceState: 'fenced',
      targetState: 'active',
    })
    expect(() => abortWorkspaceTransfer(activated)).toThrow(/reverse transfer/i)
    expect(reverseWorkspaceTransfer(activated, 'transfer-2')).toMatchObject({
      authorityEpoch: 5,
      sourceAuthorityId: 'authority-b',
      targetAuthorityId: 'authority-a',
      transferId: 'transfer-2',
    })
  })
})
