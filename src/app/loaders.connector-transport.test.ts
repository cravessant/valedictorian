import { afterEach, describe, expect, it } from 'vitest'
import type { RendererBackendState } from '../ipc/valedictorian-http.preload'
import { createLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from '../server/local-server'
import { createTempSqlitePath } from '../server/local-server.http-test-harness'
import { defaultConnectorsApi } from './loaders'

const activeServers = new Set<StartedValedictorianHttpServer>()

afterEach(async () => {
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
  await Promise.all([...activeServers].map((server) => server.close()))
  activeServers.clear()
})
describe('renderer connector transport', () => {
  it('reuses the renderer across an unreachable origin and recovery on a new endpoint', async () => {
    const client = createConnectorClient()
    const first = await start(client)
    let state: RendererBackendState = { origin: first.url, status: 'available' }
    installRendererBinding(first.url, () => state)
    await defaultConnectorsApi.create(jobrightCreateInput())
    await first.close()
    activeServers.delete(first)
    state = { status: 'unavailable' }
    await expect(defaultConnectorsApi.list()).rejects.toThrow(/backend unavailable/i)
    const recovered = await start(client)
    state = { origin: recovered.url, status: 'available' }
    await expect(defaultConnectorsApi.list()).resolves.toMatchObject({
      items: [{ id: 'jobright-default' }],
    })
  })
  it('creates and lists Jobright through the real workspace-scoped HTTP transport', async () => {
    const client = createConnectorClient()
    const server = await start(client)
    installRendererBinding(server.url, () => ({ origin: server.url, status: 'available' }))
    await defaultConnectorsApi.create(jobrightCreateInput())
    await expect(defaultConnectorsApi.list()).resolves.toMatchObject({
      items: [{ connectorId: 'jobright.resolver', id: 'jobright-default' }],
    })
  })
  it('rejects duplicate Jobright creation without resetting the configured instance', async () => {
    const client = createConnectorClient()
    const server = await start(client)
    installRendererBinding(server.url, () => ({ origin: server.url, status: 'available' }))
    await defaultConnectorsApi.create(jobrightCreateInput())
    await expect(defaultConnectorsApi.create({
      ...jobrightCreateInput(),
      displayName: 'Reset attempt',
      enabled: false,
    })).rejects.toMatchObject({ status: 409 })
    await expect(defaultConnectorsApi.list()).resolves.toMatchObject({
      items: [{ displayName: 'Jobright internslist', enabled: true }],
    })
  })

  it('atomically admits one of two concurrent same-id creates without losing the winner', async () => {
    const sqlitePath = createTempSqlitePath()
    const clients = [
      createLocalValedictorianClient({ sqlitePath }),
      createLocalValedictorianClient({ sqlitePath }),
    ]
    const inputs = [
      jobrightCreateInput(),
      { ...jobrightCreateInput(), displayName: 'Concurrent contender', enabled: false },
    ]

    const outcomes = await Promise.allSettled(inputs.map((input, index) =>
      clients[index]!.connectors.create(input),
    ))
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { statusCode: 409 } })
    await expect(clients[0]!.connectors.list()).resolves.toMatchObject({
      items: [{
        displayName: fulfilled[0]!.status === 'fulfilled' && fulfilled[0].value.displayName,
        enabled: fulfilled[0]!.status === 'fulfilled' && fulfilled[0].value.enabled,
      }],
    })
  })
})
async function start(client: ReturnType<typeof createLocalValedictorianClient>) {
  const server = await createValedictorianHttpServer({ client, host: '127.0.0.1', port: 0 })
  activeServers.add(server)
  return server
}
function installRendererBinding(
  initialOrigin: string,
  getBackendState: () => RendererBackendState,
) {
  ;(window as Window & { valedictorianHttp?: unknown }).valedictorianHttp = {
    apiBaseUrl: initialOrigin,
    getBackendState,
    onBackendStateChanged: () => () => undefined,
    workspaceId: 'workspace-transport',
  }
}
function jobrightCreateInput() {
  return {
    id: 'jobright-default',
    connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0',
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [{ id: 'jobright', label: 'Jobright credentials', mode: 'username_password' as const }],
    config: {},
    filters: {},
  }
}
function createConnectorClient() {
  return createLocalValedictorianClient({
    sqlitePath: createTempSqlitePath(),
  })
}
