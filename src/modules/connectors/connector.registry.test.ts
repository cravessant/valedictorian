import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalValedictorianClient } from '../../runtime/local-valedictorian-client'
import { createTempSqlitePath } from '../../server/local-server.http-test-harness'
import { createDefaultLocalConnectorRegistry } from './connector.registry'

afterEach(() => vi.unstubAllGlobals())

describe('connector registry', () => {
  it('registers the exact released API-only Jobright connector', () => {
    const registry = createDefaultLocalConnectorRegistry()

    const connector = registry.get('jobright.resolver')

    expect(connector?.definition).toMatchObject({
      id: 'jobright.resolver',
      version: '0.11.0',
      capabilities: { fetchesPublicPages: false },
    })
    expect(registry.get('jobright.public')).toBeNull()
  })

  it('matches published sparxie and connector package versions for Jobright API auth', () => {
    const appPackage = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const sparxiePackage = JSON.parse(
      fs.readFileSync(path.resolve('node_modules/sparxie/package.json'), 'utf8'),
    ) as { version: string }
    const jobrightPackage = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/@sparxie/valedictorian-connectors-jobright/package.json'),
        'utf8',
      ),
    ) as { version: string }
    const corePackage = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/@sparxie/valedictorian-connectors-core/package.json'),
        'utf8',
      ),
    ) as { version: string }

    expect(appPackage.dependencies.sparxie).toBe('0.21.0')
    expect(appPackage.dependencies['@sparxie/valedictorian-connectors-jobright']).toBe('0.11.0')
    expect(appPackage.devDependencies['@sparxie/valedictorian-connectors-core']).toBe('0.11.0')
    expect(sparxiePackage.version).toBe('0.21.0')
    expect(jobrightPackage.version).toBe('0.11.0')
    expect(corePackage.version).toBe('0.11.0')
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
      filters: {},
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
    const client = createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() })
    await client.connectors.create({
      id: 'jobright-default', connectorId: 'jobright.resolver', connectorVersion: '0.11.0',
      displayName: 'Jobright internslist', enabled: true,
      auth: [{ id: 'jobright', label: 'Jobright credentials', mode: 'username_password' }],
      config: {}, filters: {}, earliestBackfillDate: '2026-07-01',
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
