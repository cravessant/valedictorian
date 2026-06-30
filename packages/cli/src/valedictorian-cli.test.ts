import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, readPackageJson, runCli } from './valedictorian-cli.test-helpers'

describe('valedictorian-cli npm package', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes a valedictorian-cli bin and keeps Electron, UI, and SQLite out of the package', () => {
    const packageJson = readPackageJson()
    const dependencyNames = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    })

    expect(packageJson.name).toBe('valedictorian-cli')
    expect(packageJson.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/)
    expect(packageJson.bin?.['valedictorian-cli']).toBe('dist/valedictorian.js')
    expect(packageJson.files).toEqual(['dist'])
    expect(packageJson.scripts?.prepare).toBe('pnpm build')
    expect(packageJson.scripts?.prepublishOnly).toBe('pnpm lint && pnpm test && pnpm build')
    expect(packageJson.dependencies?.sparxie).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageJson.dependencies?.sparxie).not.toContain('github:')
    expect(Object.values(packageJson.scripts ?? {})).not.toEqual(
      expect.arrayContaining([expect.stringContaining('../sparxie')]),
    )
    expect(dependencyNames).not.toEqual(
      expect.arrayContaining([
        'electron',
        'react',
        'react-dom',
        'drizzle-orm',
        'better-sqlite3',
        '@types/better-sqlite3',
      ]),
    )
  })

  it('runs read-only doctor diagnostics with human output by default', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['doctor'], { VALEDICTORIAN_API_TOKEN: 'token-1' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Valedictorian CLI doctor')
    expect(result.stdout).toContain('Status: ok')
    expect(result.stdout).toContain('API URL: https://valedictorian.test (staging)')
    expect(result.stdout).toContain('Token: present')
    expect(result.stdout).not.toContain('token-1')
    expect(fetchMock).toHaveBeenCalledWith('https://valedictorian.test/v1/health', {
      headers: {
        accept: 'application/json',
        authorization: 'Bearer token-1',
      },
      method: 'GET',
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it('can emit doctor diagnostics as JSON without probing the API', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['doctor', '--skip-network', '--json'], {
      VALEDICTORIAN_API_URL: 'http://localhost:4317',
    })
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      target: { apiUrl: string; classification: string; tokenPresent: boolean }
      checks: Array<{ name: string; status: string }>
    }

    expect(result.exitCode).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.target).toEqual({
      apiUrl: 'http://localhost:4317',
      classification: 'local',
      tokenPresent: false,
    })
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'api-health', status: 'skip' }),
      ]),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verifies workspace-scoped route access in doctor diagnostics', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        applicationAttempts: true,
        agentWorkflows: false,
        billing: false,
        hostedSync: false,
        localSqlite: true,
        multiWorkspace: true,
        sourcing: true,
        workflowRuns: true,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: 'workspace-1',
            latestError: null,
            name: 'Example Workspace',
            open: true,
            path: '/Users/example/valedictorian/Example Workspace',
            source: 'local',
          },
        ],
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, { status: 404 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, limit: 1, offset: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['doctor', '--workspace', 'Example Workspace', '--json'])
    const report = JSON.parse(result.stdout) as {
      capabilities?: Record<string, unknown>
      checks: Array<{ name: string; status: string; message: string }>
      ok: boolean
      workspace: { id?: string; name?: string; resolution: string }
    }

    expect(result.exitCode).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.workspace).toMatchObject({
      id: 'workspace-1',
      name: 'Example Workspace',
      resolution: 'resolved',
    })
    expect(report.capabilities).toMatchObject({
      agentWorkflows: false,
      workflowRuns: true,
      applicationAttempts: true,
    })
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'workspace-route-scope',
          status: 'pass',
          message: 'Unscoped data route returned 404 as expected; workspace-scoped read succeeded.',
        }),
      ]),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('falls back to the local workspace registry and resolves the last-open workspace for doctor', async () => {
    const registryPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-workspaces-')),
      'workspaces.json',
    )
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        lastOpenedWorkspaceId: 'workspace-last',
        workspaces: {
          'workspace-last': {
            id: 'workspace-last',
            lastOpenedAt: '2026-06-12T10:00:00.000Z',
            name: 'Example Workspace',
            open: true,
            path: '/Users/example/valedictorian/Example Workspace',
          },
        },
      }),
    )
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        localSqlite: true,
        multiWorkspace: true,
        sourcing: true,
        workflowRuns: true,
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, { status: 404 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, { status: 404 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], total: 0, limit: 1, offset: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['doctor', '--json'], {
      VALEDICTORIAN_API_URL: 'http://127.0.0.1:4317',
      VALEDICTORIAN_WORKSPACE_REGISTRY_PATH: registryPath,
    })
    const report = JSON.parse(result.stdout) as {
      checks: Array<{ name: string; status: string; message: string }>
      ok: boolean
      workspace: { id?: string; resolution: string }
    }

    expect(result.exitCode).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.workspace).toMatchObject({
      id: 'workspace-last',
      resolution: 'resolved',
    })
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'workspace',
          status: 'pass',
          message: expect.stringContaining('loaded local registry fallback'),
        }),
      ]),
    )
  })

  it('prints read-only CLI context and reports a single last-open workspace', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        applicationAttempts: true,
        agentWorkflows: false,
        hostedSync: false,
        localSqlite: true,
        multiWorkspace: true,
        sourcing: true,
        workflowRuns: true,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: 'workspace-1',
            latestError: null,
            name: 'Example Workspace',
            open: true,
            path: '/Users/example/valedictorian/Example Workspace',
            source: 'local',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['context', '--json'])
    const context = JSON.parse(result.stdout) as {
      target: { apiUrl: string; classification: string }
      workspace: { id?: string; note: string; resolution: string }
    }

    expect(result.exitCode).toBe(0)
    expect(context.target).toMatchObject({
      apiUrl: 'https://valedictorian.test',
      classification: 'staging',
    })
    expect(context.workspace).toMatchObject({
      id: 'workspace-1',
      note: 'Last-open workspace resolved for diagnostics. Workspace-scoped commands still require --workspace.',
      resolution: 'resolved',
    })
  })

  it('lists workspaces without requiring a selected workspace', async () => {
    const payload = {
      items: [
        {
          id: 'workspace-1',
          latestError: null,
          name: 'Example Workspace',
          open: true,
          path: '/Users/example/valedictorian/Example Workspace',
          source: 'local',
        },
      ],
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['workspaces', 'list', '--json'])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('https://valedictorian.test/v1/workspaces', {
      headers: {
        accept: 'application/json',
      },
      method: 'GET',
    })
  })

  it('opens and creates workspaces over HTTP', async () => {
    const opened = {
      id: 'workspace-opened',
      latestError: null,
      name: 'Opened',
      open: true,
      path: '/Users/example/valedictorian/Opened',
      source: 'local',
    }
    const created = {
      id: 'workspace-created',
      latestError: null,
      name: 'Created',
      open: true,
      path: '/Users/example/valedictorian/Created',
      source: 'local',
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(opened))
    fetchMock.mockResolvedValueOnce(jsonResponse(created))
    vi.stubGlobal('fetch', fetchMock)

    const openResult = await runCli([
      'workspaces',
      'open',
      '/Users/example/valedictorian/Opened',
      '--rekey',
      '--json',
    ])
    const createResult = await runCli([
      'workspaces',
      'create',
      '/Users/example/valedictorian/Created',
      '--json',
    ])

    expect(openResult.exitCode).toBe(0)
    expect(JSON.parse(openResult.stdout)).toEqual(opened)
    expect(createResult.exitCode).toBe(0)
    expect(JSON.parse(createResult.stdout)).toEqual(created)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/open',
      expect.objectContaining({
        body: JSON.stringify({ path: '/Users/example/valedictorian/Opened', rekey: true }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/create',
      expect.objectContaining({
        body: JSON.stringify({ path: '/Users/example/valedictorian/Created' }),
        method: 'POST',
      }),
    )
  })

  it('exits non-zero when doctor cannot reach a healthy API', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ message: 'unavailable' }, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(['doctor', '--json'])
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      checks: Array<{ name: string; status: string; message: string }>
    }

    expect(result.exitCode).toBe(1)
    expect(report.ok).toBe(false)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'api-health',
          status: 'fail',
          message: 'Health check returned HTTP 503.',
        }),
      ]),
    )
  })

  it('lists applications over HTTP with filters, pagination, sorting, and token auth', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 5,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(
      [
        'applications',
        'list',
        '--status',
        'needs_user_info',
        '--role',
        'backend',
        '--min-score',
        '6',
        '--sort',
        'company_asc',
        '--limit',
        '25',
        '--offset',
        '5',
        '--workspace',
        'workspace-1',
        '--json',
      ],
      { VALEDICTORIAN_API_TOKEN: 'token-1' },
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?status=needs_user_info&minScore=6&role=backend&sort=company_asc&limit=25&offset=5',
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer token-1',
        },
        method: 'GET',
      },
    )
  })

  it('requires and applies an explicit workspace for application list commands', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const missingWorkspace = await runCli(['applications', 'list', '--limit', '25'])
    const scoped = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--limit',
      '25',
    ])

    expect(missingWorkspace.exitCode).toBe(1)
    expect(missingWorkspace.stderr).toContain('--workspace is required')
    expect(scoped.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('accepts global --workspace before the command for workspace-scoped commands', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      '--workspace',
      'workspace-1',
      'applications',
      'list',
      '--limit',
      '25',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('resolves workspace names and fails when a workspace name is ambiguous', async () => {
    const workspaces = {
      items: [
        { id: 'workspace-alpha', name: 'Example Workspace', open: true, source: 'local' },
        { id: 'workspace-beta', name: 'Winter Search', open: false, source: 'local' },
      ],
    }
    const duplicateWorkspaces = {
      items: [
        { id: 'workspace-one', name: 'Example Workspace', open: true, source: 'local' },
        { id: 'workspace-two', name: 'Example Workspace', open: false, source: 'local' },
      ],
    }
    const applications = { items: [], total: 0, limit: 10, offset: 0, hasMore: false }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(workspaces))
    fetchMock.mockResolvedValueOnce(jsonResponse(applications))
    fetchMock.mockResolvedValueOnce(jsonResponse(duplicateWorkspaces))
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await runCli([
      'applications',
      'list',
      '--workspace',
      'example workspace',
      '--limit',
      '10',
      '--json',
    ])
    const ambiguous = await runCli([
      'applications',
      'list',
      '--workspace',
      'Example Workspace',
      '--limit',
      '10',
    ])

    expect(resolved.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-alpha/applications?limit=10',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(ambiguous.exitCode).toBe(1)
    expect(ambiguous.stderr).toContain('Workspace name is ambiguous: Example Workspace')
    expect(ambiguous.stderr).toContain('workspace-one')
    expect(ambiguous.stderr).toContain('workspace-two')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('formats resource commands as human text by default and supports leading --json', async () => {
    const payload = {
      items: [
        {
          id: 'application-1',
          companyName: 'Delta Labs',
          roleTitle: 'Software Engineering Intern',
          status: 'queued',
          priorityScore: 7,
          priorityBand: 'high',
        },
      ],
      total: 1,
      limit: 1,
      offset: 0,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(payload))
    fetchMock.mockResolvedValueOnce(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const textResult = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--limit',
      '1',
    ])

    expect(textResult.exitCode).toBe(0)
    expect(textResult.stdout).toContain('1 item - limit 1 - offset 0 - end reached')
    expect(textResult.stdout).toContain(
      'Delta Labs - Software Engineering Intern - status=queued - priority=7/high - id=application-1',
    )
    expect(() => JSON.parse(textResult.stdout)).toThrow()

    const jsonResult = await runCli([
      '--json',
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--limit',
      '1',
    ])

    expect(jsonResult.exitCode).toBe(0)
    expect(JSON.parse(jsonResult.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('lists action queue rows over HTTP with action bucket filtering, pagination, and token auth', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 5,
      hasMore: false,
      actionBucketCounts: { apply_now: 0 },
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(
      [
        'action-queue',
        'list',
        '--workspace',
        'workspace-1',
        '--action-bucket',
        'apply_now',
        '--limit',
        '25',
        '--offset',
        '5',
        '--json',
      ],
      { VALEDICTORIAN_API_TOKEN: 'token-1' },
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/action-queue?actionBucket=apply_now&limit=25&offset=5',
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer token-1',
        },
        method: 'GET',
      },
    )
  })

  it('gets applications, updates status, and records scores over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1', status: 'submitted' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'get',
        'application-1',
        '--workspace',
        'workspace-1',
        '--json',
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
    })
    await expect(
      runCli([
        'applications',
        'status',
        'application-1',
        'submitted',
        '--workspace',
        'workspace-1',
        '--notes',
        'Submitted from CLI.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'scores',
        'record',
        'application-1',
        '--score',
        '8',
        '--band',
        'high',
        '--role-relevance',
        '3',
        '--career-signal',
        '2',
        '--city-work-mode',
        '2',
        '--compensation-logistics',
        '1',
        '--rationale',
        'Strong fit.',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/status',
      expect.objectContaining({
        body: JSON.stringify({ status: 'submitted', notes: 'Submitted from CLI.' }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/scores',
      expect.objectContaining({
        body: expect.stringContaining('"applicationId":"application-1"') as string,
        method: 'POST',
      }),
    )
  })

  it('runs application mutation commands over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1', hasApplied: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1', notes: 'Reached review.' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'link-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'link-1', label: 'company site' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, limit: 50, offset: 0, hasMore: false }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'create',
        '--company-name',
        'Delta Labs',
        '--role-title',
        'Software Engineering Intern',
        '--source-name',
        'LinkedIn',
        '--role-kind',
        'internship',
        '--country',
        'US',
        '--work-mode',
        'remote',
        '--status',
        'queued',
        '--primary-url',
        'https://jobs.example.com/delta',
        '--initial-note',
        'Seeded by CLI.',
        '--workspace',
        'workspace-1',
        '--json',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'update',
        'application-1',
        '--role-title',
        'Software Engineering Intern II',
        '--has-applied',
        'true',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'workflow',
        'application-1',
        '--missing-user-info',
        'Start date',
        '--hold-started-at',
        '2026-06-04T16:00:00.000Z',
        '--manual-review-kind',
        'overridable',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'note',
        'application-1',
        '--workspace',
        'workspace-1',
        '--message',
        'Reached review.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'link',
        'add',
        'application-1',
        '--kind',
        'official',
        '--label',
        'official',
        '--url',
        'https://jobs.example.com/delta',
        '--primary',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'link',
        'update',
        'application-1',
        'link-1',
        '--workspace',
        'workspace-1',
        '--label',
        'company site',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'events',
        'application-1',
        '--workspace',
        'workspace-1',
        '--limit',
        '50',
        '--json',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'archive',
        'application-1',
        '--workspace',
        'workspace-1',
        '--note',
        'No longer pursuing.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications',
      expect.objectContaining({
        body: JSON.stringify({
          companyName: 'Delta Labs',
          roleTitle: 'Software Engineering Intern',
          sourceName: 'LinkedIn',
          roleKind: 'internship',
          country: 'US',
          workMode: 'remote',
          status: 'queued',
          primaryLink: {
            kind: 'official',
            label: 'official',
            url: 'https://jobs.example.com/delta',
          },
          initialNote: 'Seeded by CLI.',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1',
      expect.objectContaining({
        body: JSON.stringify({
          roleTitle: 'Software Engineering Intern II',
          hasApplied: true,
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/workflow',
      expect.objectContaining({
        body: JSON.stringify({
          holdStartedAt: '2026-06-04T16:00:00.000Z',
          manualReviewKind: 'overridable',
          missingUserInfo: 'Start date',
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/notes',
      expect.objectContaining({
        body: JSON.stringify({ message: 'Reached review.' }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/links',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/delta',
          isPrimary: true,
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/links/link-1',
      expect.objectContaining({
        body: JSON.stringify({ label: 'company site' }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/events?limit=50',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/archive',
      expect.objectContaining({
        body: JSON.stringify({ note: 'No longer pursuing.' }),
        method: 'PATCH',
      }),
    )
  })

  it('runs application attempt commands over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'attempt-1', status: 'in_progress' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'step-1', sequence: 2 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'attempt-1', status: 'completed' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 'attempt-1' }], total: 1, limit: 25, offset: 0, hasMore: false }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'attempts',
        'start',
        'application-1',
        '--actor-type',
        'agent',
        '--actor-name',
        'codex',
        '--summary',
        'Started.',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'attempts',
        'step',
        'application-1',
        'attempt-1',
        '--type',
        'page_verified',
        '--message',
        'Verified page.',
        '--actor',
        'agent:codex',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'attempts',
        'complete',
        'application-1',
        'attempt-1',
        '--outcome',
        'needs_user_info',
        '--summary',
        'Needs dates.',
        '--missing-user-info',
        'Fall 2026 dates',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'attempts',
        'list',
        'application-1',
        '--workspace',
        'workspace-1',
        '--limit',
        '25',
        '--json',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/attempts',
      expect.objectContaining({
        body: JSON.stringify({
          actorType: 'agent',
          actorName: 'codex',
          summary: 'Started.',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/attempts/attempt-1/steps',
      expect.objectContaining({
        body: JSON.stringify({
          type: 'page_verified',
          message: 'Verified page.',
          actor: 'agent:codex',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/attempts/attempt-1/complete',
      expect.objectContaining({
        body: JSON.stringify({
          outcome: 'needs_user_info',
          summary: 'Needs dates.',
          missingUserInfo: 'Fall 2026 dates',
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/attempts?limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('sends verification receipt attempt steps over HTTP with JSON payloads', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'step-1', sequence: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'attempts',
        'step',
        'application-1',
        'attempt-1',
        '--type',
        'verification_receipt',
        '--message',
        'Final review verification passed.',
        '--payload-json',
        JSON.stringify({
          version: 1,
          scope: 'final_review',
          status: 'passed',
          verified: ['resume_attachment', 'contact_info'],
          unresolved: [],
          evidence: 'Final review page showed resume and contact info.',
        }),
        '--actor',
        'agent:codex',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0]
    expect(requestUrl).toBe(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/attempts/attempt-1/steps',
    )
    expect(requestInit).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      type: 'verification_receipt',
      message: 'Final review verification passed.',
      actor: 'agent:codex',
      payload: {
        version: 1,
        scope: 'final_review',
        status: 'passed',
        verified: ['resume_attachment', 'contact_info'],
        unresolved: [],
        evidence: 'Final review page showed resume and contact info.',
      },
    })
  })

  it('shows submitted attempt completion examples with a verification receipt step', async () => {
    const result = await runCli([
      'examples',
      'attempts',
      'complete',
      '--outcome',
      'submitted',
      '--json',
    ])
    const examples = JSON.parse(result.stdout) as {
      complete: string
      note: string
      verificationReceiptStep: string
    }

    expect(result.exitCode).toBe(0)
    expect(examples.note).toContain('verification_receipt')
    expect(examples.verificationReceiptStep).toContain('--type verification_receipt')
    expect(examples.verificationReceiptStep).toContain('"scope":"final_review"')
    expect(examples.verificationReceiptStep).toContain('"status":"passed"')
    expect(examples.complete).toContain('--outcome submitted')
  })

  it('shows valid non-submitted attempt completion examples with required companion flags', async () => {
    const needsUserInfo = await runCli([
      'examples',
      'attempts',
      'complete',
      '--outcome',
      'needs_user_info',
      '--json',
    ])
    const platformError = await runCli([
      'examples',
      'attempts',
      'complete',
      '--outcome',
      'platform_error',
      '--json',
    ])

    expect(needsUserInfo.exitCode).toBe(0)
    expect(JSON.parse(needsUserInfo.stdout).complete).toContain(
      '--missing-user-info "Synthetic missing answer to collect from the user."',
    )
    expect(platformError.exitCode).toBe(0)
    expect(JSON.parse(platformError.stdout).complete).toContain(
      '--blocker-reason "Synthetic blocker reason."',
    )
  })

  it('rejects invalid attempt completion example outcomes', async () => {
    const stopped = await runCli([
      'examples',
      'attempts',
      'complete',
      '--outcome',
      'stopped',
      '--json',
    ])
    const blocked = await runCli([
      'examples',
      'attempts',
      'complete',
      '--outcome',
      'blocked',
      '--json',
    ])

    expect(stopped.exitCode).toBe(1)
    expect(stopped.stderr).toContain('Invalid attempt outcome: stopped')
    expect(blocked.exitCode).toBe(1)
    expect(blocked.stderr).toContain('Invalid attempt outcome: blocked')
  })

  it('rejects invalid CLI-only input before calling HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    const invalidSort = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--sort',
      'random_sort',
    ])
    const removedName = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--name',
      'astranis',
    ])
    const invalidDate = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--created-from',
      'tomorrow-ish',
    ])
    const invalidRoleKind = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'intern',
      '--country',
      'US',
      '--work-mode',
      'remote',
      '--status',
      'queued',
      '--primary-url',
      'https://jobs.example.com/delta',
      '--workspace',
      'workspace-1',
    ])
    const invalidWorkMode = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'internship',
      '--country',
      'US',
      '--work-mode',
      'distributed',
      '--status',
      'queued',
      '--primary-url',
      'https://jobs.example.com/delta',
      '--workspace',
      'workspace-1',
    ])
    const missingLink = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'internship',
      '--country',
      'US',
      '--work-mode',
      'remote',
      '--status',
      'queued',
      '--workspace',
      'workspace-1',
    ])
    const malformedUrl = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'internship',
      '--country',
      'US',
      '--work-mode',
      'remote',
      '--status',
      'queued',
      '--primary-url',
      'ftp://jobs.example.com/delta',
      '--workspace',
      'workspace-1',
    ])
    const invalidManualKind = await runCli([
      'applications',
      'workflow',
      'application-1',
      '--workspace',
      'workspace-1',
      '--manual-review-kind',
      'manual',
    ])
    const invalidWorkflowTimestamp = await runCli([
      'applications',
      'workflow',
      'application-1',
      '--workspace',
      'workspace-1',
      '--lock-started-at',
      'tomorrow-ish',
    ])
    const emptyUpdate = await runCli([
      'applications',
      'update',
      'application-1',
      '--workspace',
      'workspace-1',
    ])
    const blankNote = await runCli([
      'applications',
      'note',
      'application-1',
      '--workspace',
      'workspace-1',
      '--message',
      '   ',
    ])
    const invalidAttemptCompletion = await runCli([
      'applications',
      'attempts',
      'complete',
      'application-1',
      'attempt-1',
      '--workspace',
      'workspace-1',
      '--outcome',
      'needs_user_info',
    ])

    expect(invalidSort.exitCode).toBe(1)
    expect(invalidSort.stderr).toContain('Invalid application list sort: random_sort')
    expect(removedName.exitCode).toBe(1)
    expect(removedName.stderr).toContain('Use --search for broad text search or --role for role titles')
    expect(invalidDate.exitCode).toBe(1)
    expect(invalidDate.stderr).toContain('Invalid date for --created-from: tomorrow-ish')
    expect(invalidRoleKind.exitCode).toBe(1)
    expect(invalidRoleKind.stderr).toContain('Invalid roleKind: intern')
    expect(invalidWorkMode.exitCode).toBe(1)
    expect(invalidWorkMode.stderr).toContain('Invalid workMode: distributed')
    expect(missingLink.exitCode).toBe(1)
    expect(missingLink.stderr).toContain('Application creation requires a primaryLink or sourceLink')
    expect(malformedUrl.exitCode).toBe(1)
    expect(malformedUrl.stderr).toContain('Invalid application URL: ftp://jobs.example.com/delta')
    expect(invalidManualKind.exitCode).toBe(1)
    expect(invalidManualKind.stderr).toContain('Invalid manualReviewKind: manual')
    expect(invalidWorkflowTimestamp.exitCode).toBe(1)
    expect(invalidWorkflowTimestamp.stderr).toContain('Invalid lockStartedAt: tomorrow-ish')
    expect(emptyUpdate.exitCode).toBe(1)
    expect(emptyUpdate.stderr).toContain('Application metadata update requires at least one field')
    expect(blankNote.exitCode).toBe(1)
    expect(blankNote.stderr).toContain('note message is required')
    expect(invalidAttemptCompletion.exitCode).toBe(1)
    expect(invalidAttemptCompletion.stderr).toContain(
      'missingUserInfo is required for needs_user_info attempts',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
