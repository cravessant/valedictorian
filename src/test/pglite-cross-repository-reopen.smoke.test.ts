import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultPolicyConfig } from 'sparxie'
import { opportunities } from '../db/schema'
import { sourceExecutionScopes } from '../db/schema'
import { connectorInstances } from '../db/schema.connectors'
import {
  createPgliteClient,
  migratePgliteDatabase,
} from '../db/pglite'
import { createPgliteActionQueueRepository } from '../modules/action-queue/action-queue.repository'
import { createPgliteApplicationRepository } from '../modules/applications/application.repository'
import { seedSampleApplications } from '../modules/applications/application.fixtures'
import { createConnectorScheduleRepository } from '../modules/connectors/connector-schedule.repository'
import { createPglitePolicyRepository } from '../modules/policy/policy.repository'
import {
  CANONICAL_PROJECTION_TEST_NOW,
  seedPassedCanonicalCandidate,
} from '../modules/sourcing/canonical-candidate.projection.pglite-test-helpers'
import { createCanonicalCandidateProjectionService } from '../modules/sourcing/canonical-candidate.projection'
import { createPgliteSourcingRepository } from '../modules/sourcing/sourcing.repository'
import { createPgliteWorkflowRunRepository } from '../modules/workflow-runs/workflow-run.repository'

const NOW = '2026-07-18T10:00:00.000Z'
const CADENCE = { kind: 'interval' as const, everyMinutes: 60 }
const cleanupPaths = new Set<string>()

afterEach(() => {
  for (const cleanupPath of cleanupPaths) {
    fs.rmSync(cleanupPath, { force: true, recursive: true })
  }
  cleanupPaths.clear()
})

describe('cross-repository PGlite close/reopen smoke', () => {
  it('keeps action-queue, application fixtures, schedule revision, policy, canonical projection, sourcing finding, and workflow run visible after one close and reopen', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pglite-cross-repo-reopen-'))
    cleanupPaths.add(dataDir)
    let sourcingRunId = ''

    const firstClient = await createPgliteClient({ dataDir })
    try {
      const database = await migratePgliteDatabase(firstClient)
      await seedSampleApplications(database)

      const applications = createPgliteApplicationRepository(database)
      await expect(applications.listApplications({ limit: 50, offset: 0 })).resolves.toMatchObject({
        total: 3,
      })

      await database.insert(sourceExecutionScopes).values({
        id: 'scope-cross-reopen',
        status: 'available',
        blockedUntil: null,
        backoffAttempt: 0,
        authGeneration: 0,
        refreshLeaseToken: null,
        refreshLeaseExpiresAt: null,
        actionReason: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      })
      await database.insert(connectorInstances).values({
        id: 'connector-cross-reopen',
        executionScopeId: 'scope-cross-reopen',
        connectorId: 'fixture.connector',
        connectorVersion: '1.0.0',
        displayName: 'Fixture Connector',
        enabled: true,
        configJson: '{}',
        authJson: '[]',
        filtersJson: '{}',
        earliestBackfillDate: '2026-01-01',
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      })
      const schedules = createConnectorScheduleRepository(database, () => new Date(NOW))
      const schedule = await schedules.create({
        connectorInstanceId: 'connector-cross-reopen',
        state: 'enabled',
        cadence: CADENCE,
        timezone: 'UTC',
      })
      await expect(schedules.getRevisionSnapshot(schedule.revision)).resolves.toMatchObject({
        revision: schedule.revision,
        scheduleId: schedule.id,
      })

      const policy = createPglitePolicyRepository(database)
      await expect(policy.getConfig()).resolves.toEqual(defaultPolicyConfig)
      await expect(policy.updateConfig({ scoring: { applyCutoff: 7 } })).resolves.toMatchObject({
        scoring: { applyCutoff: 7 },
      })

      const projected = await seedPassedCanonicalCandidate(database, 'cross-reopen')
      const findingId = await database.transaction((transaction) =>
        createCanonicalCandidateProjectionService(() => new Date(CANONICAL_PROJECTION_TEST_NOW))
          .projectPersisted(transaction, projected.candidateId, projected.rawRevisionId))
      await expect(database.select().from(opportunities)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: findingId,
            companyName: 'Projected Robotics',
            roleTitle: 'Software Intern',
          }),
        ]),
      )

      const workflowRuns = createPgliteWorkflowRunRepository(database)
      const sourcingRun = await workflowRuns.startRun({
        runType: 'sourcing',
        actorType: 'human',
        sourceName: 'Manual',
        summary: 'Cross-repo reopen sourcing.',
      })
      sourcingRunId = sourcingRun.id
      const sourcing = createPgliteSourcingRepository(database)
      const finding = await sourcing.createFinding({
        workflowRunId: sourcingRun.id,
        sourceName: 'Manual',
        companyName: 'Reopen Co',
        roleTitle: 'Software Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        officialUrl: 'https://jobs.example.com/reopen/role-1',
      })
      await expect(sourcing.getFinding(finding.id)).resolves.toMatchObject({
        companyName: 'Reopen Co',
        roleTitle: 'Software Engineering Intern',
      })
      await workflowRuns.completeRun({
        workflowRunId: sourcingRun.id,
        status: 'completed',
        outcome: 'full_coverage',
        summary: 'Cross-repo reopen sourcing completed.',
      })

      const actionQueue = createPgliteActionQueueRepository(database)
      await expect(actionQueue.listActionQueue({ limit: 50, offset: 0 })).resolves.toMatchObject({
        total: expect.any(Number),
      })
      expect((await actionQueue.listActionQueue({ limit: 50, offset: 0 })).total).toBeGreaterThan(0)
    } finally {
      await firstClient.close()
    }

    const secondClient = await createPgliteClient({ dataDir })
    try {
      const database = await migratePgliteDatabase(secondClient)

      await expect(createPgliteApplicationRepository(database).listApplications({ limit: 50, offset: 0 }))
        .resolves.toMatchObject({ total: 3 })

      const schedules = createConnectorScheduleRepository(database, () => new Date(NOW))
      const listed = await schedules.getByConnectorInstanceId('connector-cross-reopen')
      expect(listed).toMatchObject({
        connectorInstanceId: 'connector-cross-reopen',
        state: 'enabled',
      })
      await expect(schedules.getRevisionSnapshot(listed!.revision)).resolves.toMatchObject({
        revision: listed!.revision,
        scheduleId: listed!.id,
      })

      await expect(createPglitePolicyRepository(database).getConfig()).resolves.toMatchObject({
        scoring: { applyCutoff: 7 },
      })

      await expect(database.select().from(opportunities)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            companyName: 'Projected Robotics',
            roleTitle: 'Software Intern',
          }),
        ]),
      )

      const findings = await createPgliteSourcingRepository(database).listFindings({ limit: 50, offset: 0 })
      expect(findings.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          companyName: 'Reopen Co',
          roleTitle: 'Software Engineering Intern',
        }),
      ]))

      await expect(
        createPgliteWorkflowRunRepository(database).listRuns({ sourceId: 'source-manual' }),
      ).resolves.toMatchObject({
        total: 1,
        items: [
          {
            id: sourcingRunId,
            sourceName: 'Manual',
            status: 'completed',
            outcome: 'full_coverage',
            steps: [
              { sequence: 1, type: 'run_started' },
              { sequence: 2, type: 'run_completed' },
            ],
          },
        ],
      })

      expect((await createPgliteActionQueueRepository(database).listActionQueue({
        limit: 50,
        offset: 0,
      })).total).toBeGreaterThan(0)
    } finally {
      await secondClient.close()
    }
  })
})
