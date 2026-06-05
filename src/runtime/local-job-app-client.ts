import type { JobAppClient } from 'job-app-sdk'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createApplicationServiceFromSqlite } from '../modules/applications/application.runtime'
import { createSqliteScoringRepository } from '../modules/scoring/scoring.repository'

export interface LocalJobAppClientOptions {
  sqlitePath: string
}

export function createLocalJobAppClient({ sqlitePath }: LocalJobAppClientOptions): JobAppClient {
  const sqlite = createFileDatabase(sqlitePath)
  const applicationService = createApplicationServiceFromSqlite(sqlite)
  const scoringRepository = createSqliteScoringRepository(createDrizzleDatabase(sqlite))

  return {
    applications: {
      list: (query) => applicationService.listApplications(query),
      get: (id) => applicationService.getApplication(id),
      updateStatus: (input) => applicationService.updateApplicationStatus(input),
    },
    scores: {
      record: (input) => scoringRepository.recordScore(input),
    },
  }
}
