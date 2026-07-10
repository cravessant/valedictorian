import { describe, expect, it } from 'vitest'
import { sourcingFindings } from '../../db/schema'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteSourcingRepository } from '../sourcing/sourcing.repository'
import { createSqliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import { createSqliteConnectorProjectionService } from './connector.projection'
import { createSqliteConnectorRepository } from './connector.repository'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'

describe('connector projection service', () => {
  it('persists truthful destination provenance for a production-shaped 20 observation batch', async () => {
    const context = createProjectionTestContext()

    await context.register()
    for (let index = 0; index < 20; index += 1) {
      const destinationClass = index < 6
        ? 'employer_or_ats'
        : index < 8
          ? 'third_party_job_posting'
          : null
      const destinationUrl = destinationClass === 'employer_or_ats'
        ? `https://jobs.example.com/apply/intern-${index}`
        : destinationClass === 'third_party_job_posting'
          ? `https://www.linkedin.com/jobs/view/intern-${index}`
          : null

      await context.recordAndProject({
        destinationClass,
        observedAt: `2026-07-08T18:${String(index).padStart(2, '0')}:00.000Z`,
        officialUrl: destinationClass === 'employer_or_ats' ? destinationUrl : null,
        roleTitle: `Software Engineering Intern ${index}`,
        sourceRecordKey: `jobright.resolver:job-${index}`,
        sourceUrl: destinationClass === 'third_party_job_posting'
          ? destinationUrl
          : `https://jobright.ai/jobs/info/job-${index}`,
        intermediaryUrl: `https://jobright.ai/jobs/info/job-${index}`,
      })
    }

    const sourcingRepository = createSqliteSourcingRepository(context.database)
    const usable = await sourcingRepository.listFindings({ usability: 'usable' })
    const employerOrAts = await sourcingRepository.listFindings({
      destinationClass: 'employer_or_ats',
    })
    const thirdParty = await sourcingRepository.listFindings({
      destinationClass: 'third_party_job_posting',
    })
    const reviewOnly = await sourcingRepository.listFindings({ usability: 'review_only' })

    expect({
      employerOrAts: employerOrAts.total,
      projectedUsable: usable.total,
      retainedForReview: reviewOnly.total,
      thirdParty: thirdParty.total,
    }).toEqual({
      employerOrAts: 6,
      projectedUsable: 8,
      retainedForReview: 12,
      thirdParty: 2,
    })
    expect(employerOrAts.items[0]).toMatchObject({
      destinationClass: 'employer_or_ats',
      destinationUrl: expect.stringContaining('jobs.example.com/apply/'),
      intermediaryUrl: expect.stringContaining('jobright.ai/jobs/info/'),
      usability: 'usable',
    })
    expect(thirdParty.items[0]).toMatchObject({
      destinationClass: 'third_party_job_posting',
      destinationUrl: expect.stringContaining('linkedin.com/jobs/view/'),
      officialUrl: null,
      intermediaryUrl: expect.stringContaining('jobright.ai/jobs/info/'),
      usability: 'usable',
    })
    expect(reviewOnly.items[0]).toMatchObject({
      destinationClass: null,
      destinationUrl: null,
      officialUrl: null,
      intermediaryUrl: expect.stringContaining('jobright.ai/jobs/info/'),
      usability: 'review_only',
      mergeStatus: 'blocked',
    })
  })

  it('projects fixture observations into one sourcing finding by normalized official URL and updates it', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      observedAt: '2026-07-08T18:00:00.000Z',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern?utm_source=first',
      sourceRecordKey: 'fixture.jobs:first-official',
      sourceUrl: 'https://example.test/jobs/first-official',
    })
    const second = await context.recordAndProject({
      observedAt: '2026-07-08T19:00:00.000Z',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern?utm_source=second',
      roleTitle: 'Software Engineering Intern, Summer 2027',
      sourceRecordKey: 'fixture.jobs:second-official',
      sourceUrl: 'https://example.test/jobs/second-official',
    })

    expect(second.finding.id).toBe(first.finding.id)
    expect(second.finding).toMatchObject({
      companyName: 'Example Robotics',
      roleTitle: 'Software Engineering Intern, Summer 2027',
      roleKind: 'internship',
      workMode: 'remote',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern',
      sourceUrl: 'https://example.test/jobs/second-official',
      mergeStatus: 'new',
    })
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(1)
    await expect(
      context.connectorRepository.listObservations({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        descriptionText: 'Build fixture robots and connector proofs.',
        evidence: [
          {
            type: 'fixture',
            capturedAt: '2026-07-08T18:00:00.000Z',
            sourceUrl: 'https://example.test/jobs/first-official',
          },
        ],
        resolution: {
          status: 'resolved',
          method: 'fixture',
          reason: null,
        },
        sourceRecordKey: 'fixture.jobs:first-official',
        sourceMetadata: {
          destinationClass: 'employer_or_ats',
          fixture: true,
        },
        sourcingFindingId: first.finding.id,
      }),
      expect.objectContaining({
        sourceRecordKey: 'fixture.jobs:second-official',
        sourcingFindingId: first.finding.id,
      }),
    ])
  })

  it('dedupes by provider or intermediary id when official URLs are absent', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      dedupeKeys: ['provider:jobright:job-123'],
      officialUrl: null,
      observedAt: '2026-07-08T18:00:00.000Z',
      sourceRecordKey: 'fixture.jobs:first-provider',
      sourceUrl: 'https://example.test/jobs/provider-first',
    })
    const second = await context.recordAndProject({
      dedupeKeys: ['provider:jobright:job-123'],
      officialUrl: null,
      observedAt: '2026-07-08T19:00:00.000Z',
      roleTitle: 'Software Engineering Intern - Provider Updated',
      sourceRecordKey: 'fixture.jobs:second-provider',
      sourceUrl: 'https://example.test/jobs/provider-second',
    })

    expect(second.finding.id).toBe(first.finding.id)
    expect(second.finding.roleTitle).toBe('Software Engineering Intern - Provider Updated')
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(1)
  })

  it('treats provider and intermediary id prefixes as the same dedupe identity', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      dedupeKeys: ['provider:jobright:job-456'],
      officialUrl: null,
      observedAt: '2026-07-08T18:00:00.000Z',
      sourceRecordKey: 'fixture.jobs:first-provider-alias',
      sourceUrl: 'https://example.test/jobs/provider-alias-first',
    })
    const second = await context.recordAndProject({
      dedupeKeys: ['intermediary_id:jobright:job-456'],
      officialUrl: null,
      observedAt: '2026-07-08T19:00:00.000Z',
      roleTitle: 'Software Engineering Intern - Provider Alias Updated',
      sourceRecordKey: 'fixture.jobs:second-provider-alias',
      sourceUrl: 'https://example.test/jobs/provider-alias-second',
    })

    expect(second.finding.id).toBe(first.finding.id)
    expect(second.finding.roleTitle).toBe('Software Engineering Intern - Provider Alias Updated')
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(1)
  })

  it('dedupes by normalized source detail URL when official and provider keys are absent', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      dedupeKeys: [],
      officialUrl: null,
      observedAt: '2026-07-08T18:00:00.000Z',
      sourceRecordKey: 'fixture.jobs:first-source-url',
      sourceUrl: 'https://example.test/jobs/source-url?utm_source=first',
    })
    const second = await context.recordAndProject({
      dedupeKeys: [],
      officialUrl: null,
      observedAt: '2026-07-08T19:00:00.000Z',
      roleTitle: 'Software Engineering Intern - Source Updated',
      sourceRecordKey: 'fixture.jobs:second-source-url',
      sourceUrl: 'https://example.test/jobs/source-url?utm_source=second',
    })

    expect(second.finding.id).toBe(first.finding.id)
    expect(second.finding.roleTitle).toBe('Software Engineering Intern - Source Updated')
    expect(second.finding.sourceUrl).toBe('https://example.test/jobs/source-url?utm_source=second')
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(1)
  })

  it('dedupes by connector source record key when link keys are absent', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      dedupeKeys: [],
      officialUrl: null,
      observedAt: '2026-07-08T18:00:00.000Z',
      sourceRecordKey: 'fixture.jobs:stable-source-record',
      sourceUrl: 'https://example.test/jobs/source-record-first',
    })
    const second = await context.recordAndProject({
      dedupeKeys: [],
      officialUrl: null,
      observedAt: '2026-07-08T19:00:00.000Z',
      roleTitle: 'Software Engineering Intern - Source Record Updated',
      sourceRecordKey: 'fixture.jobs:stable-source-record',
      sourceUrl: 'https://example.test/jobs/source-record-second',
    })

    expect(second.finding.id).toBe(first.finding.id)
    expect(second.finding.roleTitle).toBe('Software Engineering Intern - Source Record Updated')
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(1)
  })

  it('dedupes by content hash when explicit link and source-record keys differ', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      dedupeKeys: [],
      officialUrl: null,
      observedAt: '2026-07-08T18:00:00.000Z',
      sourceRecordKey: 'fixture.jobs:first-content',
      sourceUrl: null,
    })
    const second = await context.recordAndProject({
      dedupeKeys: [],
      officialUrl: null,
      observedAt: '2026-07-08T18:30:00.000Z',
      sourceRecordKey: 'fixture.jobs:second-content',
      sourceUrl: null,
    })

    expect(second.finding.id).toBe(first.finding.id)
    expect(second.finding.mergeStatus).toBe('blocked')
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(1)
  })

  it('does not use content hash fallback when stronger official URL keys differ', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      observedAt: '2026-07-08T18:00:00.000Z',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern-one',
      sourceRecordKey: 'fixture.jobs:first-content-with-official',
      sourceUrl: null,
    })
    const second = await context.recordAndProject({
      observedAt: '2026-07-08T18:30:00.000Z',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern-two',
      sourceRecordKey: 'fixture.jobs:second-content-with-official',
      sourceUrl: null,
    })

    expect(second.finding.id).not.toBe(first.finding.id)
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(2)
  })

  it('does not merge different official URLs through a weaker shared source URL', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      observedAt: '2026-07-08T18:00:00.000Z',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern-one',
      sourceRecordKey: 'fixture.jobs:first-official-conflict',
      sourceUrl: 'https://example.test/jobs/shared-source',
    })
    const second = await context.recordAndProject({
      observedAt: '2026-07-08T18:30:00.000Z',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern-two',
      sourceRecordKey: 'fixture.jobs:second-official-conflict',
      sourceUrl: 'https://example.test/jobs/shared-source',
    })
    const third = await context.recordAndProject({
      observedAt: '2026-07-08T19:00:00.000Z',
      officialUrl: null,
      roleTitle: 'Software Engineering Intern - Shared Source Follow Up',
      sourceRecordKey: 'fixture.jobs:third-official-conflict',
      sourceUrl: 'https://example.test/jobs/shared-source',
    })

    expect(second.finding.id).not.toBe(first.finding.id)
    expect(first.finding.officialUrl).toBe(
      'https://jobs.example.com/apply/software-engineering-intern-one',
    )
    expect(second.finding.officialUrl).toBe(
      'https://jobs.example.com/apply/software-engineering-intern-two',
    )
    expect(third.finding.id).toBe(first.finding.id)
    expect(third.finding.officialUrl).toBe(
      'https://jobs.example.com/apply/software-engineering-intern-one',
    )
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(2)
  })

  it('does not clear a resolved official URL when a later matching observation is unresolved', async () => {
    const context = createProjectionTestContext()

    await context.register()
    const first = await context.recordAndProject({
      observedAt: '2026-07-08T18:00:00.000Z',
      officialUrl: 'https://jobs.example.com/apply/software-engineering-intern',
      sourceRecordKey: 'fixture.jobs:first-resolution',
      sourceUrl: 'https://example.test/jobs/delayed-resolution',
    })
    const second = await context.recordAndProject({
      observedAt: '2026-07-08T18:30:00.000Z',
      officialUrl: null,
      roleTitle: 'Software Engineering Intern - Still Listed',
      sourceRecordKey: 'fixture.jobs:second-resolution',
      sourceUrl: 'https://example.test/jobs/delayed-resolution',
    })

    expect(second.finding.id).toBe(first.finding.id)
    expect(second.finding.roleTitle).toBe('Software Engineering Intern - Still Listed')
    expect(second.finding.officialUrl).toBe(
      'https://jobs.example.com/apply/software-engineering-intern',
    )
    expect(context.database.select().from(sourcingFindings).all()).toHaveLength(1)
  })

  it('preserves usable destination compatibility mapping after a later unresolved observation', async () => {
    const thirdPartyContext = createProjectionTestContext()
    await thirdPartyContext.register()
    const thirdParty = await thirdPartyContext.recordAndProject({
      dedupeKeys: ['provider:jobright:third-party-123'],
      destinationClass: 'third_party_job_posting',
      intermediaryUrl: 'https://jobright.ai/jobs/info/third-party-123',
      observedAt: '2026-07-08T18:00:00.000Z',
      officialUrl: null,
      sourceRecordKey: 'jobright.resolver:third-party-123',
      sourceUrl: 'https://www.linkedin.com/jobs/view/123',
    })
    const thirdPartyLater = await thirdPartyContext.recordAndProject({
      dedupeKeys: ['provider:jobright:third-party-123'],
      destinationClass: null,
      intermediaryUrl: 'https://jobright.ai/jobs/info/third-party-123',
      observedAt: '2026-07-08T19:00:00.000Z',
      officialUrl: null,
      roleTitle: 'Software Engineering Intern - Still Listed',
      sourceRecordKey: 'jobright.resolver:third-party-123',
      sourceUrl: 'https://jobright.ai/jobs/info/third-party-123',
    })

    expect(thirdPartyLater.finding.id).toBe(thirdParty.finding.id)
    expect(thirdPartyLater.finding).toMatchObject({
      destinationClass: 'third_party_job_posting',
      destinationUrl: 'https://www.linkedin.com/jobs/view/123',
      intermediaryUrl: 'https://jobright.ai/jobs/info/third-party-123',
      officialUrl: null,
      roleTitle: 'Software Engineering Intern - Still Listed',
      sourceUrl: 'https://www.linkedin.com/jobs/view/123',
      usability: 'usable',
    })

    const employerContext = createProjectionTestContext()
    await employerContext.register()
    const employer = await employerContext.recordAndProject({
      dedupeKeys: ['provider:jobright:employer-123'],
      destinationClass: 'employer_or_ats',
      intermediaryUrl: 'https://jobright.ai/jobs/info/employer-123',
      observedAt: '2026-07-08T18:00:00.000Z',
      officialUrl: 'https://jobs.lever.co/example/employer-123',
      sourceRecordKey: 'jobright.resolver:employer-123',
      sourceUrl: 'https://jobright.ai/jobs/info/employer-123',
    })
    const employerLater = await employerContext.recordAndProject({
      dedupeKeys: ['provider:jobright:employer-123'],
      destinationClass: null,
      intermediaryUrl: 'https://jobright.ai/jobs/info/employer-123',
      observedAt: '2026-07-08T19:00:00.000Z',
      officialUrl: null,
      roleTitle: 'Software Engineering Intern - Employer Still Listed',
      sourceRecordKey: 'jobright.resolver:employer-123',
      sourceUrl: 'https://jobright.ai/jobs/info/employer-123',
    })

    expect(employerLater.finding.id).toBe(employer.finding.id)
    expect(employerLater.finding).toMatchObject({
      destinationClass: 'employer_or_ats',
      destinationUrl: 'https://jobs.lever.co/example/employer-123',
      intermediaryUrl: 'https://jobright.ai/jobs/info/employer-123',
      officialUrl: 'https://jobs.lever.co/example/employer-123',
      roleTitle: 'Software Engineering Intern - Employer Still Listed',
      sourceUrl: 'https://jobright.ai/jobs/info/employer-123',
      usability: 'usable',
    })
  })

  it('records projection workflow runs as completed for new sourcing findings', async () => {
    const context = createProjectionTestContext()

    await context.register()
    await context.recordAndProject({
      observedAt: '2026-07-08T18:00:00.000Z',
    })

    await expect(context.workflowRunRepository.listRuns({ runType: 'sourcing' })).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          actorName: 'connector-projection',
          status: 'completed',
          outcome: 'projected',
        }),
      ],
      total: 1,
    })
  })
})

