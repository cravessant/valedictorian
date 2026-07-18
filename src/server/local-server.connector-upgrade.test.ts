import { afterEach, describe, expect, it } from 'vitest'
import { createHttpValedictorianClient } from 'sparxie'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import type { AppJobConnector } from '../modules/connectors/connector.runner'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import {
  closeLocalValedictorianClient,
  createLocalValedictorianClient,
  getLocalValedictorianTestDatabase,
} from './local-valedictorian-client.test-harness'
import {
  createScheduleHttpTempDatabasePath,
  createValedictorianHttpServer,
  type ScheduleHttpServerHandle,
} from './local-server.connector-schedules.http-fixture'

const CLOCK = '2026-07-13T15:00:00.000Z'
const CONNECTOR_ID = 'jobright.resolver'
const INSTANCE_ID = 'persisted-jobright'
const OLD_PACKAGE_VERSION = '0.11.0'
const NEW_PACKAGE_VERSION = '0.12.0'
const CHECKPOINT_SCHEMA_VERSION = 'jobright-resolution-checkpoint@5'
const OLD_FILTER_SIGNATURE = `provider-state:${CONNECTOR_ID}@${OLD_PACKAGE_VERSION}`
const NEW_FILTER_SIGNATURE = `provider-state:${CONNECTOR_ID}@${NEW_PACKAGE_VERSION}`
const WORKSPACE_ID = 'connector-upgrade'

