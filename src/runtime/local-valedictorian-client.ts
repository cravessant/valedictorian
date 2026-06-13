import fs from 'node:fs'
import type { ValedictorianWorkspaceClient } from 'sparxie'
import { applications } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import {
  seedReferenceTrackerApplications,
  seedSampleApplications,
  seedSampleSourcingFindings,
} from '../modules/applications/application.fixtures'
import { createApplicationServiceFromSqlite } from '../modules/applications/application.runtime'
import { createSqliteQueueRepository } from '../modules/queue/queue.repository'
import { createSqlitePolicyRepository } from '../modules/policy/policy.repository'
import { createSqliteProfileRepository, type ProfileSecretCodec } from '../modules/profile/profile.repository'
import { createSqliteScoringRepository } from '../modules/scoring/scoring.repository'
import { createSqliteSourcingProcessor } from '../modules/sourcing/sourcing.processor'
import { createSqliteSourcingRepository } from '../modules/sourcing/sourcing.repository'
import { createSqliteWorkflowRunRepository } from '../modules/workflow-runs/workflow-run.repository'

export interface LocalValedictorianClientOptions {
  referenceTrackerPath?: string
  seedDataMode?: ValedictorianSeedDataMode
  secretCodec?: ProfileSecretCodec
  sqlitePath: string
}

export type ValedictorianSeedDataMode = 'none' | 'sample' | 'reference-tracker'

const unavailableSecretCodec: ProfileSecretCodec = {
  decrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
  encrypt() {
    throw new Error('Profile secrets are only available through local profile IPC')
  },
}

export function createLocalValedictorianClient({
  referenceTrackerPath,
  seedDataMode = 'none',
  secretCodec = unavailableSecretCodec,
  sqlitePath,
}: LocalValedictorianClientOptions): ValedictorianWorkspaceClient {
  assertSeedOptions({ referenceTrackerPath, seedDataMode })

  const sqlite = createFileDatabase(sqlitePath)
  const applicationService = createApplicationServiceFromSqlite(sqlite)
  const database = createDrizzleDatabase(sqlite)

  seedLocalData(database, {
    referenceTrackerPath,
    seedDataMode,
  })

  const scoringRepository = createSqliteScoringRepository(database)
  const profileRepository = createSqliteProfileRepository(database, secretCodec)
  const queueRepository = createSqliteQueueRepository(database)
  const policyRepository = createSqlitePolicyRepository(database)
  const workflowRunRepository = createSqliteWorkflowRunRepository(database)
  const sourcingProcessor = createSqliteSourcingProcessor(database)
  const sourcingRepository = createSqliteSourcingRepository(database)

  return {
    applications: {
      list: (query) => applicationService.listApplications(query),
      get: (id) => applicationService.getApplication(id),
      create: (input) => applicationService.createApplication(input),
      update: (input) => applicationService.updateApplication(input),
      updateStatus: (input) => applicationService.updateApplicationStatus(input),
      archive: (input) => applicationService.archiveApplication(input),
      workflow: {
        update: (input) => applicationService.updateApplicationWorkflow(input),
      },
      notes: {
        append: (input) => applicationService.appendApplicationNote(input),
      },
      links: {
        list: (input) => applicationService.listApplicationLinks(input),
        create: (input) => applicationService.createApplicationLink(input),
        update: (input) => applicationService.updateApplicationLink(input),
      },
      events: {
        list: (input) => applicationService.listApplicationEvents(input),
      },
      attempts: {
        list: (input) => applicationService.listApplicationAttempts(input),
        start: (input) => applicationService.startApplicationAttempt(input),
        step: (input) => applicationService.createApplicationAttemptStep(input),
        complete: (input) => applicationService.completeApplicationAttempt(input),
      },
    },
    scores: {
      record: (input) => scoringRepository.recordScore(input),
    },
    queue: {
      list: (query) => queueRepository.listQueue(query),
    },
    policy: {
      config: {
        get: () => policyRepository.getConfig(),
        reset: () => policyRepository.resetConfig(),
        update: (patch) => policyRepository.updateConfig(patch),
      },
      evidence: {
        list: (query) => policyRepository.listEvidence(query),
        record: (input) => policyRepository.recordEvidence(input),
      },
      evaluate: {
        application: (input) => policyRepository.evaluateApplication(input),
        sourcingCandidate: (input) => policyRepository.evaluateSourcingCandidate(input),
        runWindow: (input) => policyRepository.evaluateRunWindow(input),
      },
    },
    profile: {
      get: () => profileRepository.getProfile(),
      update: (input) => profileRepository.updateProfile(input),
      agentContext: {
        get: () => profileRepository.getAgentContext(),
      },
      secrets: {
        delete: (key: string) => profileRepository.deleteSecret(key),
        list: () => profileRepository.listSecrets(),
        upsert: (input: Parameters<typeof profileRepository.upsertSecret>[0]) =>
          profileRepository.upsertSecret(input),
      },
      sensitive: {
        get: () => profileRepository.getSensitiveDetails(),
        update: (input: Parameters<typeof profileRepository.updateSensitiveDetails>[0]) =>
          profileRepository.updateSensitiveDetails(input),
      },
    } as ValedictorianWorkspaceClient['profile'],
    secrets: {
      delete: (key) => profileRepository.deleteSecret(key),
      list: async () => ({ items: await profileRepository.listSecrets() }),
      upsert: (input) => profileRepository.upsertSecret(input),
    },
    runs: {
      list: (query) => workflowRunRepository.listRuns(query),
      start: (input) => workflowRunRepository.startRun(input),
      step: (input) => workflowRunRepository.createRunStep(input),
      complete: (input) => workflowRunRepository.completeRun(input),
    },
    sourcing: {
      candidates: {
        process: (input) => sourcingProcessor.processCandidate(input),
      },
      findings: {
        list: (query) => sourcingRepository.listFindings(query),
        create: (input) => sourcingRepository.createFinding(input),
        update: (input) => sourcingRepository.updateFinding(input),
        decide: (input) => sourcingRepository.decideFinding(input),
        promote: (input) => sourcingRepository.promoteFinding(input),
      },
    },
  }
}

function seedLocalData(
  database: ReturnType<typeof createDrizzleDatabase>,
  {
    referenceTrackerPath,
    seedDataMode,
  }: Pick<LocalValedictorianClientOptions, 'referenceTrackerPath' | 'seedDataMode'>,
) {
  if (seedDataMode === 'none') {
    return
  }

  if (database.select().from(applications).limit(1).get()) {
    return
  }

  if (seedDataMode === 'sample') {
    seedSampleApplications(database)
    seedSampleSourcingFindings(database)
    return
  }

  seedReferenceTrackerApplications(
    database,
    fs.readFileSync(requireReferenceTrackerPath(referenceTrackerPath), 'utf8'),
  )
}

function assertSeedOptions({
  referenceTrackerPath,
  seedDataMode,
}: Pick<LocalValedictorianClientOptions, 'referenceTrackerPath' | 'seedDataMode'>) {
  if (seedDataMode === 'reference-tracker' && !referenceTrackerPath) {
    throw new Error(
      'VALEDICTORIAN_REFERENCE_TRACKER_PATH is required when VALEDICTORIAN_SEED_DATA=reference-tracker',
    )
  }
}

function requireReferenceTrackerPath(referenceTrackerPath: string | undefined) {
  if (!referenceTrackerPath) {
    throw new Error(
      'VALEDICTORIAN_REFERENCE_TRACKER_PATH is required when VALEDICTORIAN_SEED_DATA=reference-tracker',
    )
  }

  return referenceTrackerPath
}
