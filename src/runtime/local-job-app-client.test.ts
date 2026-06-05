import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applicationScores } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createLocalJobAppClient } from './local-job-app-client'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-app-client-')), 'job-app.sqlite')
}

describe('runtime local job app client', () => {
  it('lists seeded applications with query filters and pagination', async () => {
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })

    await expect(
      client.applications.list({
        limit: 1,
        minScore: 6,
        status: 'needs_user_info',
      }),
    ).resolves.toMatchObject({
      hasMore: false,
      items: [
        {
          companyName: 'Astranis Space Technologies',
          currentPriorityScore: 8,
          status: 'needs_user_info',
        },
      ],
      limit: 1,
      offset: 0,
      total: 1,
    })
  })

  it('gets and updates application status through the local client', async () => {
    const client = createLocalJobAppClient({ sqlitePath: createTempSqlitePath() })

    await expect(client.applications.get('application-astranis-backend')).resolves.toMatchObject({
      companyName: 'Astranis Space Technologies',
      primaryLink: {
        label: 'official',
      },
    })

    await expect(
      client.applications.updateStatus({
        applicationId: 'application-versant-platform',
        notes: 'Submitted from the local runtime client.',
        status: 'submitted',
      }),
    ).resolves.toMatchObject({
      id: 'application-versant-platform',
      notes: 'Submitted from the local runtime client.',
      status: 'submitted',
    })
  })

  it('records scores and updates the current application score', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createLocalJobAppClient({ sqlitePath })

    await client.scores.record({
      applicationId: 'application-jobster-analytics',
      band: 'high',
      careerSignal: 2,
      cityWorkMode: 1,
      compensationLogistics: 1,
      penalties: [],
      rationale: 'Now looks relevant after a closer review.',
      roleRelevance: 3,
      rubricVersion: 'test-rubric',
      score: 7,
    })

    await expect(client.applications.get('application-jobster-analytics')).resolves.toMatchObject({
      currentPriorityBand: 'high',
      currentPriorityScore: 7,
    })

    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)

    expect(database.select().from(applicationScores).all()).toHaveLength(4)
    sqlite.close()
  })
})
