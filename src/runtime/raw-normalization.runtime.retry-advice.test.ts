import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { retryWork } from '../db/schema'
import { createDrizzleDatabase, createFileDatabase, createInMemoryDatabase, migrateDatabase } from '../db/sqlite'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry
} from '../modules/sourcing/normalization.registry'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createSqliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'

describe('local deterministic raw normalization', () => {
  it('persists exhausted normalization advice and suppresses lower-precedence fallback', async () => {
    const sqlitePath = tempDatabasePath()
    const exhausted: NormalizationResolver = {
      declaration: { id: 'fixture.exhausted-company', version: '1.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [{
        resolverId: 'fixture.exhausted-company', resolverVersion: '1.0.0', field: 'companyName',
        inputHash: context.hashInput('company'), status: 'exhausted', retry: {
          state: 'exhausted', reason: 'server_failure', attempt: 3, maxAttempts: 3,
          lastAttemptAt: '2026-07-10T12:00:00.000Z', computedDelayMs: null,
          nextAttemptAt: null, horizonAt: '2026-07-10T13:00:00.000Z',
        },
      }] },
    }
    const registry = createNormalizationResolverRegistry([
      exhausted,
      ...createDefaultNormalizationResolverRegistry().resolvers,
    ])
    const sqlite = createFileDatabase(sqlitePath)
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const intake = await createSqliteRawSourceRepository(database).ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Intern', url: 'https://jobs.lever.co/acme/exhausted-1' },
    }] })
    const result = await createNormalizationOrchestrator({
      repository: createSqliteNormalizationRepository(database), registry,
    }).normalize(intake.receipts[0].rawRecordId, intake.receipts[0].revision.id)

    expect(result).toMatchObject({
      status: 'completed', canonicalCandidate: null,
      gate: { status: 'needs_enrichment', missingFields: expect.arrayContaining(['companyName']), reason: expect.stringContaining('server_failure') },
      fieldOutcomes: expect.arrayContaining([
        expect.objectContaining({ resolverId: 'fixture.exhausted-company', field: 'companyName', status: 'exhausted', retry: expect.objectContaining({ state: 'exhausted' }) }),
        expect.objectContaining({ resolverId: 'deterministic.explicit-company', field: 'companyName', status: 'suppressed' }),
      ]),
    })
    const rows = database.select().from(retryWork).all()
    expect(rows).toEqual([expect.objectContaining({
      kind: 'normalization', captureEvidenceVersionId: intake.receipts[0].revision.id,
      resolverId: 'fixture.exhausted-company', resolverVersion: '1.0.0',
      state: 'exhausted', reason: 'server_failure', attempt: 3, maxAttempts: 3,
      computedDelayMs: null, nextAttemptAt: null,
    })])
    sqlite.close()
  })

  it('persists one cancelled work unit for consistent multi-field terminal advice', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const advice = {
      state: 'cancelled' as const, reason: 'operation_timeout' as const, attempt: 2, maxAttempts: 4,
      lastAttemptAt: '2026-07-10T12:00:00.000Z', computedDelayMs: null,
      nextAttemptAt: null, horizonAt: '2026-07-10T13:00:00.000Z',
    }
    const cancelled: NormalizationResolver = {
      declaration: { id: 'fixture.cancelled-fields', version: '2.0.0', requiredInputs: ['rawRevision'], outputFields: ['companyName', 'roleTitle'], capabilities: ['pure'], costClass: 'none', precedence: 1_000 },
      resolve(context) { return [
        { resolverId: 'fixture.cancelled-fields', resolverVersion: '2.0.0', field: 'companyName', inputHash: context.hashInput('company'), status: 'cancelled', retry: advice },
        { resolverId: 'fixture.cancelled-fields', resolverVersion: '2.0.0', field: 'roleTitle', inputHash: context.hashInput('title'), status: 'cancelled', retry: advice },
      ] },
    }
    const intake = await createSqliteRawSourceRepository(database).ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' }, observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Fallback must not win', title: 'Fallback title', url: 'https://jobs.lever.co/acme/cancelled-1' },
    }] })
    const result = await createNormalizationOrchestrator({
      repository: createSqliteNormalizationRepository(database),
      registry: createNormalizationResolverRegistry([cancelled, ...createDefaultNormalizationResolverRegistry().resolvers]),
    }).normalize(intake.receipts[0].rawRecordId, intake.receipts[0].revision.id)

    expect(result).toMatchObject({
      gate: { status: 'needs_enrichment', missingFields: expect.arrayContaining(['companyName', 'roleTitle']), reason: expect.stringContaining('cancelled') },
      fieldOutcomes: expect.arrayContaining([
        expect.objectContaining({ resolverId: 'fixture.cancelled-fields', field: 'companyName', status: 'cancelled' }),
        expect.objectContaining({ resolverId: 'fixture.cancelled-fields', field: 'roleTitle', status: 'cancelled' }),
        expect.objectContaining({ resolverId: 'deterministic.explicit-company', status: 'suppressed' }),
        expect.objectContaining({ resolverId: 'deterministic.explicit-title', status: 'suppressed' }),
      ]),
    })
    expect(database.select().from(retryWork).all()).toEqual([expect.objectContaining({
      kind: 'normalization', captureEvidenceVersionId: intake.receipts[0].revision.id,
      resolverId: 'fixture.cancelled-fields', resolverVersion: '2.0.0',
      state: 'cancelled', reason: 'operation_timeout', attempt: 2, maxAttempts: 4,
      computedDelayMs: null, nextAttemptAt: null,
    })])
    sqlite.close()
  })
})

function tempDatabasePath() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-runtime-')), 'db.sqlite') }
