import { describe, expect, it, vi } from 'vitest'
import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { registerConnectorsIpc } from './connectors.ipc'

describe('connectors IPC registration', () => {
  it('registers a connector status handler against the local client', async () => {
    const status = {
      available: true,
      items: [
        {
          id: 'connector-instance-fixture',
          connectorId: 'fixture.jobs',
          displayName: 'Fixture Jobs',
          enabled: true,
          lastRunAt: '2026-07-08T17:00:01.000Z',
          latestRunId: 'connector-run-1',
          observationCount: 0,
          severity: 'blocked',
          status: 'auth_required',
          statusLabel: 'Auth required',
          summary: 'Reconnect the connector session to continue refreshes.',
          warningCount: 1,
          warnings: [],
          actionLabel: 'Reconnect',
          actions: [{ id: 'reconnect', label: 'Reconnect' }],
        },
      ],
    } as const
    const listStatus = vi.fn(async () => status)
    const connectors = {
      status: {
        list: listStatus,
      },
    } as unknown as LocalValedictorianClient['connectors']
    const handlers = new Map<string, (_event: unknown) => Promise<unknown>>()

    registerConnectorsIpc(connectors, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('connectors:status:list')?.({})).resolves.toEqual(status)
    expect(listStatus).toHaveBeenCalled()
  })

  it('returns an empty connector status list when local connectors are unavailable', async () => {
    const handlers = new Map<string, (_event: unknown) => Promise<unknown>>()

    registerConnectorsIpc(null, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('connectors:status:list')?.({})).resolves.toEqual({
      available: false,
      items: [],
    })
  })
})
