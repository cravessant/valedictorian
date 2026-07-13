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
    const reconnect = vi.fn(async () => ({
      action: 'reconnect',
      connectorInstanceId: 'connector-instance-fixture',
      grants: [{ id: 'fixture-session', mode: 'api_key', status: 'ready' }],
      message: 'Connector auth is ready.',
      status: 'ready',
    }))
    const skip = vi.fn(async () => ({
      action: 'skip',
      connectorInstanceId: 'connector-instance-fixture',
      message: 'Connector run skipped.',
      run: { id: 'connector-run-skipped', status: 'skipped' },
      status: 'skipped',
    }))
    const connectors = {
      status: {
        list: listStatus,
        reconnect,
        skip,
      },
    } as unknown as LocalValedictorianClient['connectors']
    const handlers = new Map<string, (_event: unknown) => Promise<unknown>>()

    registerConnectorsIpc(connectors, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('connectors:status:list')?.({})).resolves.toEqual(status)
    await expect(
      handlers.get('connectors:status:reconnect')?.(
        {},
        { connectorInstanceId: 'connector-instance-fixture' },
      ),
    ).resolves.toMatchObject({ action: 'reconnect', status: 'ready' })
    await expect(
      handlers.get('connectors:status:skip')?.(
        {},
        {
          connectorInstanceId: 'connector-instance-fixture',
          reason: 'user_skipped_auth_required_run',
        },
      ),
    ).resolves.toMatchObject({ action: 'skip', status: 'skipped' })
    expect(listStatus).toHaveBeenCalled()
    expect(reconnect).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance-fixture' })
    expect(skip).toHaveBeenCalledWith({
      connectorInstanceId: 'connector-instance-fixture',
      reason: 'user_skipped_auth_required_run',
    })
  })

  it('registers connector lifecycle and run handlers against the local client', async () => {
    const list = vi.fn(async () => ({ items: [] }))
    const create = vi.fn(async (input: unknown) => ({ id: 'connector-instance', input }))
    const update = vi.fn(async (input: unknown) => ({ id: 'connector-instance', input }))
    const inspect = vi.fn(async (connectorInstanceId: string) => ({
      id: connectorInstanceId,
      status: 'healthy',
    }))
    const listRuns = vi.fn(async (input: unknown) => ({ items: [], input }))
    const trigger = vi.fn(async (input: unknown) => ({ id: 'connector-run', input }))
    const connectors = {
      list,
      create,
      update,
      inspect,
      runs: {
        list: listRuns,
        trigger,
      },
      status: {
        list: vi.fn(),
        reconnect: vi.fn(),
        skip: vi.fn(),
      },
    } as unknown as LocalValedictorianClient['connectors']
    const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()

    registerConnectorsIpc(connectors, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('connectors:list')?.({})).resolves.toEqual({ items: [] })
    await expect(handlers.get('connectors:create')?.({}, { id: 'connector-instance' }))
      .resolves.toMatchObject({ id: 'connector-instance' })
    await expect(
      handlers.get('connectors:update')?.(
        {},
        { connectorInstanceId: 'connector-instance', enabled: false },
      ),
    ).resolves.toMatchObject({ id: 'connector-instance' })
    await expect(handlers.get('connectors:inspect')?.({}, 'connector-instance'))
      .resolves.toMatchObject({ id: 'connector-instance', status: 'healthy' })
    await expect(
      handlers.get('connectors:runs:list')?.({}, { connectorInstanceId: 'connector-instance' }),
    ).resolves.toMatchObject({ items: [] })
    await expect(
      handlers.get('connectors:runs:trigger')?.(
        {},
        { connectorInstanceId: 'connector-instance', mode: 'manual' },
      ),
    ).resolves.toMatchObject({ id: 'connector-run' })

    expect(list).toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ id: 'connector-instance' })
    expect(update).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance', enabled: false })
    expect(inspect).toHaveBeenCalledWith('connector-instance')
    expect(listRuns).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance' })
    expect(trigger).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance', mode: 'manual' })
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
