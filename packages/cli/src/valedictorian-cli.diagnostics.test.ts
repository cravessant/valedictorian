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
    expect(packageJson.dependencies?.cosmiconfig).toBe('9.0.2')
    expect(packageJson.dependencies?.sparxie).toBe('0.14.0')
    expect(packageJson.dependencies?.sparxie).not.toContain('github:')
    expect(packageJson.dependencies).not.toHaveProperty('conf')
    expect(packageJson.dependencies).not.toHaveProperty('configstore')
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

  it('prints discovered project config in read-only CLI context', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-project-config-'))
    fs.writeFileSync(
      path.join(projectRoot, 'valedictorian.config.json'),
      JSON.stringify({ version: 1, workspace: { name: '  Example Workspace  ' } }),
      'utf8',
    )

    const result = await runCli(['context', '--skip-network', '--json'], {}, { cwd: projectRoot })
    const context = JSON.parse(result.stdout) as {
      projectConfig: {
        config?: { version: number; workspace: { name?: string } }
        path?: string
        status: string
      }
    }

    expect(result.exitCode).toBe(0)
    expect(context.projectConfig).toEqual({
      config: {
        version: 1,
        workspace: {
          name: 'Example Workspace',
        },
      },
      path: path.join(projectRoot, 'valedictorian.config.json'),
      status: 'found',
    })
  })

  it('fails doctor diagnostics when discovered project config is invalid', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-invalid-config-'))
    fs.writeFileSync(
      path.join(projectRoot, '.valedictorianrc.json'),
      JSON.stringify({ version: 1, token: 'do-not-store-this-here' }),
      'utf8',
    )

    const result = await runCli(['doctor', '--skip-network', '--json'], {}, { cwd: projectRoot })
    const report = JSON.parse(result.stdout) as {
      checks: Array<{ message: string; name: string; status: string }>
      ok: boolean
      projectConfig: { message?: string; status: string }
    }

    expect(result.exitCode).toBe(1)
    expect(report.ok).toBe(false)
    expect(report.projectConfig).toMatchObject({
      message: 'Project config must not contain secret-like key: token',
      status: 'invalid',
    })
    expect(report.checks).toEqual(
      expect.arrayContaining([
        {
          message: 'Project config must not contain secret-like key: token',
          name: 'project-config',
          status: 'fail',
        },
      ]),
    )
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
})
