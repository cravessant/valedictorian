import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestLocalValedictorianClient as createLocalValedictorianClient } from '../../runtime/local-valedictorian-client.test-harness'
import { createTempDatabasePath } from '../../server/local-server.http-test-harness'
import { createDefaultLocalConnectorRegistry } from './connector.registry'

afterEach(() => vi.unstubAllGlobals())

const JOBRIGHT_TEST_FILTERS = {
  jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
}

describe('connector registry', () => {
  it('registers the exact released API-only Jobright connector', () => {
    const registry = createDefaultLocalConnectorRegistry()

    const connector = registry.get('jobright.resolver')

    expect(connector?.definition).toMatchObject({
      id: 'jobright.resolver',
      version: '0.18.1',
      capabilities: { fetchesPublicPages: false },
    })
    expect(registry.get('jobright.public')).toBeNull()
  })

  it('matches published SDK and connector package versions for Jobright API auth', () => {
    const appPackage = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      pnpm?: { overrides?: unknown }
      resolutions?: Record<string, unknown>
    }
    const sdkPackage = JSON.parse(
      fs.readFileSync(path.resolve('node_modules/@sparxie/sdk/package.json'), 'utf8'),
    ) as { version: string }
    const jobrightPackage = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/@sparxie/valedictorian-connectors-jobright/package.json'),
        'utf8',
      ),
    ) as {
      version: string
      dependencies?: Record<string, string>
    }
    const corePackage = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/@sparxie/valedictorian-connectors-core/package.json'),
        'utf8',
      ),
    ) as { version: string }
    const harnessPackage = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/@sparxie/valedictorian-connectors-test-harness/package.json'),
        'utf8',
      ),
    ) as { version: string }

    expect(appPackage.dependencies['@sparxie/sdk']).toBe('0.29.1')
    expect(appPackage.dependencies['@sparxie/valedictorian-connectors-jobright']).toBe('0.18.1')
    expect(appPackage.devDependencies['@sparxie/valedictorian-connectors-core']).toBe('0.18.1')
    expect(appPackage.devDependencies['@sparxie/valedictorian-connectors-test-harness']).toBe('0.18.1')
    expect(appPackage.pnpm?.overrides).toBeUndefined()
    expect(appPackage.resolutions).toBeUndefined()
    expect(appPackage).not.toHaveProperty('overrides')
    expect(sdkPackage.version).toBe('0.29.1')
    expect(jobrightPackage.version).toBe('0.18.1')
    expect(jobrightPackage.dependencies?.['@sparxie/valedictorian-connectors-core']).toBe('^0.18.1')
    expect(corePackage.version).toBe('0.18.1')
    expect(harnessPackage.version).toBe('0.18.1')
  })

  it('reaches the API-only connector and reports missing auth without provider or browser work', async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)
    const connector = createDefaultLocalConnectorRegistry().get('jobright.resolver')!

    const result = await connector.refresh({
      checkpoint: null,
      config: {},
      connectorInstanceId: 'jobright-default',
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-13T00:00:00.000Z' },
      executionScopeId: 'scope-jobright-production',
      filters: JOBRIGHT_TEST_FILTERS,
      mode: 'manual',
      workspaceId: 'workspace-production',
    }, {
      auth: {
        resolve: vi.fn(async () => ({
          id: 'jobright', mode: 'username_password' as const, status: 'missing' as const,
        })),
        refresh: vi.fn(async () => ({ status: 'action_required' as const, reason: 'auth_missing' })),
      },
    })

    expect(result).toMatchObject({
      operationOutcome: { kind: 'authentication_expired', requestRefresh: true },
      status: 'completed',
      stats: { authRequired: 1 },
    })
    expect(JSON.stringify(result)).not.toMatch(/password|cookie|bearer|token/i)
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('triggers the default production Jobright registry through the public local client', async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)
    const client = await createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() })
    await client.connectors.create({
      id: 'jobright-default', connectorId: 'jobright.resolver', connectorVersion: '0.18.1',
      displayName: 'Jobright internslist', enabled: true,
      auth: [{ id: 'jobright', label: 'Jobright credentials', mode: 'username_password' }],
      config: {}, filters: JOBRIGHT_TEST_FILTERS, earliestBackfillDate: '2026-07-01',
    })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-default',
      coverageEndedAt: '2026-07-13T12:00:00.000Z',
      mode: 'manual',
    })

    expect(run).toMatchObject({ status: 'completed', outcome: { kind: 'action_required' } })
    expect(await client.connectors.overview.list()).toMatchObject({
      items: [{ health: { status: 'authentication_required' } }],
    })
    expect(providerFetch).not.toHaveBeenCalled()
  })
})
