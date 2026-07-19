import { describe, expect, it } from 'vitest'
import type { RawSourceFieldDirective, RawSourceNormalizationResult } from 'sparxie'
import {
  captureEvidenceVersions,
  captureLineages,
  normalizationReplayItems,
  normalizationReplayRequests,
  normalizationRuns,
} from '../db/schema'
import type { PgliteDatabase } from '../db/pglite'
import { createPgliteTestOwner } from '../test/pglite-test-owner'
import { createNormalizationReplayService } from '../modules/sourcing/normalization-replay'
import type { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import {
  createNormalizationResolverRegistry,
  hashJson,
} from '../modules/sourcing/normalization.registry'

const NOW = '2026-07-10T12:00:00.000Z'
const CANONICAL_SCHEMA = 'canonical-source-candidate/v1'
const GATE_POLICY = 'sourcing-admission/v1'

type Orchestrator = ReturnType<typeof createNormalizationOrchestrator>
type NormalizeCall = {
  rawRecordId: string
  rawRevisionId: string
  replay: {
    kind: 'replay'
    replayId: string
    fieldDirectives: RawSourceFieldDirective[]
    targetResolverVersions: Array<{ resolverId: string; version: string }>
  }
}

async function createFixture() {
  const owner = await createPgliteTestOwner()
  const client = owner.client
  const database = owner.database
  const calls: NormalizeCall[] = []
  const now = () => new Date(NOW)
  const orchestrator = {
    async normalize(rawRecordId: string, rawRevisionId: string, replay: NormalizeCall['replay']) {
      const call = { rawRecordId, rawRevisionId, replay }
      calls.push(call)
      const result = {
        rawRecordId,
        rawRevisionId,
        canonicalSchemaVersion: CANONICAL_SCHEMA,
        status: 'completed',
        attempts: [],
        fieldOutcomes: [],
        updatedAt: now().toISOString(),
        gate: null,
        canonicalCandidate: null,
      } as RawSourceNormalizationResult
      await database.insert(normalizationRuns).values({
        id: `run-${replay.replayId}-${rawRevisionId}`,
        captureLineageId: rawRecordId,
        captureEvidenceVersionId: rawRevisionId,
        triggerCaptureId: null,
        triggerConnectorInstanceId: null,
        triggerConnectorRunId: null,
        inputHash: hashJson({ replayId: replay.replayId, rawRevisionId }),
        resolverSetHash: 'sha256:replay-fixture-resolvers',
        canonicalSchemaVersion: CANONICAL_SCHEMA,
        gatePolicyVersion: GATE_POLICY,
        triggerKind: 'intake',
        triggerId: replay.replayId,
        status: result.status,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      })
      return result
    },
  } as unknown as Orchestrator
  const service = createNormalizationReplayService({
    database,
    orchestrator,
    registry: createNormalizationResolverRegistry([]),
    now,
  })
  return { calls, client, database, service }
}

async function seedRevision(
  database: PgliteDatabase,
  input: { rawRecordId: string; rawRevisionId: string; revision?: number; createdAt?: string },
) {
  const createdAt = input.createdAt ?? NOW
  await database.insert(captureLineages).values({
    id: input.rawRecordId,
    createdAt,
  }).onConflictDoNothing()
  await database.insert(captureEvidenceVersions).values({
    id: input.rawRevisionId,
    captureLineageId: input.rawRecordId,
    revision: input.revision ?? 1,
    contentHash: `sha256:content-${input.rawRevisionId}`,
    adapterId: 'manual.fixture',
    adapterKind: 'manual',
    adapterVersion: '1.0.0',
    providerRecordId: input.rawRevisionId,
    payloadJson: JSON.stringify({ companyName: 'Fixture', roleTitle: 'Intern' }),
    evidenceJson: '[]',
    observedAt: createdAt,
    createdAt,
  })
}

describe('normalization replay runtime schema failures', () => {
  it('rolls back request initialization when an injected item persistence trigger fails', async () => {
    const fixture = await createFixture()
    try {
      await seedRevision(fixture.database, { rawRecordId: 'raw-rollback-a', rawRevisionId: 'revision-rollback-a' })
      await seedRevision(fixture.database, { rawRecordId: 'raw-rollback-b', rawRevisionId: 'revision-rollback-b' })
      await fixture.client.exec(`
        create or replace function fail_second_replay_item() returns trigger as $$
        begin
          if new.sequence = 1 then raise exception 'injected replay item failure'; end if;
          return new;
        end;
        $$ language plpgsql;
        create trigger fail_second_replay_item_trigger
        before insert on normalization_replay_items
        for each row execute function fail_second_replay_item();
      `)

      let injectedFailure: unknown
      try {
        await fixture.service.replay({
          selector: { rawRevisionIds: ['revision-rollback-a', 'revision-rollback-b'] }, invalidate: {},
        })
      } catch (error) {
        injectedFailure = error
      }
      expect(injectedFailure).toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/injected replay item failure/i) }),
      })
      await expect(fixture.database.select().from(normalizationReplayRequests)).resolves.toEqual([])
      await expect(fixture.database.select().from(normalizationReplayItems)).resolves.toEqual([])
    } finally {
      await fixture.client.close()
    }
  })
})
