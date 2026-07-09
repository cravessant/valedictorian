import { describe, expect, it } from 'vitest'
import { createConnectorsPreloadApi } from './connectors.preload'

describe('connectors preload API', () => {
  it('invokes the connector status IPC channel', async () => {
    const invocations: unknown[][] = []
    const api = createConnectorsPreloadApi({
      invoke(...args) {
        invocations.push(args)
        if (args[0] === 'connectors:status:reconnect') {
          return Promise.resolve({ action: 'reconnect', status: 'ready' })
        }

        if (args[0] === 'connectors:status:skip') {
          return Promise.resolve({ action: 'skip', status: 'skipped' })
        }

        return Promise.resolve({ items: [] })
      },
    })

    await expect(api.status.list()).resolves.toEqual({ items: [] })
    await expect(
      api.status.reconnect({ connectorInstanceId: 'connector-instance-fixture' }),
    ).resolves.toEqual({ action: 'reconnect', status: 'ready' })
    await expect(
      api.status.skip({
        connectorInstanceId: 'connector-instance-fixture',
        reason: 'user_skipped_auth_required_run',
      }),
    ).resolves.toEqual({ action: 'skip', status: 'skipped' })
    expect(invocations).toEqual([
      ['connectors:status:list'],
      ['connectors:status:reconnect', { connectorInstanceId: 'connector-instance-fixture' }],
      [
        'connectors:status:skip',
        {
          connectorInstanceId: 'connector-instance-fixture',
          reason: 'user_skipped_auth_required_run',
        },
      ],
    ])
  })
})
