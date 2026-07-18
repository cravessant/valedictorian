import { describe, expect, it, vi } from 'vitest'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
  createSeededLocalClient,
  createTempDatabasePath,
  isolateReferenceTrackerEnvironment,
  readJson,
  startBoundaryServer,
} from './local-server.http-test-harness'

describe('local server HTTP test harness', () => {
  it('provides a temporary database path and seeded real local client', async () => {
    const pgliteDataPath = createTempDatabasePath()
    expect(pgliteDataPath).toMatch(/valedictorian-server-/)
    const client = await createSeededLocalClient({ pgliteDataPath })
    expect(client.applications).toBeDefined()
  })

  it('starts a public HTTP boundary with typed workspace overrides', async () => {
    const client = createBoundaryWorkspaceClient(() => {}, {
      applications: {
        ...createBoundaryWorkspaceClient(() => {}).applications,
        async list() {
          return { items: [], total: 0, limit: 25, offset: 0, hasMore: false }
        },
      },
    })
    const server = await startBoundaryServer(client)
    try {
      const response = await fetch(`${server.url}/v1/workspaces/test/applications`)
      expect(response.status).toBe(200)
      expect(await readJson(response)).toEqual({ items: [], total: 0, limit: 25, offset: 0, hasMore: false })
    } finally {
      await server.close()
    }
  })

  it('isolates and restores the reference-tracker environment', () => {
    const original = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    const restore = isolateReferenceTrackerEnvironment()
    expect(process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH).toContain('valedictorian-missing-reference-tracker.md')
    restore()
    expect(process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH).toBe(original)
  })

  it('owns environment and server lifecycle through setup and teardown', async () => {
    const original = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    const fixture = createLocalServerHttpTestFixture()
    fixture.setup()
    const server = await fixture.start({ client: createBoundaryWorkspaceClient(() => {}) })

    expect(process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH).toContain('valedictorian-missing-reference-tracker.md')
    expect((await fetch(`${server.url}/v1/health`)).status).toBe(200)

    await fixture.teardown()

    expect(process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH).toBe(original)
    await expect(fetch(`${server.url}/v1/health`)).rejects.toThrow()
  })

  it('publishes listener closure to lifecycle supervisors', async () => {
    const server = await startBoundaryServer(createBoundaryWorkspaceClient(() => {}))
    const onClosed = vi.fn()
    server.onClosed(onClosed)

    await server.close()

    expect(onClosed).toHaveBeenCalledTimes(1)
  })
})