function createProjectionTestContext() {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const database = createDrizzleDatabase(sqlite)
  const connectorRepository = createSqliteConnectorRepository(database)
  const workflowRunRepository = createSqliteWorkflowRunRepository(database)
  const projectionService = createSqliteConnectorProjectionService({
    connectorRepository,
    sourcingRepository: createSqliteSourcingRepository(database),
    workflowRunRepository,
  })
  const runner = createConnectorRunner({
    repository: connectorRepository,
    workspaceId: 'workspace-fixture',
  })
  let runIndex = 0

  return {
    connectorRepository,
    database,
    workflowRunRepository,
    async register() {
      await runner.registerInstance({
        id: 'connector-instance-fixture',
        connector: fixtureConnector({
          observedAt: '2026-07-08T17:00:00.000Z',
        }),
        displayName: 'Fixture jobs',
        enabled: true,
        createdAt: '2026-07-08T16:55:00.000Z',
      })
    },
    async recordAndProject(options: FixtureConnectorOptions) {
      runIndex += 1
      const run = await runner.refresh(fixtureConnector(options), {
        connectorInstanceId: 'connector-instance-fixture',
        mode: 'manual',
        coverage: {
          start: `2026-07-08T${String(16 + runIndex).padStart(2, '0')}:00:00.000Z`,
          end: options.observedAt,
        },
        startedAt: options.observedAt,
        completedAt: options.observedAt.replace('.000Z', '.500Z'),
      })
      const observations = await connectorRepository.listObservations({
        connectorInstanceId: 'connector-instance-fixture',
      })
      const observation = observations.find(
        (item) => item.connectorRunId === run.id,
      ) ?? observations.at(-1)

      return projectionService.projectObservation({
        connectorObservationId: observation?.id ?? '',
      })
    },
  }
}

