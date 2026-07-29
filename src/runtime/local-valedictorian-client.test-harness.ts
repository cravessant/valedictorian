import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { prepareConfiguredPgliteDataPath } from '../test/pglite-template'
import { useResettablePgliteTestOwner } from '../test/pglite-test-owner'
import {
  createPgliteClient,
  createPgliteDatabase,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../db/pglite'
import { completedConnectorRefreshContract } from '../modules/connectors/public'
import type { AppJobConnector } from '../modules/connectors/public'
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

/**
 * Temporary PGlite directory whose removal this harness owns, while the caller keeps
 * explicit control over the path value and over when clients open and close on it.
 */
export function createOwnedTestPgliteDataPath(prefix = 'valedictorian-test-pglite-') {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  activeTempPaths.add(dataPath)
  return dataPath
}

export function useTestMissingReferenceTrackerPath() {
  const originalPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalPath
    }
  })
}

export type TestLocalValedictorianClientOptions = Omit<
  LocalValedictorianClientOptions,
  'database' | 'pgliteDataPath'
> & { database?: PgliteDatabase; pgliteDataPath?: string }

export async function createTestLocalValedictorianClient(
  options: TestLocalValedictorianClientOptions = {},
) {
  const pgliteDataPath = options.pgliteDataPath
    ?? fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-test-pglite-'))
  const profilePath = options.profilePath ?? path.join(pgliteDataPath, 'profile.json')
  if (!options.pgliteDataPath) activeTempPaths.add(pgliteDataPath)
  if (options.database) {
    const client = await createLocalValedictorianClient({
      ...options,
      database: options.database,
      pgliteDataPath,
      profilePath,
    })
    databasesByClient.set(client, options.database)
    if (!options.pgliteDataPath) tempPathsByClient.set(client, pgliteDataPath)
    return client
  }
  const clonedFromTemplate = prepareConfiguredPgliteDataPath(pgliteDataPath)
  const pglite = await createPgliteClient({ dataDir: pgliteDataPath })
  activePgliteClients.add(pglite)
  if (!options.pgliteDataPath) tempPathsByPglite.set(pglite, pgliteDataPath)
  try {
    const database = clonedFromTemplate
      ? createPgliteDatabase(pglite)
      : await migratePgliteDatabase(pglite)
    const client = await createLocalValedictorianClient({
      ...options,
      database,
      pgliteDataPath,
      profilePath,
    })
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

export function useResettablePgliteTestLocalValedictorianClient() {
  const getOwner = useResettablePgliteTestOwner()
  return (
    options: Omit<TestLocalValedictorianClientOptions, 'database' | 'pgliteDataPath'> = {},
  ) => createTestLocalValedictorianClient({
    ...options,
    database: getOwner().database,
  })
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
  const pgliteDataPath = dataDir
    ?? fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-test-pglite-'))
  if (!dataDir) activeTempPaths.add(pgliteDataPath)
  const clonedFromTemplate = prepareConfiguredPgliteDataPath(pgliteDataPath)
  const pglite = await createPgliteClient({ dataDir: pgliteDataPath })
  activePgliteClients.add(pglite)
  if (!dataDir) tempPathsByPglite.set(pglite, pgliteDataPath)
  const database = clonedFromTemplate
    ? createPgliteDatabase(pglite)
    : await migratePgliteDatabase(pglite)
  return {
    database,
    async close() {
      if (!activePgliteClients.delete(pglite)) return
      await pglite.close()
      cleanTestPglitePath(pglite)
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

const FIXTURE_JOBS_CONNECTOR_ID = 'fixture.jobs'
const FIXTURE_JOBS_CONNECTOR_VERSION = '0.0.0-fixture'

export interface FixtureJobsConnectorOptions {
  /** Instant stamped on every returned observation, its evidence, and the next cursor. */
  observedAt: string
  /** Held before refresh produces a result, so callers can observe non-terminal run state. */
  gateRefreshUntil?: Promise<void>
  /** Makes refresh throw instead of returning a completed result. */
  failRefresh?: boolean
  /** One observation per name, in order; an empty name exercises invalid legacy input. */
  observationCompanyNames?: readonly string[]
}

export function createTestFixtureJobsConnector({
  observedAt,
  gateRefreshUntil,
  failRefresh = false,
  observationCompanyNames = ['Example Robotics'],
}: FixtureJobsConnectorOptions): AppJobConnector {
  return {
    definition: {
      id: FIXTURE_JOBS_CONNECTOR_ID,
      version: FIXTURE_JOBS_CONNECTOR_VERSION,
    },
    async refresh(input) {
      await gateRefreshUntil

      if (failRefresh) {
        throw new Error('Fixture connector refresh failed')
      }
      const observations = observationCompanyNames.map(
        (companyName, index) => fixtureJobsObservation(companyName, index, observedAt),
      )

      return {
        ...completedConnectorRefreshContract(input.coverage.start.slice(0, 10)),
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: {
            cursor: `fixture:${observedAt}`,
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations,
        stats: {
          observations: observations.length,
        },
        warnings: [],
      }
    },
  }
}

function fixtureJobsObservation(companyName: string, index: number, observedAt: string) {
  const slug = index === 0
    ? 'software-engineering-intern'
    : `software-engineering-intern-${index + 1}`

  return {
    connectorId: FIXTURE_JOBS_CONNECTOR_ID,
    connectorVersion: FIXTURE_JOBS_CONNECTOR_VERSION,
    parserVersion: 'fixture-parser@1',
    observationSchemaVersion: 'job-observation@1',
    sourceRecordKey: `${FIXTURE_JOBS_CONNECTOR_ID}:${slug}`,
    observedAt,
    companyName,
    roleTitle: 'Software Engineering Intern',
    locationRaw: 'Remote',
    descriptionText: 'Build fixture robots and connector proofs.',
    pay: null,
    links: {
      source: `https://example.test/jobs/${slug}`,
      intermediary: null,
      official: `https://jobs.example.com/apply/${slug}`,
    },
    resolution: {
      status: 'resolved' as const,
      method: 'fixture',
      reason: null,
    },
    dedupeKeys: [`official:https://jobs.example.com/apply/${slug}`],
    sourceMetadata: {
      fixture: true,
      destinationClass: 'employer_or_ats',
    },
    evidence: [
      {
        type: 'fixture',
        capturedAt: observedAt,
        sourceUrl: `https://example.test/jobs/${slug}`,
      },
    ],
  }
}
