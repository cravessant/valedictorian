import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultLocalConnectorPorts,
  createJitterDelayRuntime,
  createUnavailableBrowserSessionRuntime,
} from './connector.runtime-ports'

describe('connector runtime ports', () => {
  it('waits for a jittered duration without hard-coding wall-clock sleeps', async () => {
    const sleep = vi.fn(async () => undefined)
    const delay = createJitterDelayRuntime({
      random: () => 0.25,
      sleep,
    })

    await expect(delay.wait({
      minDelayMs: 1_000,
      maxDelayMs: 5_000,
      reason: 'jobright_resolution',
    })).resolves.toBe(2_000)

    expect(sleep).toHaveBeenCalledWith(2_000)
  })

  it('makes the unavailable browser-session boundary explicit and actionable', async () => {
    const browserSession = createUnavailableBrowserSessionRuntime()

    await expect(browserSession.resolveLink({
      sessionId: 'local-session',
      source: 'jobright',
      url: 'https://jobright.ai/jobs/info/job-123',
    })).resolves.toEqual({
      method: 'local_browser_session_unavailable',
      officialUrl: null,
      reason: 'browser_session_runtime_unavailable',
      status: 'auth_required',
    })
  })

  it('creates default local connector ports with explicit auth and runtime boundaries', async () => {
    const sleep = vi.fn(async () => undefined)
    const ports = createDefaultLocalConnectorPorts({
      random: () => 0,
      sleep,
    })

    const grant = await ports.connectorAuth.browserSessions?.resolve({
      id: 'jobright',
      label: 'Jobright browser session',
      mode: 'browser_session',
      sessionKey: 'workspace-session',
    })

    expect(grant).toEqual({
      id: 'jobright',
      mode: 'browser_session',
      reason: 'browser_session_action_required',
      sessionKey: 'workspace-session',
      status: 'action_required',
    })
    expect(grant).not.toHaveProperty('sessionId')

    await expect(ports.connectorRuntime.delay?.wait({
      minDelayMs: 1_000,
      maxDelayMs: 10_000,
      reason: 'jobright_resolution',
    })).resolves.toBe(1_000)

    expect(sleep).toHaveBeenCalledWith(1_000)
    expect(ports.connectorRuntime.browserSession).toBeDefined()
  })
})
