import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JobObservation } from '@sparxie/valedictorian-connectors-core'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import { describe, expect, it, vi } from 'vitest'
import {
  createDrizzleDatabase,
  createFileDatabase,
  createInMemoryDatabase,
  migrateDatabase,
} from '../../db/sqlite'
import { createLocalValedictorianClient } from '../../runtime/local-valedictorian-client'
import { createValedictorianHttpServer } from '../../server/local-server'
import {
  createSqliteConnectorRepository,
  type ConnectorObservationInput,
} from './connector.repository'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'
import {
  JOBRIGHT_MIGRATION_SCAN_LIMIT,
  toJobrightMigrationSeed,
} from './connector.reconciliation'

describe('connector version reconciliation', () => {
  it('preserves an old empty-filter checkpoint under a distinct 0.5 provider-state scope', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const legacyCheckpoint = {
      attempted: 1,
      authRequired: 0,
      discovered: 20,
      eligible: 1,
      filtered: 19,
      rateLimited: 0,
      resolved: 1,
      retryableFailures: 0,
      skipped: 19,
      totalAvailable: 200,
    }

    await repository.upsertInstance({
      id: 'jobright-empty-filter',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.1',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-secret' }],
      config: {},
      filters: {},
    })
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-empty-filter',
      filterSignature: 'filters:{}',
      checkpoint: {
        checkpoint: legacyCheckpoint,
        schemaVersion: 'jobright-resolution-checkpoint@2',
      },
      coverage: {
        start: '2026-06-01T12:00:00.000Z',
        end: '2026-06-10T12:00:00.000Z',
      },
      savedAt: '2026-06-10T12:00:01.000Z',
    })
    const legacyRow = sqlite.prepare(
      'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ? AND filter_signature = ?',
    ).get('jobright-empty-filter', 'filters:{}')

    await repository.reconcileInstalledConnector({
      connectorInstanceId: 'jobright-empty-filter',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })

    expect(sqlite.prepare(
      'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ? AND filter_signature = ?',
    ).get('jobright-empty-filter', 'filters:{}')).toEqual(legacyRow)
    await expect(repository.getCheckpoint({
      connectorInstanceId: 'jobright-empty-filter',
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })).resolves.toMatchObject({
      checkpoint: emptyJobrightV2MigrationCheckpoint(),
      schemaVersion: 'jobright-resolution-checkpoint@2',
    })
    await expect(repository.listCheckpoints({
      connectorInstanceId: 'jobright-empty-filter',
    })).resolves.toHaveLength(2)
  })

  it('gives the new provider-state row reconciliation timestamps without mutating legacy provenance', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const setupRepository = createSqliteConnectorRepository(database)
    const instanceId = 'jobright-checkpoint-provenance'

    await setupRepository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await setupRepository.recordCheckpoint({
      connectorInstanceId: instanceId,
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: {
        checkpoint: emptyJobrightV2MigrationCheckpoint(),
        schemaVersion: 'jobright-resolution-checkpoint@2',
      },
      coverage: {
        start: '2026-05-01T12:00:00.000Z',
        end: '2026-06-01T12:00:00.000Z',
      },
      savedAt: '2026-06-01T12:00:01.000Z',
    })
    const legacyRow = sqlite.prepare(
      'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ?',
    ).get(instanceId)
    const reconciledAt = '2026-07-11T12:34:56.789Z'
    const repository = createSqliteConnectorRepository(database, {
      now: () => new Date(reconciledAt),
    })

    await repository.reconcileInstalledConnector({
      connectorInstanceId: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })

    expect(sqlite.prepare(
      'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ? AND filter_signature LIKE ?',
    ).get(instanceId, 'filters:%')).toEqual(legacyRow)
    expect(sqlite.prepare(`
      SELECT
        coverage_started_at AS coverageStartedAt,
        coverage_ended_at AS coverageEndedAt,
        saved_at AS savedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM connector_checkpoints
      WHERE connector_instance_id = ? AND filter_signature = ?
    `).get(instanceId, 'provider-state:jobright.resolver@0.5.0')).toEqual({
      coverageStartedAt: '2026-05-01T12:00:00.000Z',
      coverageEndedAt: '2026-06-01T12:00:00.000Z',
      savedAt: '2026-06-01T12:00:01.000Z',
      createdAt: reconciledAt,
      updatedAt: reconciledAt,
    })
  })

  it('prepares migration state for historical success without a checkpoint row', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-deferred-history'

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await repository.recordRefreshResult({
      connectorInstanceId: instanceId,
      mode: 'catch_up',
      startedAt: '2026-06-01T12:00:00.000Z',
      completedAt: '2026-06-01T12:00:01.000Z',
      config: {},
      filters: { roleTerms: ['intern'] },
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpointPersistence: 'deferred',
      result: {
        observations: [jobrightHistoricalObservation({
          cycleId: 'deferred-cycle',
          destinationClass: 'employer_or_ats',
          observedAt: '2026-06-01T12:00:00.000Z',
          officialUrl: 'https://jobs.example.test/deferred-success',
          sourceRecordKey: 'jobright.public:deferred-success',
          status: 'resolved',
        })],
        nextCheckpoint: {
          checkpoint: jobrightV3Checkpoint({
            cycleId: 'deferred-cycle',
            processedSourceIds: ['jobright.public:deferred-success'],
            usefulEmployerOrAtsSourceIds: ['jobright.public:deferred-success'],
          }),
          schemaVersion: 'jobright-resolution-checkpoint@3',
        },
        coverage: {
          start: '2026-05-01T12:00:00.000Z',
          end: '2026-06-01T12:00:00.000Z',
        },
        stats: { observations: 1 },
        warnings: [],
      },
    })
    await expect(repository.listCheckpoints({ connectorInstanceId: instanceId })).resolves.toEqual([])

    await repository.reconcileInstalledConnector({
      connectorInstanceId: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })

    await expect(repository.getCheckpoint({
      connectorInstanceId: instanceId,
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })).resolves.toMatchObject({
      checkpoint: {
        attempted: 1,
        resolved: 1,
      },
      schemaVersion: 'jobright-resolution-checkpoint@2',
      coverageStartedAt: '2026-05-01T12:00:00.000Z',
      coverageEndedAt: '2026-06-01T12:00:00.000Z',
    })
  })

  it('reconciles persisted Jobright 0.4.1 state into the installed raw-first checkpoint scope', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const legacySignature = 'filters:{"roleTerms":["intern"]}'
    const legacyCheckpoint = {
      attempted: 2,
      authRequired: 0,
      discovered: 20,
      eligible: 2,
      filtered: 18,
      rateLimited: 0,
      resolved: 1,
      retryableFailures: 0,
      skipped: 18,
      totalAvailable: 400,
    }

    await repository.upsertInstance({
      id: 'jobright-production',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.1',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        secretKey: 'connector_jobright_credentials_jobright-production',
      }],
      config: { maxDiscoveryRecords: 500 },
      filters: { roleTerms: ['intern'] },
      createdAt: '2026-06-01T12:00:00.000Z',
    })
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-production',
      filterSignature: legacySignature,
      checkpoint: {
        checkpoint: legacyCheckpoint,
        schemaVersion: 'jobright-resolution-checkpoint@2',
      },
      coverage: {
        start: '2026-06-01T12:00:00.000Z',
        end: '2026-06-10T12:00:00.000Z',
      },
      savedAt: '2026-06-10T12:00:01.000Z',
    })

    const reconciled = await repository.reconcileInstalledConnector({
      connectorInstanceId: 'jobright-production',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })

    expect(reconciled).toMatchObject({
      connectorVersion: '0.5.0',
      reconciled: true,
    })
    await expect(repository.getInstance('jobright-production')).resolves.toMatchObject({
      connectorVersion: '0.5.0',
    })
    await expect(repository.getCheckpoint({
      connectorInstanceId: 'jobright-production',
      filterSignature: legacySignature,
    })).resolves.toMatchObject({
      checkpoint: legacyCheckpoint,
      schemaVersion: 'jobright-resolution-checkpoint@2',
    })
    await expect(repository.getCheckpoint({
      connectorInstanceId: 'jobright-production',
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })).resolves.toMatchObject({
      checkpoint: emptyJobrightV2MigrationCheckpoint(),
      schemaVersion: 'jobright-resolution-checkpoint@2',
    })

    await expect(repository.reconcileInstalledConnector({
      connectorInstanceId: 'jobright-production',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })).resolves.toMatchObject({ reconciled: false })
    await expect(repository.listCheckpoints({
      connectorInstanceId: 'jobright-production',
    })).resolves.toHaveLength(2)
  })

  it('rewinds 0.4.3 discovery and makes filter-only processed ids discoverable', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const legacySignature = 'filters:{"roleTerms":["intern"]}'
    const legacyCheckpoint = {
      attempts: 3,
      cycleId: 'legacy-cycle',
      cycleStartedAt: '2026-06-10T12:00:00.000Z',
      discoveryPage: 4,
      discoveryPages: 4,
      discoveryPosition: 80,
      discoveryRecordLimitReached: false,
      discoveryRecords: 4,
      eligibleSourceIds: [
        'jobright.public:useful',
        'jobright.public:unresolved',
        'jobright.public:closed',
      ],
      filtered: 1,
      horizonAt: '2026-07-10T12:00:00.000Z',
      lastDiscoveryPageSize: 20,
      lastDiscoveryRequestCount: 20,
      processedSourceIds: [
        'jobright.public:useful',
        'jobright.public:unresolved',
        'jobright.public:filtered',
        'jobright.public:closed',
      ],
      retryState: [],
      seenSourceIds: [
        'jobright.public:useful',
        'jobright.public:unresolved',
        'jobright.public:filtered',
        'jobright.public:closed',
      ],
      skipped: 0,
      stopReason: 'source_exhausted',
      totalAvailable: 80,
      unresolvedSourceIds: ['jobright.public:unresolved'],
      usefulEmployerOrAts: 1,
      usefulEmployerOrAtsSourceIds: ['jobright.public:useful'],
      usefulThirdParty: 0,
      usefulThirdPartySourceIds: [],
    }

    await repository.upsertInstance({
      id: 'jobright-v3',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-secret' }],
      config: {},
      filters: { roleTerms: ['intern'] },
    })
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-v3',
      filterSignature: legacySignature,
      checkpoint: {
        checkpoint: legacyCheckpoint,
        schemaVersion: 'jobright-resolution-checkpoint@3',
      },
      coverage: {
        start: '2026-06-01T12:00:00.000Z',
        end: '2026-06-10T12:00:00.000Z',
      },
      savedAt: '2026-06-10T12:00:01.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'jobright-v3',
      mode: 'manual',
      startedAt: '2026-06-10T12:00:00.000Z',
      completedAt: '2026-06-10T12:00:01.000Z',
      config: {},
      filters: { roleTerms: ['intern'] },
      filterSignature: legacySignature,
      result: {
        coverage: {
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-10T12:00:00.000Z',
        },
        stats: { observations: 1 },
        warnings: [],
        nextCheckpoint: {
          checkpoint: legacyCheckpoint,
          schemaVersion: 'jobright-resolution-checkpoint@3',
        },
        observations: [
          jobrightHistoricalObservation({
            cycleId: 'legacy-cycle',
            destinationClass: 'employer_or_ats',
            observedAt: '2026-06-10T12:00:00.000Z',
            officialUrl: 'https://jobs.example.test/useful',
            sourceRecordKey: 'jobright.public:useful',
            status: 'resolved',
          }),
          jobrightHistoricalObservation({
            cycleId: 'legacy-cycle',
            observedAt: '2026-06-10T12:00:00.000Z',
            reason: 'jobright_application_url_rejected',
            sourceRecordKey: 'jobright.public:unresolved',
            status: 'unresolved',
          }),
          jobrightHistoricalObservation({
            cycleId: 'legacy-cycle',
            observedAt: '2026-06-10T12:00:00.000Z',
            reason: 'jobright_resolution_deferred',
            sourceRecordKey: 'jobright.public:filtered',
            status: 'unresolved',
          }),
          jobrightObservation({
            cycleId: 'legacy-cycle',
            sourceRecordKey: 'jobright.public:closed',
            status: 'closed',
          }),
        ],
      },
    })
    sqlite.prepare(`
      INSERT INTO profile_secrets (
        key, label, kind, encrypted_value, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      'jobright-secret',
      'Jobright username and password',
      'password',
      'ciphertext:v1:nonce:payload',
      '2026-06-10T11:00:00.000Z',
      '2026-06-10T11:00:00.000Z',
    )
    const historicalBefore = {
      runs: sqlite.prepare(
        'SELECT * FROM connector_runs WHERE connector_instance_id = ? ORDER BY id',
      ).all('jobright-v3'),
      observations: sqlite.prepare(
        'SELECT * FROM connector_observations WHERE connector_instance_id = ? ORDER BY id',
      ).all('jobright-v3'),
      checkpoint: sqlite.prepare(
        'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ? AND filter_signature = ?',
      ).get('jobright-v3', legacySignature),
      secret: sqlite.prepare('SELECT * FROM profile_secrets WHERE key = ?').get('jobright-secret'),
      authJson: sqlite.prepare(
        'SELECT auth_json FROM connector_instances WHERE id = ?',
      ).pluck().get('jobright-v3'),
    }

    await repository.reconcileInstalledConnector({
      connectorInstanceId: 'jobright-v3',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })

    expect({
      runs: sqlite.prepare(
        'SELECT * FROM connector_runs WHERE connector_instance_id = ? ORDER BY id',
      ).all('jobright-v3'),
      observations: sqlite.prepare(
        'SELECT * FROM connector_observations WHERE connector_instance_id = ? ORDER BY id',
      ).all('jobright-v3'),
      checkpoint: sqlite.prepare(
        'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ? AND filter_signature = ?',
      ).get('jobright-v3', legacySignature),
      secret: sqlite.prepare('SELECT * FROM profile_secrets WHERE key = ?').get('jobright-secret'),
      authJson: sqlite.prepare(
        'SELECT auth_json FROM connector_instances WHERE id = ?',
      ).pluck().get('jobright-v3'),
    }).toEqual(historicalBefore)

    await expect(repository.getCheckpoint({
      connectorInstanceId: 'jobright-v3',
      filterSignature: legacySignature,
    })).resolves.toMatchObject({ checkpoint: legacyCheckpoint })
    await expect(repository.getCheckpoint({
      connectorInstanceId: 'jobright-v3',
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })).resolves.toMatchObject({
      schemaVersion: 'jobright-resolution-checkpoint@2',
      checkpoint: {
        attempted: 3,
        authRequired: 0,
        discovered: 4,
        eligible: 4,
        filtered: 0,
        rateLimited: 0,
        resolved: 1,
        retryableFailures: 0,
        skipped: 1,
        totalAvailable: null,
      },
    })
  })

  it('merges multiple legacy scopes without repeating successful detail work', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-multiple-scopes'

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-secret' }],
      config: { discoveryCount: 2, maxAttemptsPerCycle: 10, maxRequestsPerRun: 5 },
      filters: { roleTerms: ['intern'] },
    })
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: instanceId,
      completedAt: '2026-06-01T12:00:01.000Z',
      filterSignature: 'filters:{"roleTerms":["software"]}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'older-success-cycle',
        processedSourceIds: ['jobright.public:job-success'],
        usefulEmployerOrAtsSourceIds: ['jobright.public:job-success'],
      }),
      observations: [jobrightHistoricalObservation({
        cycleId: 'older-success-cycle',
        destinationClass: 'employer_or_ats',
        officialUrl: 'https://jobs.example.test/job-success',
        observedAt: '2026-06-01T12:00:00.000Z',
        sourceRecordKey: 'jobright.public:job-success',
        status: 'resolved',
      })],
    })
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: instanceId,
      completedAt: '2026-06-02T12:00:01.000Z',
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'later-filter-cycle',
        processedSourceIds: ['jobright.public:job-filtered'],
      }),
      observations: [jobrightHistoricalObservation({
        cycleId: 'later-filter-cycle',
        observedAt: '2026-06-02T12:00:00.000Z',
        reason: 'jobright_resolution_deferred',
        sourceRecordKey: 'jobright.public:job-filtered',
        status: 'unresolved',
      })],
    })
    const legacyRows = sqlite.prepare(
      'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ? ORDER BY filter_signature',
    ).all(instanceId)

    await repository.reconcileInstalledConnector({
      connectorInstanceId: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: instanceId,
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })
    const seeds = await repository.listLatestReconciliationObservations({
      connectorInstanceId: instanceId,
      limit: 500,
    })
    const detailUrls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url

      if (url.includes('/swan/auth/login/pwd')) {
        return jobrightJsonResponse({}, { 'set-cookie': 'SESSION_ID=migration-session; Path=/' })
      }
      if (url.includes('/swan/auth/newinfo')) {
        return jobrightJsonResponse({ logined: true })
      }
      if (url.includes('/swan/recommend/visitor-list/jobs')) {
        return jobrightJsonResponse({
          jobNum: 2,
          jobList: [
            jobrightVisitorRow('job-success', 'Previously Resolved Intern'),
            jobrightVisitorRow('job-filtered', 'Previously Filtered Intern'),
          ],
        })
      }
      if (url.includes('/swan/share/job/')) {
        detailUrls.push(url)
        const jobrightId = url.split('/').at(-1)
        return jobrightJsonResponse({
          logined: true,
          jobDetail: {
            jobResult: {
              applyLink: `https://jobs.example.test/${jobrightId}`,
              companyName: 'Example Robotics',
              jobTitle: 'Software Engineering Intern',
            },
          },
        })
      }

      throw new Error(`Unexpected Jobright request: ${url}`)
    }) as typeof fetch
    const connector = createJobrightConnector({
      createCycleId: () => 'migration-cycle',
      fetch: fetchImpl,
      now: () => '2026-06-03T12:00:00.000Z',
      nowEpochMs: () => Date.parse('2026-06-03T12:00:00.000Z'),
      nowMs: () => 0,
      sleep: async () => undefined,
    })
    let rawSequence = 0

    await connector.refresh({
      connectorInstanceId: instanceId,
      workspaceId: 'workspace-migration',
      mode: 'catch_up',
      coverage: {
        start: '2026-06-02T12:00:00.000Z',
        end: '2026-06-03T12:00:00.000Z',
      },
      config: { discoveryCount: 2, maxAttemptsPerCycle: 10, maxRequestsPerRun: 5 },
      filters: { maxResolutionCount: 2 },
      checkpoint: checkpoint
        ? { checkpoint: checkpoint.checkpoint, schemaVersion: checkpoint.schemaVersion }
        : undefined,
      observations: seeds,
    }, {
      auth: {
        async resolve() {
          return {
            id: 'jobright',
            mode: 'username_password',
            status: 'ready',
            value: JSON.stringify({ username: 'fixture@example.test', password: 'secret' }),
          }
        },
      },
      delay: { async wait() { return 0 } },
      rawSourceIntake: {
        async capture(input) {
          rawSequence += 1
          const rawRecordId = `raw-${rawSequence}`
          const revisionId = `revision-${rawSequence}`
          return {
            rawRecordId,
            sourceEntityId: null,
            revision: {
              id: revisionId,
              rawRecordId,
              revision: 1,
              contentHash: `sha256:${String(rawSequence).padStart(64, '0')}`,
              reused: false,
              createdAt: input.observedAt,
            },
            occurrence: {
              id: `occurrence-${rawSequence}`,
              rawRecordId,
              rawRevisionId: revisionId,
              observedAt: input.observedAt,
              receivedAt: input.observedAt,
            },
          }
        },
      },
      normalization: {
        async run(input) {
          return input.resolve()
        },
      },
    })

    expect(detailUrls.filter((url) => url.endsWith('/job-success'))).toHaveLength(0)
    expect(detailUrls.filter((url) => url.endsWith('/job-filtered'))).toHaveLength(1)
    expect(sqlite.prepare(
      'SELECT * FROM connector_checkpoints WHERE connector_instance_id = ? AND filter_signature LIKE ? ORDER BY filter_signature',
    ).all(instanceId, 'filters:%')).toEqual(legacyRows)
  })

  it('prioritizes bounded successful seeds and keeps the latest duplicate-source evidence', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-seed-priority'

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    const deferredObservations = Array.from({ length: 1_000 }, (_, index) =>
      jobrightHistoricalObservation({
        cycleId: 'priority-cycle',
        observedAt: '2026-06-01T12:00:00.000Z',
        reason: 'jobright_resolution_deferred',
        sourceRecordKey: `jobright.public:a-${String(index).padStart(3, '0')}`,
        status: 'unresolved',
      }))
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: instanceId,
      completedAt: '2026-06-02T12:00:01.000Z',
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'priority-cycle',
        processedSourceIds: deferredObservations.map(({ sourceRecordKey }) => sourceRecordKey),
      }),
      observations: [
        ...deferredObservations,
        jobrightHistoricalObservation({
          cycleId: 'priority-cycle',
          destinationClass: 'employer_or_ats',
          observedAt: '2026-06-01T10:00:00.000Z',
          officialUrl: 'https://jobs.example.test/old-success',
          sourceRecordKey: 'jobright.public:zz-useful',
          status: 'resolved',
        }),
        jobrightHistoricalObservation({
          cycleId: 'priority-cycle',
          destinationClass: 'employer_or_ats',
          observedAt: '2026-06-01T11:00:00.000Z',
          officialUrl: 'https://jobs.example.test/latest-success',
          sourceRecordKey: 'jobright.public:zz-useful',
          status: 'resolved',
        }),
      ],
    })

    const seeds = await repository.listLatestReconciliationObservations({
      connectorInstanceId: instanceId,
      limit: 1_000,
    })

    expect(seeds).toHaveLength(1_000)
    expect(seeds[0]).toMatchObject({
      sourceRecordKey: 'jobright.public:zz-useful',
      observedAt: '2026-06-01T11:00:00.000Z',
      links: { official: 'https://jobs.example.test/latest-success' },
      resolution: { status: 'resolved' },
    })
    expect(seeds).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ links: { official: 'https://jobs.example.test/old-success' } }),
    ]))
  })

  it('retains 501 compatible terminal observations inside the 1000-seed boundary', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-501-terminal-seeds'
    const sourceRecordKeys = Array.from(
      { length: 501 },
      (_, index) => `jobright.public:terminal-${String(index).padStart(3, '0')}`,
    )

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: instanceId,
      completedAt: '2026-06-02T12:00:01.000Z',
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'terminal-seed-cycle',
        processedSourceIds: sourceRecordKeys,
      }),
      observations: sourceRecordKeys.map((sourceRecordKey) => jobrightHistoricalObservation({
        cycleId: 'terminal-seed-cycle',
        observedAt: '2026-06-02T12:00:00.000Z',
        sourceRecordKey,
        status: 'resolved',
      })),
    })

    await expect(repository.listLatestReconciliationObservations({
      connectorInstanceId: instanceId,
      limit: 1_000,
    })).resolves.toHaveLength(501)

    await repository.reconcileInstalledConnector({
      connectorInstanceId: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })
    await expect(repository.getCheckpoint({
      connectorInstanceId: instanceId,
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })).resolves.toMatchObject({
      checkpoint: expect.objectContaining({ attempted: 501, discovered: 501, resolved: 501 }),
    })
  })

  it('accepts a production-shaped v3 retry state without retryAfter', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-v3-retry-state'
    const sourceId = 'jobright.public:retry-pending'

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await repository.recordCheckpoint({
      connectorInstanceId: instanceId,
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: {
        checkpoint: jobrightV3Checkpoint({
          cycleId: 'retry-state-cycle',
          eligibleSourceIds: [sourceId],
          processedSourceIds: [],
          retryState: [{ attempts: 1, reason: 'jobright_detail_retryable', sourceId }],
          seenSourceIds: [sourceId],
        }),
        schemaVersion: 'jobright-resolution-checkpoint@3',
      },
      coverage: {
        start: '2026-06-01T12:00:00.000Z',
        end: '2026-06-02T12:00:00.000Z',
      },
      savedAt: '2026-06-02T12:00:01.000Z',
    })

    await expect(repository.reconcileInstalledConnector({
      connectorInstanceId: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })).resolves.toMatchObject({ connectorVersion: '0.5.0', reconciled: true })
  })

  it('accepts released v3 filtered, skipped, last-page, and retry variants', async () => {
    const sourceId = 'jobright.public:production-shape'
    const retryReasons = [
      'jobright_auth_required',
      'jobright_challenge_required',
      'jobright_detail_retryable',
      'jobright_not_logged_in',
      'jobright_rate_limited',
      'jobright_retry_deferred',
    ]
    const checkpoints: Array<[string, Record<string, unknown>]> = [
      ['filtered', {
        ...jobrightV3Checkpoint({
          attempts: 0,
          cycleId: 'filtered-production-cycle',
          eligibleSourceIds: [],
          processedSourceIds: [sourceId],
          seenSourceIds: [sourceId],
        }),
        filtered: 1,
      }],
      ['skipped', {
        ...jobrightV3Checkpoint({
          attempts: 0,
          cycleId: 'skipped-production-cycle',
          eligibleSourceIds: [],
          processedSourceIds: [sourceId],
          seenSourceIds: [sourceId],
        }),
        skipped: 1,
      }],
      ['null-last-page-pair', {
        ...jobrightV3Checkpoint({
          cycleId: 'null-page-production-cycle',
          processedSourceIds: [sourceId],
        }),
        lastDiscoveryPageSize: null,
        lastDiscoveryRequestCount: null,
      }],
      ['page-and-horizon-boundary', {
        ...jobrightV3Checkpoint({
          cycleId: 'page-horizon-boundary-cycle',
          processedSourceIds: [sourceId],
        }),
        discoveryPage: 100,
        discoveryPages: 100,
        horizonAt: '2026-07-30T12:00:00.000Z',
      }],
      ...retryReasons.map((reason, index) => [`retry-${reason}`, {
        ...jobrightV3Checkpoint({
          cycleId: `retry-production-${String(index)}`,
          eligibleSourceIds: [sourceId],
          processedSourceIds: [],
          retryState: [{ attempts: 1, reason, sourceId }],
          seenSourceIds: [sourceId],
        }),
        retryState: [{
          attempts: 1,
          reason,
          ...(index === 0
            ? { retryAfter: null }
            : index === 1
              ? { retryAfter: '2026-06-03T12:00:00.000Z' }
              : {}),
          sourceId,
        }],
      }] as [string, Record<string, unknown>]),
    ]

    for (const [name, checkpoint] of checkpoints) {
      const sqlite = createInMemoryDatabase()
      migrateDatabase(sqlite)
      const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
      const instanceId = `jobright-valid-v3-${name}`

      await repository.upsertInstance({
        id: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.4.3',
        displayName: 'Jobright internslist',
        enabled: true,
      })
      await repository.recordCheckpoint({
        connectorInstanceId: instanceId,
        filterSignature: 'filters:{}',
        checkpoint: { checkpoint, schemaVersion: 'jobright-resolution-checkpoint@3' },
        coverage: {
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-02T12:00:00.000Z',
        },
        savedAt: '2026-06-02T12:00:01.000Z',
      })

      await expect(repository.reconcileInstalledConnector({
        connectorInstanceId: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.5.0',
      }), name).resolves.toMatchObject({ connectorVersion: '0.5.0', reconciled: true })
    }
  })

  it('uses the same compatible evidence for the migration envelope and runner seeds', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-compatible-seeds'

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: instanceId,
      completedAt: '2026-06-03T12:00:01.000Z',
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'compatible-seed-cycle',
        processedSourceIds: [],
      }),
      observations: [
        jobrightHistoricalObservation({
          cycleId: 'compatible-seed-cycle',
          observedAt: '2026-06-01T12:00:00.000Z',
          sourceRecordKey: 'jobright.public:duplicate',
          status: 'resolved',
        }),
        jobrightHistoricalObservation({
          cycleId: 'compatible-seed-cycle',
          observedAt: '2026-06-02T12:00:00.000Z',
          sourceRecordKey: 'jobright.public:duplicate',
          status: 'resolved',
        }),
        jobrightHistoricalObservation({
          cycleId: 'compatible-seed-cycle',
          observedAt: '2026-06-03T12:00:00.000Z',
          sourceRecordKey: 'jobright.public:unsupported',
          status: 'resolved',
        }),
      ],
    })
    sqlite.prepare(
      'UPDATE connector_observations SET parser_version = NULL WHERE source_record_key = ? AND observed_at = ?',
    ).run('jobright.public:duplicate', '2026-06-02T12:00:00.000Z')
    sqlite.prepare(
      'UPDATE connector_observations SET resolution_json = ? WHERE source_record_key = ?',
    ).run(
      JSON.stringify({ status: 'never-supported', method: null, reason: null }),
      'jobright.public:unsupported',
    )

    await repository.reconcileInstalledConnector({
      connectorInstanceId: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })

    await expect(repository.getCheckpoint({
      connectorInstanceId: instanceId,
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })).resolves.toMatchObject({
      checkpoint: expect.objectContaining({ attempted: 1, discovered: 1, resolved: 1 }),
    })
    const selectedSeeds = await repository.listLatestReconciliationObservations({
      connectorInstanceId: instanceId,
      limit: 1_000,
    })
    expect(selectedSeeds).toEqual([
      expect.objectContaining({
        observedAt: '2026-06-01T12:00:00.000Z',
        sourceRecordKey: 'jobright.public:duplicate',
        resolution: expect.objectContaining({ status: 'resolved' }),
      }),
    ])

    const suppliedSeeds: JobObservation[][] = []
    const connector: AppJobConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.5.0',
        capabilities: { supportsFiltering: false },
      },
      async refresh(input) {
        suppliedSeeds.push(input.observations ?? [])
        return {
          coverage: input.coverage,
          stats: { observations: 0 },
          warnings: [],
          observations: [],
          nextCheckpoint: {
            checkpoint: input.checkpoint?.checkpoint ?? emptyJobrightV2MigrationCheckpoint(),
            schemaVersion: input.checkpoint?.schemaVersion ?? 'jobright-resolution-checkpoint@2',
          },
        }
      },
    }
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-compatible-seeds' })

    await runner.refresh(connector, {
      connectorInstanceId: instanceId,
      mode: 'catch_up',
      coverage: {
        start: '2026-06-01T12:00:00.000Z',
        end: '2026-06-04T12:00:00.000Z',
      },
    })

    expect(suppliedSeeds).toEqual([selectedSeeds])
  })

  it('falls back to older compatible evidence for every malformed observation container', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-malformed-seed-fallback'
    const malformedCases = [
      ['links', 'links_json', '[]'],
      [
        'numeric-method',
        'resolution_json',
        JSON.stringify({ status: 'resolved', method: 42, reason: null }),
      ],
      [
        'object-reason',
        'resolution_json',
        JSON.stringify({ status: 'resolved', method: 'jobright_api_detail', reason: {} }),
      ],
      ['dedupe-container', 'dedupe_keys_json', '{}'],
      ['evidence-container', 'evidence_json', '{}'],
      ['metadata-container', 'source_metadata_json', '[]'],
      ['date-only', 'observed_at', '2026-06-03'],
    ] as const
    const sourceRecordKeys = malformedCases.map(
      ([name]) => `jobright.public:malformed-${name}`,
    )

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: instanceId,
      completedAt: '2026-06-03T12:00:01.000Z',
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'malformed-seed-cycle',
        processedSourceIds: sourceRecordKeys,
      }),
      observations: sourceRecordKeys.flatMap((sourceRecordKey) => [
        jobrightHistoricalObservation({
          cycleId: 'malformed-seed-cycle',
          observedAt: '2026-06-01T12:00:00.000Z',
          sourceRecordKey,
          status: 'resolved',
        }),
        jobrightHistoricalObservation({
          cycleId: 'malformed-seed-cycle',
          observedAt: '2026-06-02T12:00:00.000Z',
          sourceRecordKey,
          status: 'resolved',
        }),
      ]),
    })
    for (const [name, column, value] of malformedCases) {
      const sourceRecordKey = `jobright.public:malformed-${name}`
      sqlite.prepare(
        `UPDATE connector_observations SET ${column} = ? WHERE source_record_key = ? AND observed_at = ?`,
      ).run(value, sourceRecordKey, '2026-06-02T12:00:00.000Z')
    }

    const seeds = await repository.listLatestReconciliationObservations({
      connectorInstanceId: instanceId,
      limit: 1_000,
    })

    expect(seeds).toHaveLength(malformedCases.length)
    expect(seeds.map(({ observedAt, sourceRecordKey }) => ({ observedAt, sourceRecordKey })))
      .toEqual([...sourceRecordKeys].sort().map((sourceRecordKey) => ({
        observedAt: '2026-06-01T12:00:00.000Z',
        sourceRecordKey,
      })))
  })

  it('rejects every malformed or unbounded Jobright migration seed field without throwing', () => {
    const valid = jobrightHistoricalObservation({
      cycleId: 'complete-seed-cycle',
      observedAt: '2026-06-01T12:00:00.000Z',
      sourceRecordKey: 'jobright.public:complete-seed',
      status: 'resolved',
    })
    const cyclicPay: Record<string, unknown> = {}
    cyclicPay.self = cyclicPay
    const mutations: Array<[string, (seed: Record<string, unknown>) => void]> = [
      ['wrong connector', (seed) => { seed.connectorId = 'jobright.resolver' }],
      ['blank version', (seed) => { seed.connectorVersion = ' ' }],
      ['overlong parser', (seed) => { seed.parserVersion = 'x'.repeat(129) }],
      ['blank schema', (seed) => { seed.observationSchemaVersion = '' }],
      ['invalid source key', (seed) => { seed.sourceRecordKey = 'jobright.public:bad/source' }],
      ['date-only observed at', (seed) => { seed.observedAt = '2026-06-01' }],
      ['numeric company', (seed) => { seed.companyName = 42 }],
      ['overlong title', (seed) => { seed.roleTitle = 'x'.repeat(4_097) }],
      ['numeric location', (seed) => { seed.locationRaw = 42 }],
      ['object description', (seed) => { seed.descriptionText = {} }],
      ['cyclic pay', (seed) => { seed.pay = cyclicPay }],
      ['array links', (seed) => { seed.links = [] }],
      ['numeric link', (seed) => {
        seed.links = { source: 42, intermediary: null, official: null }
      }],
      ['extra link', (seed) => {
        seed.links = { source: null, intermediary: null, official: null, private: 'never-leak' }
      }],
      ['numeric method', (seed) => {
        seed.resolution = { status: 'resolved', method: 42, reason: null }
      }],
      ['object reason', (seed) => {
        seed.resolution = { status: 'resolved', method: null, reason: {} }
      }],
      ['unsupported status', (seed) => {
        seed.resolution = { status: 'never-supported', method: null, reason: null }
      }],
      ['wrong dedupe container', (seed) => { seed.dedupeKeys = {} }],
      ['numeric dedupe key', (seed) => { seed.dedupeKeys = [42] }],
      ['wrong metadata container', (seed) => { seed.sourceMetadata = [] }],
      ['unsafe metadata value', (seed) => { seed.sourceMetadata = { score: Number.NaN } }],
      ['wrong evidence container', (seed) => { seed.evidence = {} }],
      ['malformed evidence entry', (seed) => {
        seed.evidence = [{ type: 42, capturedAt: '2026-06-01', sourceUrl: {} }]
      }],
      ['extra evidence field', (seed) => {
        seed.evidence = [{
          type: 'jobright_api_detail',
          capturedAt: '2026-06-01T12:00:00.000Z',
          sourceUrl: null,
          private: 'never-leak',
        }]
      }],
    ]

    expect(toJobrightMigrationSeed(valid)).toMatchObject({
      sourceRecordKey: 'jobright.public:complete-seed',
    })

    for (const [name, mutate] of mutations) {
      const seed = { ...valid } as Record<string, unknown>
      mutate(seed)
      expect(toJobrightMigrationSeed(seed as ConnectorObservationInput), name).toBeNull()
    }
  })

  it('accepts and migrates the published empty-name v3 retry observation', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-published-retry-observation'
    const sourceRecordKey = 'jobright.public:retry-observation'
    const intermediaryUrl = 'https://jobright.ai/jobs/info/retry-observation'
    const observation: JobObservation = {
      connectorId: 'jobright.public',
      connectorVersion: '0.4.3',
      parserVersion: 'jobright-api@2',
      observationSchemaVersion: 'job-observation@2',
      sourceRecordKey,
      observedAt: '2026-06-01T12:00:00.000Z',
      companyName: '',
      roleTitle: '',
      locationRaw: null,
      descriptionText: null,
      pay: null,
      links: {
        source: intermediaryUrl,
        intermediary: intermediaryUrl,
        official: null,
      },
      resolution: {
        status: 'unresolved',
        method: 'jobright_visitor_list',
        reason: 'jobright_resolution_deferred',
      },
      dedupeKeys: [
        'jobright:retry-observation',
        `source-record:${sourceRecordKey}`,
        `source:${intermediaryUrl}`,
      ],
      sourceMetadata: {
        jobrightCycleId: 'published-retry-cycle',
        jobrightId: 'retry-observation',
        source: 'jobright',
      },
      evidence: [{
        type: 'jobright_visitor_list_record',
        capturedAt: '2026-06-01T12:00:00.000Z',
        sourceUrl: 'https://swan-api.jobright.ai/swan/recommend/visitor-list/jobs',
      }],
    }

    expect(toJobrightMigrationSeed(observation)).toEqual(observation)

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: instanceId,
      completedAt: '2026-06-01T12:00:01.000Z',
      filterSignature: 'filters:{}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'published-retry-cycle',
        eligibleSourceIds: [sourceRecordKey],
        processedSourceIds: [],
        retryState: [{
          attempts: 1,
          reason: 'jobright_detail_retryable',
          sourceId: sourceRecordKey,
        }],
        seenSourceIds: [sourceRecordKey],
      }),
      observations: [observation],
    })

    await repository.reconcileInstalledConnector({
      connectorInstanceId: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    })
    await expect(repository.getCheckpoint({
      connectorInstanceId: instanceId,
      filterSignature: 'provider-state:jobright.resolver@0.5.0',
    })).resolves.toMatchObject({
      checkpoint: expect.objectContaining({ attempted: 0, discovered: 1, eligible: 1 }),
    })

    const suppliedSeeds: JobObservation[][] = []
    const connector: AppJobConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.5.0',
        capabilities: { supportsFiltering: false },
      },
      async refresh(input) {
        suppliedSeeds.push(input.observations ?? [])
        return {
          coverage: input.coverage,
          stats: { observations: 0 },
          warnings: [],
          observations: [],
          nextCheckpoint: input.checkpoint ?? {
            checkpoint: emptyJobrightV2MigrationCheckpoint(),
            schemaVersion: 'jobright-resolution-checkpoint@2',
          },
        }
      },
    }

    await createConnectorRunner({ repository, workspaceId: 'workspace-published-retry' })
      .refresh(connector, {
        connectorInstanceId: instanceId,
        mode: 'catch_up',
        coverage: {
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-02T12:00:00.000Z',
        },
      })

    expect(suppliedSeeds).toEqual([[observation]])
  })

  it('bounds compatibility scanning and falls back at the 10000-row boundary', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const instanceId = 'jobright-seed-scan-boundary'
    const sourceRecordKey = 'jobright.public:scan-boundary'
    const incompatibleRows = Array.from(
      { length: JOBRIGHT_MIGRATION_SCAN_LIMIT },
      () => ({
        ...jobrightHistoricalObservation({
          cycleId: 'scan-boundary-cycle',
          observedAt: '2026-06-02T12:00:00.000Z',
          sourceRecordKey,
          status: 'resolved',
        }),
        parserVersion: null,
      }),
    )

    await repository.upsertInstance({
      id: instanceId,
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await repository.recordRefreshResult({
      connectorInstanceId: instanceId,
      mode: 'catch_up',
      startedAt: '2026-06-02T12:00:00.000Z',
      completedAt: '2026-06-02T12:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      checkpointPersistence: 'deferred',
      result: {
        observations: [
          ...incompatibleRows,
          jobrightHistoricalObservation({
            cycleId: 'scan-boundary-cycle',
            observedAt: '2026-06-01T12:00:00.000Z',
            sourceRecordKey,
            status: 'resolved',
          }),
        ],
        nextCheckpoint: {
          checkpoint: emptyJobrightV2MigrationCheckpoint(),
          schemaVersion: 'jobright-resolution-checkpoint@2',
        },
        coverage: {
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-02T12:00:00.000Z',
        },
        stats: { observations: JOBRIGHT_MIGRATION_SCAN_LIMIT + 1 },
        warnings: [],
      },
    })

    await expect(repository.listLatestReconciliationObservations({
      connectorInstanceId: instanceId,
      limit: 1_000,
    })).resolves.toEqual([])

    sqlite.prepare(`
      DELETE FROM connector_observations
      WHERE id = (
        SELECT id
        FROM connector_observations
        WHERE connector_instance_id = ? AND parser_version IS NULL
        LIMIT 1
      )
    `).run(instanceId)

    await expect(repository.listLatestReconciliationObservations({
      connectorInstanceId: instanceId,
      limit: 1_000,
    })).resolves.toEqual([
      expect.objectContaining({
        observedAt: '2026-06-01T12:00:00.000Z',
        sourceRecordKey,
      }),
    ])
  })

  it('rolls back an unknown checkpoint transition with sanitized recovery guidance', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))

    await repository.upsertInstance({
      id: 'jobright-invalid',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'never-leak-key' }],
      filters: { privateMarker: 'never-leak-filter' },
    })
    await repository.recordCheckpoint({
      connectorInstanceId: 'jobright-invalid',
      filterSignature: 'filters:{"privateMarker":"never-leak-filter"}',
      checkpoint: {
        checkpoint: { session: 'never-leak-session' },
        schemaVersion: 'jobright-resolution-checkpoint@999',
      },
      coverage: {
        start: '2026-06-01T12:00:00.000Z',
        end: '2026-06-10T12:00:00.000Z',
      },
      savedAt: '2026-06-10T12:00:01.000Z',
    })

    const error = await repository.reconcileInstalledConnector({
      connectorInstanceId: 'jobright-invalid',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    }).catch((reason: unknown) => reason)

    expect(error).toEqual(new Error(
      'Jobright connector state could not be upgraded safely. Restore a compatible app version or reconnect Jobright and start a new connector instance.',
    ))
    expect(String(error)).not.toMatch(/never-leak|@999/)
    await expect(repository.getInstance('jobright-invalid')).resolves.toMatchObject({
      connectorVersion: '0.4.3',
    })
    await expect(repository.listCheckpoints({
      connectorInstanceId: 'jobright-invalid',
    })).resolves.toHaveLength(1)
  })

  it('rolls back malformed historical observation state with sanitized guidance', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))

    await repository.upsertInstance({
      id: 'jobright-malformed-observation',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
    })
    await recordLegacyJobrightScope({
      repository,
      connectorInstanceId: 'jobright-malformed-observation',
      completedAt: '2026-06-02T12:00:01.000Z',
      filterSignature: 'filters:{"roleTerms":["intern"]}',
      checkpoint: jobrightV3Checkpoint({
        cycleId: 'malformed-cycle',
        processedSourceIds: ['jobright.public:malformed'],
      }),
      observations: [jobrightHistoricalObservation({
        cycleId: 'malformed-cycle',
        destinationClass: 'employer_or_ats',
        observedAt: '2026-06-02T12:00:00.000Z',
        officialUrl: 'https://jobs.example.test/malformed',
        sourceRecordKey: 'jobright.public:malformed',
        status: 'resolved',
      })],
    })
    sqlite.prepare(
      'UPDATE connector_observations SET resolution_json = ? WHERE connector_instance_id = ?',
    ).run('{"status":"resolved","private":"never-leak"', 'jobright-malformed-observation')

    const error = await repository.reconcileInstalledConnector({
      connectorInstanceId: 'jobright-malformed-observation',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.5.0',
    }).catch((reason: unknown) => reason)

    expect(error).toEqual(new Error(
      'Jobright connector state could not be upgraded safely. Restore a compatible app version or reconnect Jobright and start a new connector instance.',
    ))
    expect(String(error)).not.toContain('never-leak')
    await expect(repository.getInstance('jobright-malformed-observation')).resolves.toMatchObject({
      connectorVersion: '0.4.3',
    })
    await expect(repository.listCheckpoints({
      connectorInstanceId: 'jobright-malformed-observation',
    })).resolves.toHaveLength(1)
  })

  it('rejects structurally or relationally invalid released v2 checkpoints atomically', async () => {
    const mutations: Array<[string, (checkpoint: Record<string, unknown>) => void]> = [
      ['empty', (checkpoint) => {
        for (const key of Object.keys(checkpoint)) delete checkpoint[key]
      }],
      ['missing required count', (checkpoint) => { delete checkpoint.attempted }],
      ['null required counts', (checkpoint) => {
        for (const key of Object.keys(checkpoint)) checkpoint[key] = null
      }],
      ['extra field', (checkpoint) => { checkpoint.privateSession = 'never-leak' }],
      ['negative count', (checkpoint) => { checkpoint.filtered = -1 }],
      ['unsafe count', (checkpoint) => {
        checkpoint.discovered = Number.MAX_SAFE_INTEGER + 1
      }],
      ['invalid total available', (checkpoint) => { checkpoint.totalAvailable = -1 }],
      ['resolved exceeds attempts', (checkpoint) => {
        checkpoint.attempted = 1
        checkpoint.eligible = 1
        checkpoint.resolved = 2
      }],
      ['attempted exceeds eligible', (checkpoint) => {
        checkpoint.attempted = 2
        checkpoint.eligible = 1
      }],
      ['outcomes exceed attempt capacity', (checkpoint) => {
        checkpoint.attempted = 2
        checkpoint.eligible = 2
        checkpoint.resolved = 1
        checkpoint.authRequired = 1
        checkpoint.retryableFailures = 1
      }],
      ['filtered exceeds skipped', (checkpoint) => {
        checkpoint.filtered = 2
        checkpoint.skipped = 1
      }],
    ]

    for (const [name, mutate] of mutations) {
      const sqlite = createInMemoryDatabase()
      migrateDatabase(sqlite)
      const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
      const instanceId = `jobright-invalid-v2-${name.replaceAll(' ', '-')}`
      const checkpoint = emptyJobrightV2MigrationCheckpoint() as Record<string, unknown>
      mutate(checkpoint)

      await repository.upsertInstance({
        id: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.4.1',
        displayName: 'Jobright internslist',
        enabled: true,
      })
      await repository.recordCheckpoint({
        connectorInstanceId: instanceId,
        filterSignature: 'filters:{}',
        checkpoint: {
          checkpoint,
          schemaVersion: 'jobright-resolution-checkpoint@2',
        },
        coverage: {
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-02T12:00:00.000Z',
        },
        savedAt: '2026-06-02T12:00:01.000Z',
      })

      const error = await repository.reconcileInstalledConnector({
        connectorInstanceId: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.5.0',
      }).catch((reason: unknown) => reason)

      expect(error, name).toEqual(new Error(
        'Jobright connector state could not be upgraded safely. Restore a compatible app version or reconnect Jobright and start a new connector instance.',
      ))
      expect(String(error), name).not.toContain('never-leak')
      expect(sqlite.prepare(
        'SELECT connector_version AS connectorVersion FROM connector_instances WHERE id = ?',
      ).get(instanceId), name).toEqual({ connectorVersion: '0.4.1' })
      expect(sqlite.prepare(
        'SELECT COUNT(*) AS count FROM connector_checkpoints WHERE connector_instance_id = ?',
      ).get(instanceId), name).toEqual({ count: 1 })
    }
  })

  it('accepts released v2 early failures and seeded counts that exceed new discovery', async () => {
    const checkpoints: Array<[string, Record<string, number>]> = [
      ['early-auth', {
        attempted: 0,
        authRequired: 1,
        discovered: 0,
        eligible: 0,
        filtered: 0,
        rateLimited: 0,
        resolved: 0,
        retryableFailures: 0,
        skipped: 0,
      }],
      ['early-rate-limit', {
        attempted: 0,
        authRequired: 0,
        discovered: 0,
        eligible: 0,
        filtered: 0,
        rateLimited: 1,
        resolved: 0,
        retryableFailures: 0,
        skipped: 0,
      }],
      ['early-retryable', {
        attempted: 0,
        authRequired: 0,
        discovered: 0,
        eligible: 0,
        filtered: 0,
        rateLimited: 0,
        resolved: 0,
        retryableFailures: 1,
        skipped: 0,
      }],
      ['seeded-observations', {
        attempted: 2,
        authRequired: 0,
        discovered: 1,
        eligible: 3,
        filtered: 4,
        rateLimited: 0,
        resolved: 1,
        retryableFailures: 1,
        skipped: 5,
      }],
    ]

    for (const [name, checkpoint] of checkpoints) {
      const sqlite = createInMemoryDatabase()
      migrateDatabase(sqlite)
      const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
      const instanceId = `jobright-valid-v2-${name}`

      await repository.upsertInstance({
        id: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.4.1',
        displayName: 'Jobright internslist',
        enabled: true,
      })
      await repository.recordCheckpoint({
        connectorInstanceId: instanceId,
        filterSignature: 'filters:{}',
        checkpoint: { checkpoint, schemaVersion: 'jobright-resolution-checkpoint@2' },
        coverage: {
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-02T12:00:00.000Z',
        },
        savedAt: '2026-06-02T12:00:01.000Z',
      })

      await expect(repository.reconcileInstalledConnector({
        connectorInstanceId: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.5.0',
      }), name).resolves.toMatchObject({ connectorVersion: '0.5.0', reconciled: true })
    }
  })

  it('rejects malformed persisted instance and v3 checkpoint variants atomically', async () => {
    const checkpointMutations: Array<[string, (checkpoint: Record<string, unknown>) => void]> = [
      ['blank cycle', (checkpoint) => { checkpoint.cycleId = '  ' }],
      ['invalid cycle', (checkpoint) => { checkpoint.cycleId = 'never leak cycle' }],
      ['overlong cycle', (checkpoint) => { checkpoint.cycleId = `x${'y'.repeat(128)}` }],
      ['noncanonical cycle timestamp', (checkpoint) => {
        checkpoint.cycleStartedAt = '2026-05-01'
      }],
      ['horizon before cycle', (checkpoint) => {
        checkpoint.horizonAt = '2026-04-30T12:00:00.000Z'
      }],
      ['page exceeds page count', (checkpoint) => {
        checkpoint.discoveryPage = 2
        checkpoint.discoveryPages = 1
      }],
      ['horizon exceeds released maximum', (checkpoint) => {
        checkpoint.horizonAt = '2030-05-01T12:00:00.000Z'
      }],
      ['missing required field', (checkpoint) => { delete checkpoint.stopReason }],
      ['negative attempts', (checkpoint) => { checkpoint.attempts = -1 }],
      ['unsafe attempts', (checkpoint) => { checkpoint.attempts = Number.MAX_SAFE_INTEGER + 1 }],
      ['negative position', (checkpoint) => { checkpoint.discoveryPosition = -1 }],
      ['unsafe position', (checkpoint) => {
        checkpoint.discoveryPosition = Number.MAX_SAFE_INTEGER + 1
      }],
      ['invalid source id', (checkpoint) => { checkpoint.seenSourceIds = ['never leak source'] }],
      ['duplicate source id', (checkpoint) => {
        checkpoint.processedSourceIds = [
          'jobright.public:valid',
          'jobright.public:valid',
        ]
      }],
      ['negative filtered', (checkpoint) => { checkpoint.filtered = -1 }],
      ['useful count mismatch', (checkpoint) => { checkpoint.usefulEmployerOrAts = 1 }],
      ['extra checkpoint field', (checkpoint) => { checkpoint.privateState = 'never-leak' }],
      ['discovery records mismatch', (checkpoint) => { checkpoint.discoveryRecords = 0 }],
      ['eligible outside seen', (checkpoint) => {
        checkpoint.eligibleSourceIds = ['jobright.public:not-seen']
      }],
      ['processed outside seen', (checkpoint) => {
        checkpoint.processedSourceIds = ['jobright.public:not-seen']
      }],
      ['useful outside processed', (checkpoint) => {
        checkpoint.processedSourceIds = []
        checkpoint.usefulEmployerOrAts = 1
        checkpoint.usefulEmployerOrAtsSourceIds = ['jobright.public:valid']
      }],
      ['unresolved outside processed', (checkpoint) => {
        checkpoint.processedSourceIds = []
        checkpoint.unresolvedSourceIds = ['jobright.public:valid']
      }],
      ['useful classes overlap', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.usefulEmployerOrAts = 1
        checkpoint.usefulEmployerOrAtsSourceIds = ['jobright.public:valid']
        checkpoint.usefulThirdParty = 1
        checkpoint.usefulThirdPartySourceIds = ['jobright.public:valid']
      }],
      ['useful and unresolved overlap', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.usefulEmployerOrAts = 1
        checkpoint.usefulEmployerOrAtsSourceIds = ['jobright.public:valid']
        checkpoint.unresolvedSourceIds = ['jobright.public:valid']
      }],
      ['retry outside seen', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.eligibleSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.retryState = [{
          attempts: 1,
          reason: 'jobright_detail_retryable',
          sourceId: 'jobright.public:retry',
        }]
      }],
      ['retry outside eligible', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.discoveryRecords = 2
        checkpoint.seenSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.retryState = [{
          attempts: 1,
          reason: 'jobright_detail_retryable',
          sourceId: 'jobright.public:retry',
        }]
      }],
      ['retry overlaps processed', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.retryState = [{
          attempts: 1,
          reason: 'jobright_detail_retryable',
          sourceId: 'jobright.public:valid',
        }]
      }],
      ['retry exceeds attempt capacity', (checkpoint) => {
        checkpoint.discoveryRecords = 2
        checkpoint.eligibleSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.seenSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.retryState = [{
          attempts: 1,
          reason: 'jobright_detail_retryable',
          sourceId: 'jobright.public:retry',
        }]
      }],
      ['duplicate retry source', (checkpoint) => {
        checkpoint.attempts = 3
        checkpoint.discoveryRecords = 2
        checkpoint.eligibleSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.seenSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.retryState = [
          {
            attempts: 1,
            reason: 'jobright_detail_retryable',
            sourceId: 'jobright.public:retry',
          },
          {
            attempts: 1,
            reason: 'jobright_retry_deferred',
            sourceId: 'jobright.public:retry',
          },
        ]
      }],
      ['retry extra field', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.discoveryRecords = 2
        checkpoint.eligibleSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.seenSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.retryState = [{
          attempts: 1,
          privateToken: 'never-leak',
          reason: 'jobright_detail_retryable',
          sourceId: 'jobright.public:retry',
        }]
      }],
      ['unknown retry reason', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.discoveryRecords = 2
        checkpoint.eligibleSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.seenSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.retryState = [{
          attempts: 1,
          reason: 'never-leak-reason',
          sourceId: 'jobright.public:retry',
        }]
      }],
      ['noncanonical retry after', (checkpoint) => {
        checkpoint.attempts = 2
        checkpoint.discoveryRecords = 2
        checkpoint.eligibleSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.seenSourceIds = ['jobright.public:valid', 'jobright.public:retry']
        checkpoint.retryState = [{
          attempts: 1,
          reason: 'jobright_detail_retryable',
          retryAfter: '2026-06-03',
          sourceId: 'jobright.public:retry',
        }]
      }],
      ['outcome capacity exceeded', (checkpoint) => {
        checkpoint.usefulEmployerOrAts = 1
        checkpoint.usefulEmployerOrAtsSourceIds = ['jobright.public:valid']
        checkpoint.unresolvedSourceIds = ['jobright.public:valid-2']
        checkpoint.discoveryRecords = 2
        checkpoint.eligibleSourceIds = ['jobright.public:valid', 'jobright.public:valid-2']
        checkpoint.processedSourceIds = ['jobright.public:valid', 'jobright.public:valid-2']
        checkpoint.seenSourceIds = ['jobright.public:valid', 'jobright.public:valid-2']
      }],
      ['processed count exceeds accounting', (checkpoint) => {
        checkpoint.attempts = 0
      }],
      ['total below discovery position', (checkpoint) => { checkpoint.totalAvailable = 19 }],
      ['last page size without request', (checkpoint) => {
        checkpoint.lastDiscoveryRequestCount = null
      }],
      ['last request without page size', (checkpoint) => {
        checkpoint.lastDiscoveryPageSize = null
      }],
      ['last page exceeds request', (checkpoint) => {
        checkpoint.lastDiscoveryPageSize = 21
      }],
      ['last page pair without pages', (checkpoint) => { checkpoint.discoveryPages = 0 }],
    ]
    const rowMutations: Array<[string, (sqlite: ReturnType<typeof createInMemoryDatabase>) => void]> = [
      ['non-array auth', (sqlite) => {
        sqlite.prepare('UPDATE connector_instances SET auth_json = ?').run('{"private":"never-leak"}')
      }],
      ['malformed auth reference', (sqlite) => {
        sqlite.prepare('UPDATE connector_instances SET auth_json = ?').run(
          '[{"id":"","mode":"username_password","secretKey":"never-leak"}]',
        )
      }],
      ['invalid config', (sqlite) => {
        sqlite.prepare('UPDATE connector_instances SET config_json = ?').run('[]')
      }],
      ['invalid filters', (sqlite) => {
        sqlite.prepare('UPDATE connector_instances SET filters_json = ?').run('[]')
      }],
      ['unknown schema', (sqlite) => {
        sqlite.prepare('UPDATE connector_checkpoints SET schema_version = ?').run(
          'jobright-resolution-checkpoint@never-leak',
        )
      }],
    ]
    const probes: Array<[string, (sqlite: ReturnType<typeof createInMemoryDatabase>) => void]> = [
      ...checkpointMutations.map(([name, mutate]) => [name, (sqlite) => {
        const row = sqlite.prepare('SELECT checkpoint_json FROM connector_checkpoints').get() as {
          checkpoint_json: string
        }
        const checkpoint = JSON.parse(row.checkpoint_json) as Record<string, unknown>
        mutate(checkpoint)
        sqlite.prepare('UPDATE connector_checkpoints SET checkpoint_json = ?').run(
          JSON.stringify(checkpoint),
        )
      }] as [string, (sqlite: ReturnType<typeof createInMemoryDatabase>) => void]),
      ...rowMutations,
    ]

    for (const [name, mutate] of probes) {
      const sqlite = createInMemoryDatabase()
      migrateDatabase(sqlite)
      const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
      const instanceId = `jobright-invalid-${name.replaceAll(' ', '-')}`

      await repository.upsertInstance({
        id: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.4.3',
        displayName: 'Jobright internslist',
        enabled: true,
        auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-secret' }],
        config: {},
        filters: {},
      })
      await repository.recordCheckpoint({
        connectorInstanceId: instanceId,
        filterSignature: 'filters:{"probe":"never-leak"}',
        checkpoint: {
          checkpoint: jobrightV3Checkpoint({
            cycleId: 'valid-cycle',
            processedSourceIds: ['jobright.public:valid'],
          }),
          schemaVersion: 'jobright-resolution-checkpoint@3',
        },
        coverage: {
          start: '2026-06-01T12:00:00.000Z',
          end: '2026-06-02T12:00:00.000Z',
        },
        savedAt: '2026-06-02T12:00:01.000Z',
      })
      mutate(sqlite)

      const error = await repository.reconcileInstalledConnector({
        connectorInstanceId: instanceId,
        connectorId: 'jobright.resolver',
        connectorVersion: '0.5.0',
      }).catch((reason: unknown) => reason)

      expect(error, name).toEqual(new Error(
        'Jobright connector state could not be upgraded safely. Restore a compatible app version or reconnect Jobright and start a new connector instance.',
      ))
      expect(String(error), name).not.toContain('never-leak')
      expect(sqlite.prepare(
        'SELECT connector_version AS connectorVersion FROM connector_instances WHERE id = ?',
      ).get(instanceId), name).toEqual({ connectorVersion: '0.4.3' })
      expect(sqlite.prepare(
        'SELECT COUNT(*) AS count FROM connector_checkpoints WHERE connector_instance_id = ?',
      ).get(instanceId), name).toEqual({ count: 1 })
    }
  })

  it('reconciles before a filter-only local settings update that omits the version', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-reconcile-')),
      'valedictorian.sqlite',
    )
    const client = createLocalValedictorianClient({ sqlitePath })
    const sqlite = createFileDatabase(sqlitePath)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))

    await repository.upsertInstance({
      id: 'jobright-settings',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{ id: 'jobright', mode: 'username_password', secretKey: 'jobright-secret' }],
      filters: { roleTerms: ['intern'] },
    })

    const updated = await client.connectors.update({
      connectorInstanceId: 'jobright-settings',
      filters: { roleTerms: ['new grad'] },
    })

    expect(updated).toMatchObject({
      connectorVersion: '0.5.0',
      filters: { roleTerms: ['new grad'] },
    })
    sqlite.close()
  })

  it('reconciles before a credential-only local settings update that omits the version', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-auth-reconcile-')),
      'valedictorian.sqlite',
    )
    const client = createLocalValedictorianClient({ sqlitePath })
    const sqlite = createFileDatabase(sqlitePath)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))

    await repository.upsertInstance({
      id: 'jobright-credentials',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.1',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [],
      filters: { roleTerms: ['intern'] },
    })

    const updated = await client.connectors.update({
      connectorInstanceId: 'jobright-credentials',
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        secretKey: 'connector_jobright_credentials_jobright-credentials',
      }],
    })

    expect(updated).toMatchObject({
      connectorVersion: '0.5.0',
      auth: [{ configured: true, id: 'jobright', mode: 'username_password' }],
    })
    expect(JSON.stringify(updated)).not.toContain('secretKey')
    sqlite.close()
  })

  it('reconciles a stale instance before startup catch-up executes it', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-startup-reconcile-')),
      'valedictorian.sqlite',
    )
    const observedVersions: string[] = []
    let repository: ReturnType<typeof createSqliteConnectorRepository>
    const connector: AppJobConnector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.5.0',
        capabilities: { supportsFiltering: false },
      },
      async refresh(input) {
        observedVersions.push(
          (await repository.getInstance(input.connectorInstanceId))?.connectorVersion ?? 'missing',
        )
        return {
          observations: [],
          nextCheckpoint: {
            checkpoint: { cycleId: 'startup-cycle' },
            schemaVersion: 'jobright-resolution-checkpoint@3',
          },
          coverage: input.coverage,
          stats: { observations: 0 },
          warnings: [],
        }
      },
    }
    const client = createLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'jobright.resolver' ? connector : null
        },
      },
      now: () => new Date('2026-06-11T12:00:00.000Z'),
      sqlitePath,
    })
    const sqlite = createFileDatabase(sqlitePath)
    repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))

    await repository.upsertInstance({
      id: 'jobright-startup',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.3',
      displayName: 'Jobright internslist',
      enabled: true,
      filters: { roleTerms: ['intern'] },
      createdAt: '2026-06-10T12:00:00.000Z',
    })

    await client.connectors.runs.startupCatchUp()

    expect(observedVersions).toEqual(['0.5.0'])
    sqlite.close()
  })

  it('accepts an HTTP filters-only PATCH against an old persisted version', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-reconcile-')),
      'valedictorian.sqlite',
    )
    const client = createLocalValedictorianClient({ sqlitePath, workspaceId: 'workspace-http' })
    const sqlite = createFileDatabase(sqlitePath)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))

    await repository.upsertInstance({
      id: 'jobright-http',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.1',
      displayName: 'Jobright internslist',
      enabled: true,
      filters: { roleTerms: ['intern'] },
    })
    const server = await createValedictorianHttpServer({ client, port: 0 })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-http/connectors/jobright-http`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filters: { roleTerms: ['new grad'] } }),
      },
    )
    const updated = await response.json()

    expect(response.status).toBe(200)
    expect(updated).toMatchObject({
      connectorVersion: '0.5.0',
      filters: { roleTerms: ['new grad'] },
    })
    await server.close()
    sqlite.close()
  })
})

function jobrightObservation({
  cycleId,
  sourceRecordKey,
  status,
}: {
  cycleId: string
  sourceRecordKey: string
  status: 'closed' | 'hidden'
}) {
  return {
    connectorId: 'jobright.public',
    connectorVersion: '0.4.3',
    parserVersion: 'jobright-api@2',
    observationSchemaVersion: 'job-observation@2',
    sourceRecordKey,
    observedAt: '2026-06-10T12:00:00.000Z',
    companyName: 'Example Robotics',
    roleTitle: 'Software Engineering Intern',
    links: {
      source: 'https://jobright.ai/jobs/info/closed',
      intermediary: 'https://jobright.ai/jobs/info/closed',
      official: null,
    },
    resolution: { status, method: 'jobright_visitor_list', reason: status },
    dedupeKeys: [sourceRecordKey],
    sourceMetadata: { jobrightCycleId: cycleId, jobrightId: 'closed' },
    evidence: [],
  }
}

function emptyJobrightV2MigrationCheckpoint() {
  return {
    attempted: 0,
    authRequired: 0,
    discovered: 0,
    eligible: 0,
    filtered: 0,
    rateLimited: 0,
    resolved: 0,
    retryableFailures: 0,
    skipped: 0,
    totalAvailable: null,
  }
}

async function recordLegacyJobrightScope({
  repository,
  connectorInstanceId,
  completedAt,
  filterSignature,
  checkpoint,
  observations,
}: {
  repository: ReturnType<typeof createSqliteConnectorRepository>
  connectorInstanceId: string
  completedAt: string
  filterSignature: string
  checkpoint: Record<string, unknown>
  observations: ConnectorObservationInput[]
}) {
  await repository.recordRefreshResult({
    connectorInstanceId,
    mode: 'catch_up',
    startedAt: completedAt,
    completedAt,
    config: {},
    filters: {},
    filterSignature,
    result: {
      observations,
      nextCheckpoint: {
        checkpoint,
        schemaVersion: 'jobright-resolution-checkpoint@3',
      },
      coverage: {
        start: '2026-05-01T12:00:00.000Z',
        end: completedAt,
      },
      stats: { observations: observations.length },
      warnings: [],
    },
  })
}

function jobrightV3Checkpoint({
  attempts,
  cycleId,
  eligibleSourceIds,
  processedSourceIds,
  retryState = [],
  seenSourceIds,
  unresolvedSourceIds = [],
  usefulEmployerOrAtsSourceIds = [],
}: {
  attempts?: number
  cycleId: string
  eligibleSourceIds?: string[]
  processedSourceIds: string[]
  retryState?: Array<{ attempts: number; reason: string; sourceId: string }>
  seenSourceIds?: string[]
  unresolvedSourceIds?: string[]
  usefulEmployerOrAtsSourceIds?: string[]
}) {
  const canonicalSeenSourceIds = seenSourceIds ?? processedSourceIds
  const canonicalEligibleSourceIds = eligibleSourceIds ?? canonicalSeenSourceIds
  const canonicalAttempts = attempts
    ?? processedSourceIds.length
      + retryState.reduce((sum, entry) => sum + entry.attempts, 0)

  return {
    attempts: canonicalAttempts,
    cycleId,
    cycleStartedAt: '2026-05-01T12:00:00.000Z',
    discoveryPage: 1,
    discoveryPages: 1,
    discoveryPosition: 20,
    discoveryRecordLimitReached: false,
    discoveryRecords: canonicalSeenSourceIds.length,
    eligibleSourceIds: canonicalEligibleSourceIds,
    filtered: 0,
    horizonAt: '2026-07-01T12:00:00.000Z',
    lastDiscoveryPageSize: 20,
    lastDiscoveryRequestCount: 20,
    processedSourceIds,
    retryState,
    seenSourceIds: canonicalSeenSourceIds,
    skipped: 0,
    stopReason: 'soft_batch_boundary',
    totalAvailable: 200,
    unresolvedSourceIds,
    usefulEmployerOrAts: usefulEmployerOrAtsSourceIds.length,
    usefulEmployerOrAtsSourceIds,
    usefulThirdParty: 0,
    usefulThirdPartySourceIds: [],
  }
}

function jobrightHistoricalObservation({
  cycleId,
  destinationClass,
  observedAt,
  officialUrl = null,
  reason = null,
  sourceRecordKey,
  status,
}: {
  cycleId: string
  destinationClass?: 'employer_or_ats' | 'third_party_job_posting'
  observedAt: string
  officialUrl?: string | null
  reason?: string | null
  sourceRecordKey: string
  status: 'resolved' | 'unresolved'
}): ConnectorObservationInput {
  const jobrightId = sourceRecordKey.split(':').at(-1) ?? sourceRecordKey
  const intermediary = `https://jobright.ai/jobs/info/${jobrightId}`

  return {
    connectorId: 'jobright.public',
    connectorVersion: '0.4.3',
    parserVersion: 'jobright-api@2',
    observationSchemaVersion: 'job-observation@2',
    sourceRecordKey,
    observedAt,
    companyName: 'Example Robotics',
    roleTitle: 'Software Engineering Intern',
    links: { source: intermediary, intermediary, official: officialUrl },
    resolution: { status, method: 'jobright_api_detail', reason },
    dedupeKeys: [sourceRecordKey],
    sourceMetadata: {
      jobrightCycleId: cycleId,
      jobrightId,
      ...(destinationClass ? { destinationClass } : {}),
    },
    evidence: [],
  }
}

function jobrightJsonResponse(
  result: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ success: true, result }), {
    headers: { 'content-type': 'application/json', ...headers },
    status: 200,
  })
}

function jobrightVisitorRow(jobrightId: string, roleTitle: string) {
  return {
    jobResult: {
      jobId: jobrightId,
      jobTitle: roleTitle,
      companyName: 'Example Robotics',
    },
    companyResult: { companyName: 'Example Robotics' },
  }
}
