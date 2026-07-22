/**
 * Frontier/backfill ↔ downstream processing DECOUPLING contract.
 *
 * These proofs PIN behavior the #233 / #234 merges already delivered — a connector
 * refresh acknowledges its frontier/backfill on durable canonical Capture intake
 * alone and NEVER executes provider resolution inline. Downstream orchestration is
 * owned by the canonical lifecycle rather than the connector refresh transaction.
 *
 * (The umbrella's "current implementation evidence" predates #233/#234; this file
 * makes the decoupling an explicit, named contract so the property cannot silently
 * regress.)
 *
 * Re-derivation after a crash is safe because Capture provenance identity is
 * idempotent: re-observation reuses identical content on the same aggregate.
 */
import { describe, expect, it, vi } from 'vitest'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import { captureOccurrences, captureRevisions, captures } from '../db/schema'
import type { AppConnectorRuntime, AppJobConnector } from '../modules/connectors/connector.runner'
import {
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
} from './local-valedictorian-client.test-harness'

const createLocalValedictorianClient = useResettablePgliteTestLocalValedictorianClient()

interface ProviderUrlResolverConnector extends AppJobConnector {
  providerUrlResolver: {
    id: string
    version: string
    resolve(
      input: { connectorInstanceId: string; executionScopeId: string; providerRecordId: string; workspaceId: string },
      runtime: Pick<AppConnectorRuntime, 'auth' | 'cancellation'>,
    ): Promise<{ status: 'resolved'; url: string; method: string }>
  }
}

function createCapturingConnector(clockRef: { value: Date }) {
  const resolve = vi.fn(async () => {
    clockRef.value = new Date(clockRef.value.getTime() + 1)
    return { status: 'resolved', url: 'https://jobs.lever.co/example/opening-1', method: 'fixture_provider_detail' }
  })
  const connector: ProviderUrlResolverConnector = {
    definition: {
      id: 'jobright.resolver',
      version: '0.14.0',
      displayName: 'Jobright fixture',
      capabilities: {
        fetchesPublicPages: false,
        resolvesIntermediaryLinks: true,
        supportsFiltering: false,
        supportsIncrementalRefresh: true,
      },
      checkpoint: { schemaVersion: 'jobright-capture-checkpoint@1' },
    },
    providerUrlResolver: { id: 'jobright.provider-url', version: 'jobright-provider-url@1', resolve },
    async refresh(input, runtime) {
      await runtime.captureIntake?.capture({
        observedAt: clockRef.value.toISOString(),
        providerRecordId: 'provider-one',
        providerSchema: 'jobright-authenticated-search@1',
        reportedOrigin: { kind: 'aggregator', name: 'Jobright', providerId: 'jobright' },
        payload: { companyName: 'Example', roleTitle: 'Engineer' },
        evidence: [{ kind: 'provider_api_record', label: 'Jobright fixture row', value: { providerRecordId: 'provider-one' } }],
      })
      return {
        coverage: input.coverage,
        nextCheckpoint: { checkpoint: { cursor: 'capture-complete' }, schemaVersion: 'jobright-capture-checkpoint@1' },
        observations: [],
        operationOutcome: null,
        stats: { captures: 1, observations: 0 },
        status: 'completed' as const,
        synchronization: {
          newestFrontier: { state: 'caught_up' as const },
          historicalBackfill: {
            state: 'boundary_reached' as const,
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 1,
          outcome: { kind: 'boundary_exhausted' as const },
        },
        warnings: [],
      }
    },
  }
  return { connector, resolve }
}

async function startClient(connector: ProviderUrlResolverConnector, clock: () => Date) {
  const client = await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([connector]),
    now: clock,
    registerScheduledWorkSource: () => {},
    seedDataMode: 'none',
    workspaceId: 'workspace-decoupling',
  })
  await client.connectors.create({
    id: 'jobright-one',
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    displayName: 'Jobright fixture',
    enabled: true,
    earliestBackfillDate: '2026-07-01',
  })
  return client
}

describe.sequential('connector frontier/backfill ↔ canonical lifecycle decoupling contract', () => {
  it('commits a durable canonical Capture and advances the frontier without inline resolution', async () => {
    const clockRef = { value: new Date('2026-07-16T12:00:00.000Z') }
    const { connector, resolve } = createCapturingConnector(clockRef)
    const client = await startClient(connector, () => clockRef.value)

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-one',
      mode: 'manual',
      coverageEndedAt: clockRef.value.toISOString(),
    })

    // Frontier/backfill acknowledged on durable intake alone: the run completed.
    expect(run.status).toBe('completed')
    // Zero provider resolution executes inline during the refresh.
    expect(resolve).not.toHaveBeenCalled()

    const database = getTestLocalValedictorianDatabase(client)
    // Durable capture committed.
    expect(await database.select().from(captures)).toHaveLength(1)
    expect(await database.select().from(captureRevisions)).toHaveLength(1)
  })

  it('re-derives the frontier idempotently by reusing the same Capture revision', async () => {
    const clockRef = { value: new Date('2026-07-16T12:00:00.000Z') }
    const { connector, resolve } = createCapturingConnector(clockRef)
    const client = await startClient(connector, () => clockRef.value)
    const database = getTestLocalValedictorianDatabase(client)

    const first = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-one',
      mode: 'manual',
      coverageEndedAt: clockRef.value.toISOString(),
    })
    expect(first.status).toBe('completed')

    // Simulate the crash-window recovery: the checkpoint may have been lost, so a
    // subsequent run re-processes the same coverage. Intake is idempotent, so this
    // is safe — no duplicate capture, no duplicate scheduled work.
    clockRef.value = new Date(clockRef.value.getTime() + 60_000)
    const rerun = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-one',
      mode: 'manual',
      coverageEndedAt: clockRef.value.toISOString(),
    })
    expect(rerun.status).toBe('completed')

    // Provenance identity keeps one aggregate and one content revision while
    // preserving each run observation independently.
    expect(await database.select().from(captures)).toHaveLength(1)
    expect(await database.select().from(captureRevisions)).toHaveLength(1)
    expect(await database.select().from(captureOccurrences)).toHaveLength(2)
    expect(resolve).not.toHaveBeenCalled()
  })
})