describe('persisted connector package upgrades', () => {
  let server: ScheduleHttpServerHandle | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('reconciles a trusted newer package and resumes its durable provider checkpoint through HTTP', async () => {
    const pgliteDataPath = createScheduleHttpTempDatabasePath()
    const oldConnector = createUpgradeConnector(OLD_PACKAGE_VERSION)
    const oldClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([oldConnector]),
      normalizationRegistry: createUpgradeNormalizationRegistry(false),
      now: () => new Date(CLOCK),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: WORKSPACE_ID,
    })
    await oldClient.connectors.create({
      id: INSTANCE_ID,
      connectorId: CONNECTOR_ID,
      connectorVersion: OLD_PACKAGE_VERSION,
      displayName: 'Persisted Jobright',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-login' }],
      config: { discoveryCount: 20, maxRunElapsedMs: 90_000 },
      filters: {},
      earliestBackfillDate: '2026-06-01',
    })
    const oldRun = await oldClient.connectors.runs.trigger({
      connectorInstanceId: INSTANCE_ID,
      mode: 'manual',
    })
    const capture = {
        connectorInstanceId: INSTANCE_ID,
        connectorRunId: oldRun.id,
        executionScopeId: oldRun.executionScopeId,
    }
    const intake = await oldClient.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: CONNECTOR_ID, kind: 'connector', version: OLD_PACKAGE_VERSION },
      capture,
      observedAt: '2026-07-12T14:00:00.000Z',
      providerRecordId: 'persisted-unresolved-job',
      payload: {
        companyName: 'Upgrade Robotics',
        roleTitle: 'Software Engineering Intern',
        providerDetailUrl: 'https://jobs.lever.co/upgrade-robotics/intern-1',
      },
    }, {
      adapter: { id: CONNECTOR_ID, kind: 'connector', version: OLD_PACKAGE_VERSION },
      capture,
      observedAt: '2026-07-12T14:01:00.000Z',
      providerRecordId: 'persisted-resolved-job',
      payload: {
        companyName: 'Already Resolved Robotics',
        roleTitle: 'Software Engineering Intern',
        applicationUrl: 'https://jobs.ashbyhq.com/already-resolved/intern-2',
      },
    }] })
    await expect(oldClient.sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId))
      .resolves.toMatchObject({
        canonicalCandidate: null,
        gate: { status: 'needs_enrichment', missingFields: ['destinationUrl'] },
      })
    const resolvedBeforeUpgrade = await oldClient.sourcing.rawRecords.normalization.get(
      intake.receipts[1].rawRecordId,
    )
    expect(resolvedBeforeUpgrade.gate.status).toBe('passed')

    const repository = createPgliteConnectorRepository(
      getLocalValedictorianTestDatabase(oldClient),
    )
    await repository.recordCheckpoint({
      connectorInstanceId: INSTANCE_ID,
      filterSignature: OLD_FILTER_SIGNATURE,
      checkpoint: {
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        checkpoint: {
          discoveryPage: 3,
          discoveryPosition: 60,
          pendingDetailRetries: [],
          processedSourceIds: Array.from({ length: 62 }, (_, index) => `processed-${index + 1}`),
          retryState: [],
          seenSourceIds: Array.from({ length: 67 }, (_, index) => `seen-${index + 1}`),
        },
      },
      coverage: { start: '2026-06-01T00:00:00.000Z', end: '2026-07-12T15:00:00.000Z' },
      savedAt: '2026-07-12T15:00:00.000Z',
    })
    await closeLocalValedictorianClient(oldClient)

    const receivedCheckpoints: unknown[] = []
    const newConnector = createUpgradeConnector(NEW_PACKAGE_VERSION, (checkpoint) => {
      receivedCheckpoints.push(checkpoint)
    })
    const upgradedClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([newConnector]),
      normalizationRegistry: createUpgradeNormalizationRegistry(true),
      now: () => new Date(CLOCK),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: WORKSPACE_ID,
    })
    server = await createValedictorianHttpServer({
      client: upgradedClient,
      host: '127.0.0.1',
      port: 0,
      resolveWorkspaceClient: async () => upgradedClient,
    })
    const http = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(WORKSPACE_ID)

    await expect(http.connectors.runs.trigger({
      connectorInstanceId: INSTANCE_ID,
      mode: 'manual',
    })).resolves.toMatchObject({
      connectorInstanceId: INSTANCE_ID,
      filterSignature: NEW_FILTER_SIGNATURE,
      status: 'completed',
    })

    expect(receivedCheckpoints[0]).toMatchObject({
      discoveryPage: 3,
      discoveryPosition: 60,
      processedSourceIds: expect.arrayContaining(['processed-62']),
      seenSourceIds: expect.arrayContaining(['seen-67']),
    })
    const unresolvedAfterUpgrade = await http.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(unresolvedAfterUpgrade.status).toBe('completed')
    const resolvedAfterUpgrade = await http.sourcing.rawRecords.normalization.get(
      intake.receipts[1].rawRecordId,
    )
    expect(resolvedAfterUpgrade.status).toBe('completed')
    await expect(upgradedClient.connectors.list()).resolves.toMatchObject({
      items: [{
        id: INSTANCE_ID,
        connectorId: CONNECTOR_ID,
        connectorVersion: NEW_PACKAGE_VERSION,
        displayName: 'Persisted Jobright',
        enabled: true,
        auth: [{ id: 'jobright', mode: 'username_password', configured: true }],
        config: { discoveryCount: 20, maxRunElapsedMs: 90_000 },
        filters: {},
        earliestBackfillDate: '2026-06-01',
      }],
    })
    await expect(upgradedClient.connectors.checkpoints.list({
      connectorInstanceId: INSTANCE_ID,
      filterSignature: NEW_FILTER_SIGNATURE,
    })).resolves.toMatchObject({
      items: [{
        checkpoint: {
          discoveryPage: 3,
          discoveryPosition: 80,
          processedSourceIds: expect.arrayContaining(['processed-62']),
          seenSourceIds: expect.arrayContaining(['seen-67']),
        },
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      }],
    })

    await expect(http.connectors.runs.trigger({
      connectorInstanceId: INSTANCE_ID,
      mode: 'manual',
    })).resolves.toMatchObject({ status: 'completed' })
    const afterUnchangedVersionRun = await http.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(afterUnchangedVersionRun.status).toBe('completed')
    const resolvedAfterUnchangedVersionRun = await http.sourcing.rawRecords.normalization.get(
      intake.receipts[1].rawRecordId,
    )
    expect(resolvedAfterUnchangedVersionRun.status).toBe('completed')
    expect(receivedCheckpoints[1]).toMatchObject({ discoveryPage: 3, discoveryPosition: 80 })
  })

  it('recovers connector version-marker persistence after an injected PGlite trigger failure', async () => {
    const pgliteDataPath = createScheduleHttpTempDatabasePath()
    const oldClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([createUpgradeConnector(OLD_PACKAGE_VERSION)]),
      normalizationRegistry: createUpgradeNormalizationRegistry(false),
      now: () => new Date(CLOCK), seedDataMode: 'none', pgliteDataPath, workspaceId: WORKSPACE_ID,
    })
    await oldClient.connectors.create({
      id: INSTANCE_ID, connectorId: CONNECTOR_ID, connectorVersion: OLD_PACKAGE_VERSION,
      displayName: 'Persisted Jobright', enabled: true, filters: {},
    })
    const oldRun = await oldClient.connectors.runs.trigger({
      connectorInstanceId: INSTANCE_ID, mode: 'manual',
    })
    const intake = await oldClient.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: CONNECTOR_ID, kind: 'connector', version: OLD_PACKAGE_VERSION },
      capture: {
        connectorInstanceId: INSTANCE_ID,
        connectorRunId: oldRun.id,
        executionScopeId: oldRun.executionScopeId,
      },
      observedAt: '2026-07-12T14:00:00.000Z',
      providerRecordId: 'durable-upgrade-job',
      payload: {
        companyName: 'Durable Robotics', roleTitle: 'Software Engineering Intern',
        providerDetailUrl: 'https://jobs.lever.co/durable-robotics/intern-1',
      },
    }] })
    await closeLocalValedictorianClient(oldClient)
    const upgradedClient = await createLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([createUpgradeConnector(NEW_PACKAGE_VERSION)]),
      normalizationRegistry: createUpgradeNormalizationRegistry(true),
      now: () => new Date(CLOCK), seedDataMode: 'none', pgliteDataPath, workspaceId: WORKSPACE_ID,
    })
    server = await createValedictorianHttpServer({
      client: upgradedClient, host: '127.0.0.1', port: 0,
      resolveWorkspaceClient: async () => upgradedClient,
    })
    const http = createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace(WORKSPACE_ID)
    const upgradedDatabase = getLocalValedictorianTestDatabase(upgradedClient)
    await upgradedDatabase.$client.exec(`
      create function fail_upgrade_version_marker() returns trigger language plpgsql as $$
      begin
        raise exception 'injected upgrade version marker failure';
      end;
      $$;
      create trigger fail_upgrade_version_marker before update of connector_version
      on connector_instances for each row execute function fail_upgrade_version_marker();
    `)

    await expect(http.connectors.runs.trigger({
      connectorInstanceId: INSTANCE_ID, mode: 'manual',
    })).rejects.toMatchObject({
      body: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        requestId: expect.any(String),
      },
      kind: 'internal',
      requestId: expect.any(String),
      status: 500,
    })
    const afterFailedMarker = await http.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(afterFailedMarker.status).toBe('completed')

    await upgradedDatabase.$client.exec(`
      drop trigger fail_upgrade_version_marker on connector_instances;
      drop function fail_upgrade_version_marker();
    `)
    await expect(http.connectors.runs.trigger({
      connectorInstanceId: INSTANCE_ID, mode: 'manual',
    })).resolves.toMatchObject({ status: 'completed' })
    const afterRecovery = await http.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )
    expect(afterRecovery.status).toBe('completed')
    await expect(upgradedClient.connectors.list()).resolves.toMatchObject({
      items: [expect.objectContaining({ connectorVersion: NEW_PACKAGE_VERSION })],
    })
    const verify = await upgradedDatabase.$client.query<{ count: string }>(`
      select count(*) as count from normalization_replay_requests
      where id like 'connector-upgrade:%'
    `)
    expect(Number(verify.rows[0].count)).toBe(1)
  })
})

