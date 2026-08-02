import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase, type PgliteDatabase } from '@sparxie/valedictorian-local-runtime/database'
import { applicationScores } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import { createPgliteActionQueueRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/action-queue/action-queue.repository'

describe('canonical Application Action Queue projection', () => {
  let close: (() => Promise<void>) | undefined
  let database: PgliteDatabase

  beforeAll(async () => {
    const client = await createPgliteClient()
    close = () => client.close()
    database = await migratePgliteDatabase(client)
    const at = '2026-07-22T12:00:00.000Z'
    await client.exec(`
      insert into workspaces (id,name,created_at,updated_at) values ('queue-ws','Queue','${at}','${at}');
      insert into jobs (id,workspace_id,facts_revision,facts_json,availability_state,availability_observed_at,availability_revision,created_at,updated_at)
        values ('0198d8ce-7020-7000-8000-000000000001','queue-ws',1,'{"companyName":"Acme","roleTitle":"Engineer","sourceName":"Direct","workMode":"remote","location":{"display":"Denver, CO","city":"Denver","region":"CO","country":"US"}}','open','${at}',1,'${at}','${at}');
      insert into opportunities (id,workspace_id,job_id,revision,fit,rank,cutoff,disposition,created_at,updated_at)
        values ('queue-opportunity','queue-ws','0198d8ce-7020-7000-8000-000000000001',1,'fit',1,'above','pursue','${at}','${at}');
      insert into applications (id,workspace_id,opportunity_id,job_id,revision,status,job_facts_revision,snapshot_json,company_name,source_name,created_at,updated_at)
        values ('queue-application','queue-ws','queue-opportunity','0198d8ce-7020-7000-8000-000000000001',1,'active',1,'{"job":{"facts":{"companyName":"Acme","roleTitle":"Engineer","sourceName":"Direct","workMode":"remote","location":{"display":"Denver, CO","city":"Denver","region":"CO","country":"US"}},"factsRevision":1},"capturedAt":"${at}"}','Acme','Direct','${at}','${at}');
      insert into application_workflow_states (application_id,operational_status,has_applied,created_at,updated_at)
        values ('queue-application','queued',false,'${at}','${at}');
      insert into application_scores (id,application_id,score,band,role_relevance,career_signal,city_work_mode,compensation_logistics,penalties_json,rationale,rubric_version,created_at)
        values ('queue-score','queue-application',9,'high',4,2,2,1,'[]','Strong fit','v1','${at}');
    `)
  })

  afterAll(async () => close?.())

  it('derives the existing policy bucket from canonical Application state', async () => {
    const result = await createPgliteActionQueueRepository(database, {
      now: () => new Date('2026-07-22T12:00:00.000Z'),
    }).listActionQueue()
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'queue-application', actionBucket: 'apply_now', companyName: 'Acme',
      roleTitle: 'Engineer', location: 'Denver, CO', currentPriorityScore: 9,
    })
    expect(result.actionBucketCounts.apply_now).toBe(1)
  })

  it('uses the newest score and breaks equal timestamps by score id', async () => {
    await database.insert(applicationScores).values([
      {
        id: 'score-old', applicationId: 'queue-application', score: 10, band: 'high',
        roleRelevance: 4, careerSignal: 3, cityWorkMode: 2, compensationLogistics: 1,
        penaltiesJson: '[]', rationale: 'Older rescore', rubricVersion: 'v2',
        createdAt: '2026-07-22T13:00:00.000Z',
      },
      {
        id: 'score-a', applicationId: 'queue-application', score: 8, band: 'high',
        roleRelevance: 3, careerSignal: 2, cityWorkMode: 2, compensationLogistics: 1,
        penaltiesJson: '[]', rationale: 'Tie loser', rubricVersion: 'v3',
        createdAt: '2026-07-22T14:00:00.000Z',
      },
      {
        id: 'score-z', applicationId: 'queue-application', score: 3, band: 'skip',
        roleRelevance: 1, careerSignal: 0, cityWorkMode: 1, compensationLogistics: 1,
        penaltiesJson: '[]', rationale: 'Tie winner', rubricVersion: 'v3',
        createdAt: '2026-07-22T14:00:00.000Z',
      },
    ])

    const result = await createPgliteActionQueueRepository(database).listActionQueue()
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'queue-application', currentPriorityScore: 3, currentPriorityBand: 'skip',
      actionBucket: 'skip_below_cutoff',
    })
  })
})
