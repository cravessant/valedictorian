import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createTestLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
} from './local-valedictorian-client.test-harness'

describe('local deterministic raw normalization schema failure', () => {
  it('preserves a passed candidate and records failure when its finding cannot be projected', async () => {
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-runtime-'))
    const client = await createTestLocalValedictorianClient({ pgliteDataPath })
    await getTestLocalValedictorianDatabase(client).$client.exec(`
      create function reject_sourcing_projection() returns trigger as $$
      begin
        raise exception 'injected projection policy failure';
      end;
      $$ language plpgsql;
      create trigger reject_sourcing_projection
      before insert on opportunities
      for each row execute function reject_sourcing_projection();
    `)

    const intake = await client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: {
        company: 'Atomic Robotics', title: 'Software Intern',
        location: { raw: 'New York, NY', country: 'US' },
        applicationUrl: 'https://jobs.ashbyhq.com/atomic/job-1',
      },
    }] })

    await expect(client.sourcing.rawRecords.normalization.get(
      intake.receipts[0].rawRecordId,
    )).resolves.toMatchObject({ status: 'completed', gate: { status: 'passed' } })
    await expect(client.sourcing.rawRevisions.projection.get(
      intake.receipts[0].revision.id,
    )).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'projection_failed', retryable: false },
    })
    await expect(client.sourcing.findings.list()).resolves.toMatchObject({ total: 0 })
  })
})