interface FixtureConnectorOptions {
  companyName?: string
  dedupeKeys?: string[]
  destinationClass?: 'employer_or_ats' | 'third_party_job_posting' | null
  intermediaryUrl?: string | null
  locationRaw?: string | null
  observedAt: string
  officialUrl?: string | null
  roleTitle?: string
  sourceRecordKey?: string
  sourceUrl?: string | null
}

function fixtureConnector({
  companyName = 'Example Robotics',
  dedupeKeys,
  destinationClass,
  intermediaryUrl = null,
  locationRaw = 'Remote',
  observedAt,
  officialUrl = 'https://jobs.example.com/apply/software-engineering-intern',
  roleTitle = 'Software Engineering Intern',
  sourceRecordKey = 'fixture.jobs:software-engineering-intern',
  sourceUrl = 'https://example.test/jobs/software-engineering-intern',
}: FixtureConnectorOptions): AppJobConnector {
  const resolvedDestinationClass = destinationClass === undefined
    ? officialUrl
      ? 'employer_or_ats'
      : null
    : destinationClass

  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      return {
        coverage: input.coverage,
        stats: {
          observations: 1,
        },
        warnings: [],
        nextCheckpoint: {
          checkpoint: {
            cursor: `fixture:${observedAt}`,
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [
          {
            connectorId: 'fixture.jobs',
            connectorVersion: '0.0.0-fixture',
            sourceRecordKey,
            observedAt,
            companyName,
            roleTitle,
            locationRaw,
            descriptionText: 'Build fixture robots and connector proofs.',
            pay: null,
            links: {
              source: sourceUrl,
              intermediary: intermediaryUrl,
              official: officialUrl,
            },
            resolution: {
              status: officialUrl || resolvedDestinationClass ? 'resolved' : 'unresolved',
              method: officialUrl || resolvedDestinationClass ? 'fixture' : null,
              reason: officialUrl || resolvedDestinationClass ? null : 'No fixture official URL.',
            },
            dedupeKeys:
              dedupeKeys ??
              (officialUrl
                ? [`official:${officialUrl}`]
                : [`source:${sourceRecordKey}`]),
            sourceMetadata: {
              fixture: true,
              ...(resolvedDestinationClass ? { destinationClass: resolvedDestinationClass } : {}),
            },
            evidence: [
              {
                type: 'fixture',
                capturedAt: observedAt,
                sourceUrl,
              },
            ],
          },
        ],
      }
    },
  }
}
