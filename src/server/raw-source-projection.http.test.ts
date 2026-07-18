import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHttpValedictorianClient } from 'sparxie'
import { afterEach, describe, expect, it } from 'vitest'
import { sourcingProjectionOutcomes } from '../db/schema'
import type { PgliteDatabase } from '../db/pglite'
import type { LocalValedictorianClient } from '../runtime/local-connector-client.contract'
import {
  createLocalValedictorianClient,
  getLocalValedictorianTestDatabase,
} from './local-valedictorian-client.test-harness'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

describe('raw source projection receipt HTTP API', () => {
  let server: StartedValedictorianHttpServer | null = null
  let localClient: LocalValedictorianClient | null = null
  afterEach(async () => { await server?.close(); server = null })

  it('returns not eligible and 404 through the workspace client', async () => {
    const sourcing = await start()
    const intake = await sourcing.rawRecords.ingestBatch({ records: [sparseRecord()] })
    await expect(sourcing.rawRevisions.projection.get(intake.receipts[0].revision.id)).resolves.toMatchObject({
      status: 'not_eligible', rawRecordId: intake.receipts[0].rawRecordId,
      normalizationStatus: 'completed', canonicalCandidateId: null, gateStatus: 'needs_enrichment',
    })
    await expect(sourcing.rawRevisions.projection.get('unknown-revision')).rejects.toMatchObject({
      status: 404,
      body: null,
    })
  })

  it('sees pending before projection and preserves redacted failure evidence', async () => {
    const secret = 'raw-projector-exception-secret'
    let observedPending = false
    const pgliteDataPath = tempPath()
    const sourcing = await start({
      projectCanonicalCandidate: async (transaction) => {
        const [pending] = await transaction.select().from(sourcingProjectionOutcomes).limit(1)
        observedPending = pending?.status === 'pending'
        throw new Error(secret)
      },
    }, pgliteDataPath)
    const intake = await sourcing.rawRecords.ingestBatch({ records: [passedRecord('failure')] })
    const normalization = await sourcing.rawRecords.normalization.get(intake.receipts[0].rawRecordId)
    const projection = await sourcing.rawRevisions.projection.get(intake.receipts[0].revision.id)
    expect(observedPending).toBe(true)
    expect(normalization).toMatchObject({ status: 'completed', gate: { status: 'passed' } })
    expect(projection).toMatchObject({
      status: 'failed', canonicalCandidateId: normalization.canonicalCandidate?.id,
      failure: { code: 'projection_failed', retryable: false },
    })
    expect(JSON.stringify(projection)).not.toContain(secret)
    const database = getLocalValedictorianTestDatabase(localClient!)
    await expect(database.$client.exec("update sourcing_projection_outcomes set status = 'pending', failed_at = null, failure_code = null, failure_retryable = null")).rejects.toThrow(/terminal transition is immutable/i)
    await expect(database.$client.exec("update sourcing_projection_outcomes set status = 'projected', opportunity_id = 'missing', failed_at = null, failure_code = null, failure_retryable = null, projected_at = '2026-07-10T14:00:00.000Z'")).rejects.toThrow(/terminal transition is immutable/i)
    await expect(database.$client.exec("update sourcing_projection_outcomes set updated_at = '2026-07-10T15:00:00.000Z'")).rejects.toThrow(/terminal transition is immutable/i)
  })

  it('retains both revision receipts when strong identity advances one finding', async () => {
    const sourcing = await start()
    const base = passedRecord('stable-role', 'fixture.connector', 'cli', 'stable-provider-job')
    const first = await sourcing.rawRecords.ingestBatch({ records: [base] })
    const second = await sourcing.rawRecords.ingestBatch({ records: [{
      ...base, observedAt: '2026-07-10T13:00:00.000Z',
      payload: { ...base.payload, roleTitle: 'Software Engineering Intern' },
    }] })
    const firstReceipt = await sourcing.rawRevisions.projection.get(first.receipts[0].revision.id)
    const secondReceipt = await sourcing.rawRevisions.projection.get(second.receipts[0].revision.id)
    expect(firstReceipt).toMatchObject({ status: 'projected', finding: { mergeStatus: 'blocked' } })
    expect(secondReceipt).toMatchObject({
      status: 'projected', finding: { id: (firstReceipt as { finding: { id: string } }).finding.id },
    })
    expect(firstReceipt.canonicalCandidateId).not.toBe(secondReceipt.canonicalCandidateId)
  })

  it('rejects impossible status fields and lineage in PGlite', async () => {
    const pgliteDataPath = tempPath()
    const sourcing = await start({}, pgliteDataPath)
    await sourcing.rawRecords.ingestBatch({ records: [passedRecord('constraint')] })
    const database = getLocalValedictorianTestDatabase(localClient!)
    await expect(database.$client.exec(`update sourcing_projection_outcomes
      set status = 'projected', opportunity_id = null, projected_at = null`)).rejects.toThrow(/terminal transition is immutable/i)
    await expect(database.$client.exec(`update sourcing_projection_outcomes
      set capture_lineage_id = 'wrong-lineage'`)).rejects.toThrow(/lineage is immutable/i)
    await expect(database.$client.exec(`insert into sourcing_projection_outcomes
      (id, capture_lineage_id, capture_evidence_version_id, job_fact_version_id, status, created_at, updated_at)
      values ('terminal-direct', 'missing', 'missing', 'missing', 'failed', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z')`)).rejects.toThrow(/must begin pending/i)
    await expect(database.$client.exec("update sourcing_projection_outcomes set status = 'pending', opportunity_id = null, projected_at = null")).rejects.toThrow(/terminal transition is immutable/i)
    await expect(database.$client.exec("update sourcing_projection_outcomes set status = 'failed', opportunity_id = null, projected_at = null, failed_at = '2026-07-10T14:00:00.000Z', failure_code = 'internal_error', failure_retryable = false")).rejects.toThrow(/terminal transition is immutable/i)
    await expect(database.$client.exec("update sourcing_projection_outcomes set created_at = '2026-07-09T12:00:00.000Z'")).rejects.toThrow(/immutable/i)
    await expect(database.$client.exec('delete from sourcing_projection_outcomes')).rejects.toThrow(/append-only/i)
  })

  it('rolls finding creation back when the projected terminal transition fails', async () => {
    const pgliteDataPath = tempPath(), sourcing = await start({}, pgliteDataPath)
    await installTransitionFailure(getLocalValedictorianTestDatabase(localClient!), 'projected')
    const intake = await sourcing.rawRecords.ingestBatch({ records: [passedRecord('projected-transition')] })
    await expect(sourcing.rawRevisions.projection.get(intake.receipts[0].revision.id)).resolves.toMatchObject({
      status: 'failed', failure: { code: 'projection_failed', retryable: false },
    })
    await expect(sourcing.findings.list()).resolves.toMatchObject({ total: 0, items: [] })
  })

  it('leaves a truthful pending receipt when failed terminalization also fails', async () => {
    const pgliteDataPath = tempPath(), sourcing = await start({}, pgliteDataPath)
    const database = getLocalValedictorianTestDatabase(localClient!)
    await installTransitionFailure(database, 'failed')
    await database.$client.exec(`
      create function reject_finding() returns trigger language plpgsql as $$
      begin raise exception 'finding failure'; end;
      $$;
      create trigger reject_finding before insert on opportunities
      for each row execute function reject_finding();
    `)
    const intake = await sourcing.rawRecords.ingestBatch({ records: [passedRecord('failed-transition')] })
    await expect(sourcing.rawRevisions.projection.get(intake.receipts[0].revision.id)).resolves.toMatchObject({
      status: 'pending', normalizationStatus: 'completed', gateStatus: 'passed',
    })
    await expect(sourcing.findings.list()).resolves.toMatchObject({ total: 0, items: [] })
    await database.$client.exec('drop trigger reject_failed_receipt on sourcing_projection_outcomes; drop function reject_failed_receipt();')
    await expect(database.$client.exec("update sourcing_projection_outcomes set status = 'projected'")).rejects.toThrow(/check constraint/i)
    await expect(database.$client.exec("update sourcing_projection_outcomes set status = 'failed', failed_at = '2026-07-10T14:00:00.000Z', failure_code = 'internal_error', failure_retryable = null")).rejects.toThrow(/check constraint/i)
  })

  it('returns the latest replay receipt while retaining prior candidate rows', async () => {
    const pgliteDataPath = tempPath(), sourcing = await start({}, pgliteDataPath)
    const intake = await sourcing.rawRecords.ingestBatch({ records: [passedRecord('replay')] })
    const revisionId = intake.receipts[0].revision.id
    const first = await sourcing.rawRevisions.projection.get(revisionId)
    await sourcing.rawRecords.replay({ selector: { rawRevisionIds: [revisionId] }, invalidate: {} })
    const latest = await sourcing.rawRevisions.projection.get(revisionId)
    expect(latest).toMatchObject({ status: 'projected', rawRevisionId: revisionId })
    expect(latest.canonicalCandidateId).not.toBe(first.canonicalCandidateId)
    const result = await getLocalValedictorianTestDatabase(localClient!).$client.query<{ count: string }>(
      'select count(*) as count from sourcing_projection_outcomes where capture_evidence_version_id = $1',
      [revisionId],
    )
    expect(Number(result.rows[0].count)).toBe(2)
  })

  it('returns existing finding dispositions without projection-only states', async () => {
    const sourcing = await start()
    const client = createHttpValedictorianClient({ baseUrl: server!.url }).forWorkspace('workspace-1')
    const application = await client.applications.create({ companyName: 'Duplicate Co', roleTitle: 'Software Intern', sourceName: 'Manual', roleKind: 'internship', country: 'US', workMode: 'remote', status: 'queued', primaryLink: { kind: 'official', label: 'official', url: 'https://jobs.lever.co/fixture/duplicate' } })
    const records = [
      { ...passedRecord('new'), payload: { ...passedRecord('new').payload, location: { raw: 'New York, NY', country: 'US' } } },
      passedRecord('blocked'),
      { ...passedRecord('not-fit'), payload: { ...passedRecord('not-fit').payload, roleTitle: 'Internist', employmentType: 'FT', location: { raw: 'Boston, MA', country: 'US' } } },
      { ...passedRecord('duplicate'), payload: { ...passedRecord('duplicate').payload, companyName: 'Duplicate Co' } },
    ]
    const intake = await sourcing.rawRecords.ingestBatch({ records })
    const receipts = await Promise.all(intake.receipts.map(({ revision }) => sourcing.rawRevisions.projection.get(revision.id)))
    expect(receipts.map((receipt) => receipt.status === 'projected' ? receipt.finding.mergeStatus : receipt.status)).toEqual(['new', 'blocked', 'not_fit', 'duplicate'])
    expect(receipts[3]).toMatchObject({ status: 'projected', finding: { mergedApplicationId: application.id } })
  })

  async function start(options = {}, pgliteDataPath = tempPath()) {
    localClient = await createLocalValedictorianClient({ pgliteDataPath, ...options })
    server = await createValedictorianHttpServer({
      client: localClient, host: '127.0.0.1', port: 0,
    })
    return createHttpValedictorianClient({ baseUrl: server.url }).forWorkspace('workspace-1').sourcing
  }
})

function tempPath() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'projection-http-')), 'pglite') }
function sparseRecord() { return { intakeItemId: 'sparse-record', adapter: { id: 'valedictorian.cli', kind: 'cli' as const, version: '0.7.6' }, observedAt: '2026-07-10T12:00:00.000Z', payload: { arbitrary: true } } }
function passedRecord(id: string, adapterId = 'valedictorian.cli', kind: 'cli' | 'connector' = 'cli', providerRecordId?: string) { return { intakeItemId: `passed-${id}`, adapter: { id: adapterId, kind, version: '1.0.0' }, providerRecordId, observedAt: '2026-07-10T12:00:00.000Z', payload: { companyName: 'Fixture Robotics', roleTitle: 'Software Intern', applicationUrl: `https://jobs.lever.co/fixture/${id}` } } }
async function installTransitionFailure(database: PgliteDatabase, status: 'projected' | 'failed') {
  await database.$client.exec(`
    create function reject_${status}_receipt() returns trigger language plpgsql as $$
    begin raise exception '${status} receipt failure'; end;
    $$;
    create trigger reject_${status}_receipt before update on sourcing_projection_outcomes
    for each row when (new.status = '${status}') execute function reject_${status}_receipt();
  `)
}
