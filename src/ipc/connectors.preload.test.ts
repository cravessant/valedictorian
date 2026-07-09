import { describe, expect, it } from 'vitest'
import { createConnectorsPreloadApi } from './connectors.preload'

describe('connectors preload API', () => {
  it('invokes connector lifecycle and run IPC channels', async () => {
    const invocations: unknown[][] = []
    const api = createConnectorsPreloadApi({
      invoke(...args) {
        invocations.push(args)

        if (args[0] === 'connectors:create' || args[0] === 'connectors:update') {
          return Promise.resolve({ id: 'connector-instance' })
        }

        if (args[0] === 'connectors:inspect') {
          return Promise.resolve({ id: 'connector-instance', status: 'healthy' })
        }

        if (args[0] === 'connectors:runs:trigger') {
          return Promise.resolve({ id: 'connector-run' })
        }

        return Promise.resolve({ items: [] })
      },
    })
    const createInput = {
      id: 'connector-instance',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.3.0',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [{ id: 'jobright', label: 'Jobright browser session', mode: 'browser_session' }],
      config: { publicFeedUrl: 'https://jobright.ai/jobs/recommend' },
      filters: { maxResolutionCount: 10, roleTerms: ['intern'] },
    } as const
    const updateInput = {
      connectorInstanceId: 'connector-instance',
      enabled: false,
    } as const
    const runsListInput = { connectorInstanceId: 'connector-instance', limit: 5 } as const
    const runTriggerInput = { connectorInstanceId: 'connector-instance', mode: 'manual' } as const

    await expect(api.list()).resolves.toEqual({ items: [] })
    await expect(api.create(createInput)).resolves.toEqual({ id: 'connector-instance' })
    await expect(api.update(updateInput)).resolves.toEqual({ id: 'connector-instance' })
    await expect(api.inspect('connector-instance')).resolves.toEqual({
      id: 'connector-instance',
      status: 'healthy',
    })
    await expect(api.runs.list(runsListInput)).resolves.toEqual({ items: [] })
    await expect(api.runs.trigger(runTriggerInput)).resolves.toEqual({ id: 'connector-run' })
    expect(invocations).toEqual([
      ['connectors:list'],
      ['connectors:create', createInput],
      ['connectors:update', updateInput],
      ['connectors:inspect', 'connector-instance'],
      ['connectors:runs:list', runsListInput],
      ['connectors:runs:trigger', runTriggerInput],
    ])
  })

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
