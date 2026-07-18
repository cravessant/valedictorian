import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHttpValedictorianClient } from 'sparxie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createLocalValedictorianClient,
  getLocalValedictorianTestDatabase,
} from './local-valedictorian-client.test-harness'
import { createNormalizationResolverRegistry } from '../modules/sourcing/normalization.registry'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

describe('raw source list HTTP API', () => {
  let server: StartedValedictorianHttpServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('round-trips the local sanitized result through the typed workspace client', async () => {
    const pgliteDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-source-list-http-'))
    const local = await createLocalValedictorianClient({
      pgliteDataPath,
      now: () => new Date('2026-07-10T14:00:00.000Z'),
    })
    await local.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.cli', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-10T13:00:00.000Z',
      payload: { arbitrary: { privateValue: 'http-list-secret-marker' } },
    }] })
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const http = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1')

    const expected = await local.sourcing.rawRecords.list({
      adapterId: 'fixture.cli',
      normalizationStatus: 'completed',
      gateStatus: 'needs_enrichment',
      projectionStatus: 'not_eligible',
    })
    const actual = await http.sourcing.rawRecords.list({
      adapterId: 'fixture.cli',
      normalizationStatus: 'completed',
      gateStatus: 'needs_enrichment',
      projectionStatus: 'not_eligible',
    })

    expect(actual).toEqual(expected)
    expect(JSON.stringify(actual)).not.toContain('http-list-secret-marker')
  })

  it('exposes canonical facts and finding identity for projected records', async () => {
    const pgliteDataPath = tempDatabasePath()
    const local = await createLocalValedictorianClient({
      pgliteDataPath,
      now: () => new Date('2026-07-10T14:00:00.000Z'),
    })
    const intake = await local.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.cli', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-10T13:00:00.000Z',
      payload: {
        companyName: 'Fixture Robotics',
        roleTitle: 'Software Intern',
        applicationUrl: 'https://jobs.lever.co/fixture/projected',
      },
    }] })
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.rawRecords

    const result = await rawRecords.list({
      normalizationStatus: 'completed',
      gateStatus: 'passed',
      projectionStatus: 'projected',
    })

    expect(result.items).toEqual([expect.objectContaining({
      id: intake.receipts[0].rawRecordId,
      companyName: 'Fixture Robotics',
      roleTitle: 'Software Intern',
      normalizationRawRevisionId: intake.receipts[0].revision.id,
      canonicalCandidateId: expect.any(String),
      findingId: expect.any(String),
    })])
  })

  it.each(['pending', 'failed'] as const)(
    'reports %s projection state without a finding identity',
    async (projectionStatus) => {
      const pgliteDataPath = tempDatabasePath()
      const local = await createLocalValedictorianClient({
        pgliteDataPath,
        projectCanonicalCandidate: projectionStatus === 'failed'
          ? () => { throw new Error('Fixture projection failure') }
          : undefined,
      })
      if (projectionStatus === 'pending') {
        const database = getLocalValedictorianTestDatabase(local)
        await database.$client.exec(`
          create function keep_projection_pending() returns trigger language plpgsql as $$
          begin
            raise exception 'fixture transition failure';
          end;
          $$;
          create trigger keep_projection_pending before update on sourcing_projection_outcomes
          for each row execute function keep_projection_pending();
        `)
      }
      const intake = await local.sourcing.rawRecords.ingestBatch({ records: [{
        adapter: { id: 'fixture.cli', kind: 'cli', version: '1.0.0' },
        observedAt: '2026-07-10T13:00:00.000Z',
        payload: {
          companyName: 'Fixture Robotics',
          roleTitle: 'Software Intern',
          applicationUrl: `https://jobs.lever.co/fixture/${projectionStatus}`,
        },
      }] })
      server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
      const result = await createHttpValedictorianClient({ baseUrl: server.url })
        .forWorkspace('workspace-1').sourcing.rawRecords.list({ projectionStatus })

      expect(result.items).toEqual([expect.objectContaining({
        id: intake.receipts[0].rawRecordId,
        gateStatus: 'passed',
        canonicalCandidateId: expect.any(String),
        projectionStatus,
        findingId: null,
      })])
    },
  )

  it('reports failed normalization without eligible projection', async () => {
    const outcomeStatus = 'failed' as const
    const status = 'failed' as const
    const pgliteDataPath = tempDatabasePath()
    const normalizationRegistry = createNormalizationResolverRegistry([{
      declaration: {
        id: `fixture.${outcomeStatus}`,
        version: '1.0.0',
        requiredInputs: ['rawRevision'],
        outputFields: ['companyName'],
        capabilities: ['pure'],
        costClass: 'none',
        precedence: 100,
        scopeRequirement: 'none',
      },
      resolve(context) {
        return [{
          resolverId: `fixture.${outcomeStatus}`,
          resolverVersion: '1.0.0',
          field: 'companyName',
          inputHash: context.hashInput('fixture'),
          status: outcomeStatus,
          reason: `Fixture ${outcomeStatus}`,
        }]
      },
    }])
    const local = await createLocalValedictorianClient({ pgliteDataPath, normalizationRegistry })
    const intake = await local.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'fixture.cli', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-10T13:00:00.000Z',
    }] })
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const result = await createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.rawRecords.list({ normalizationStatus: status })

    expect(result.items).toEqual([expect.objectContaining({
      id: intake.receipts[0].rawRecordId,
      normalizationStatus: status,
      gateStatus: outcomeStatus === 'failed' ? 'failed' : null,
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    })])
  })

  it('rejects malformed typed filters and HTTP cursors before repository results escape', async () => {
    const local = await createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const rawRecords = createHttpValedictorianClient({ baseUrl: server.url })
      .forWorkspace('workspace-1').sourcing.rawRecords

    await expect(rawRecords.list({ limit: 0 } as never)).rejects.toThrow()
    const malformedResponses = await Promise.all([
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/raw-records?limit=banana`),
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/raw-records?cursor=not-opaque`),
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/raw-records?offset=0`),
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/raw-records?limit=1&limit=2`),
    ])

    expect(malformedResponses.map(({ status }) => status)).toEqual([400, 400, 400, 400])
    await Promise.all(malformedResponses.map(async (response) => {
      await expect(response.json()).resolves.toEqual({ message: 'The request is invalid.' })
    }))
  })

  it('rejects canonical cursor envelopes outside the timestamp and Unicode scalar domain', async () => {
    const local = await createLocalValedictorianClient({ pgliteDataPath: tempDatabasePath() })
    server = await createValedictorianHttpServer({ client: local, host: '127.0.0.1', port: 0 })
    const cursors = [
      cursorFor('2026-02-31T12:00:00.000Z', 'raw-valid'),
      cursorFor('2026-07-10T12:00:00.000Z', 'raw-\uD800'),
    ]

    const responses = await Promise.all(cursors.map((cursor) => fetch(
      `${server!.url}/v1/workspaces/workspace-1/sourcing/raw-records?cursor=${cursor}`,
    )))

    expect(responses.map(({ status }) => status)).toEqual([400, 400])
    await Promise.all(responses.map(async (response) => {
      await expect(response.json()).resolves.toEqual({ message: 'The request is invalid.' })
    }))
  })
})

function tempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'raw-source-list-http-'))
}

function cursorFor(lastReceivedAt: string, id: string) {
  return Buffer.from(JSON.stringify({ v: 1, r: lastReceivedAt, i: id })).toString('base64url')
}