function createUpgradeNormalizationRegistry(resolvesDestination: boolean) {
  const resolverVersion = resolvesDestination ? 'resolver@2' : 'resolver@1'
  const destinationResolver: NormalizationResolver = {
    declaration: {
      id: 'fixture.upgrade-destination',
      version: resolverVersion,
      requiredInputs: ['rawRevision'],
      outputFields: ['destinationUrl'],
      capabilities: ['pure'],
      costClass: 'none',
      precedence: 1_000,
      scopeRequirement: 'none',
    },
    resolve(context) {
      const url = context.rawRevision.payload?.providerDetailUrl
      const inputHash = context.hashInput(typeof url === 'string' ? url : null)
      if (!resolvesDestination || typeof url !== 'string') {
        return [{
          resolverId: 'fixture.upgrade-destination', resolverVersion,
          field: 'destinationUrl', inputHash, status: 'abstained',
          reason: 'Installed connector cannot resolve this provider record',
        }]
      }
      const value = { class: 'employer_or_ats' as const, url, intermediaryUrl: null }
      return [{
        resolverId: 'fixture.upgrade-destination', resolverVersion,
        field: 'destinationUrl', inputHash, status: 'resolved', value,
        confidence: 1, authoritative: true,
      }]
    },
  }
  return createNormalizationResolverRegistry([
    destinationResolver,
    ...createDefaultNormalizationResolverRegistry().resolvers,
  ])
}

function createUpgradeConnector(
  version: string,
  onCheckpoint: (checkpoint: unknown) => void = () => {},
): AppJobConnector {
  return {
    definition: {
      id: CONNECTOR_ID,
      version,
      capabilities: { supportsFiltering: false },
      checkpoint: { schemaVersion: CHECKPOINT_SCHEMA_VERSION },
    },
    async refresh(input) {
      onCheckpoint(input.checkpoint)
      const checkpoint = input.checkpoint as Record<string, unknown>
      return {
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: {
            pendingDetailRetries: [],
            retryState: [],
            ...checkpoint,
            discoveryPosition: 80,
          },
          schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        },
        observations: [],
        operationOutcome: null,
        retryHints: null,
        status: 'completed',
        stats: { observations: 0 },
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up',
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
        warnings: [],
      }
    },
  }
}
