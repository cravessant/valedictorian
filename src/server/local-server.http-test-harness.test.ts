import { describe, expect, it, vi } from 'vitest'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
  isolateReferenceTrackerEnvironment,
  startBoundaryServer,
} from './local-server.http-test-harness'

describe('local server HTTP test harness', () => {
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

  it('coalesces concurrent and repeated listener closure', async () => {
    const server = await startBoundaryServer(createBoundaryWorkspaceClient(() => {}))
    const onClosed = vi.fn()
    server.onClosed(onClosed)

    await Promise.all([server.close(), server.close()])
    await server.close()

    expect(onClosed).toHaveBeenCalledTimes(1)
  })
})
