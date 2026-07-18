import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../db/pglite'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClient,
  type LocalValedictorianClientOptions,
} from './local-valedictorian-client'

const activePgliteClients = new Set<PgliteClient>()
const activeTempPaths = new Set<string>()
const tempPathsByPglite = new WeakMap<PgliteClient, string>()
const tempPathsByClient = new WeakMap<LocalValedictorianClient, string>()
const databasesByClient = new WeakMap<LocalValedictorianClient, PgliteDatabase>()
const pgliteByClient = new WeakMap<LocalValedictorianClient, PgliteClient>()

afterEach(async () => {
  const clients = [...activePgliteClients]
  await Promise.all(clients.map((client) => client.close()))
  activePgliteClients.clear()
  for (const client of clients) cleanTestPglitePath(client)
  for (const tempPath of activeTempPaths) cleanTempPath(tempPath)
})

export type TestLocalValedictorianClientOptions = Omit<
  LocalValedictorianClientOptions,
  'database'
> & { database?: PgliteDatabase }

export async function createTestLocalValedictorianClient(
  options: TestLocalValedictorianClientOptions = {},
) {
  const pgliteDataPath = options.pgliteDataPath
    ?? fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-test-pglite-'))
  if (!options.pgliteDataPath) activeTempPaths.add(pgliteDataPath)
  if (options.database) {
    const client = await createLocalValedictorianClient({
      ...options,
      database: options.database,
      pgliteDataPath,
    })
    databasesByClient.set(client, options.database)
    if (!options.pgliteDataPath) tempPathsByClient.set(client, pgliteDataPath)
    return client
  }
  const pglite = await createPgliteClient({ dataDir: pgliteDataPath })
  activePgliteClients.add(pglite)
  if (!options.pgliteDataPath) tempPathsByPglite.set(pglite, pgliteDataPath)
  try {
    const database = await migratePgliteDatabase(pglite)
    const client = await createLocalValedictorianClient({ ...options, database, pgliteDataPath })
    databasesByClient.set(client, database)
    pgliteByClient.set(client, pglite)
    if (!options.pgliteDataPath) tempPathsByClient.set(client, pgliteDataPath)
    return client
  } catch (error) {
    activePgliteClients.delete(pglite)
    await pglite.close()
    cleanTestPglitePath(pglite)
    throw error
  }
}

export function getTestLocalValedictorianDatabase(client: LocalValedictorianClient) {
  const database = databasesByClient.get(client)
  if (!database) throw new Error('Test local client database is not registered')
  return database
}

export async function closeTestLocalValedictorianClient(client: LocalValedictorianClient) {
  const pglite = pgliteByClient.get(client)
  databasesByClient.delete(client)
  pgliteByClient.delete(client)
  const tempPath = tempPathsByClient.get(client)
  tempPathsByClient.delete(client)
  if (pglite) {
    activePgliteClients.delete(pglite)
    await pglite.close()
    cleanTestPglitePath(pglite)
  }
  if (tempPath) cleanTempPath(tempPath)
}

export async function createTestPgliteDatabase(dataDir?: string) {
  const pglite = await createPgliteClient({ dataDir })
  activePgliteClients.add(pglite)
  const database = await migratePgliteDatabase(pglite)
  return {
    database,
    async close() {
      if (!activePgliteClients.delete(pglite)) return
      await pglite.close()
    },
  }
}

function cleanTestPglitePath(pglite: PgliteClient) {
  const tempPath = tempPathsByPglite.get(pglite)
  if (!tempPath) return
  tempPathsByPglite.delete(pglite)
  cleanTempPath(tempPath)
}

function cleanTempPath(tempPath: string) {
  activeTempPaths.delete(tempPath)
  fs.rmSync(tempPath, { force: true, recursive: true })
}

export async function createTestConnectorCaptureFixture(
  client: LocalValedictorianClient,
  connectorId: string,
  connectorVersion: string,
) {
  const repository = createPgliteConnectorRepository(getTestLocalValedictorianDatabase(client))
  const suffix = randomUUID()
  const instance = await repository.upsertInstance({
    id: `fixture-instance-${suffix}`,
    connectorId,
    connectorVersion,
    displayName: 'Fixture connector',
    enabled: true,
  })
  const request = await repository.recordRunRequest({
    connectorInstanceId: instance.id,
    mode: 'manual',
    startedAt: '2026-07-10T11:59:00.000Z',
  })
  return {
    connectorInstanceId: instance.id,
    connectorRunId: request.run.id,
    executionScopeId: instance.executionScopeId,
  }
}
