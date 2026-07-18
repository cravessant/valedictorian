import type { BatchRawSourceRecordsInput } from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import type { LocalConnectorRegistry } from '../connectors/connector.registry'
import type { createPgliteConnectorRepository } from '../connectors/connector.repository'
import type {
  AppConnectorAuthHost,
  AppConnectorRuntimePorts,
} from '../connectors/connector.runner'
import type { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'
import type { createNormalizationOrchestrator } from './normalization.orchestrator'
import { createNormalizationResolverRegistry, type NormalizationResolverRegistry } from './normalization.registry'
import type { createPgliteNormalizationRepository } from './normalization.repository'
import { createProviderUrlResolutionExecutor } from './provider-url-resolution.executor'
import { createProviderUrlResolutionIntake } from './provider-url-resolution.intake'
import { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'
import { createProviderUrlResolutionRuntime } from './provider-url-resolution.runtime'
import { createProviderUrlResolutionWorkSource } from './provider-url-resolution.source'
import type { RawSourceRepository } from './raw-source.repository'

export async function createProviderUrlResolutionService(options: {
  authHost?: AppConnectorAuthHost
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  connectorRuntime?: AppConnectorRuntimePorts
  database: PgliteDatabase
  governor: ReturnType<typeof createSourceExecutionGovernor>
  normalizationOrchestrator: ReturnType<typeof createNormalizationOrchestrator>
  normalizationRegistry: NormalizationResolverRegistry
  normalizationRepository: ReturnType<typeof createPgliteNormalizationRepository>
  now: () => Date
  onScheduledWorkChanged?: () => void
  rawSourceRepository: RawSourceRepository
  workspaceId: string
}) {
  const repository = createProviderUrlResolutionRepository(
    options.database,
    options.now,
  )
  await repository.recoverAcquired(options.now().toISOString())
  const intake = createProviderUrlResolutionIntake({
    connectorRegistry: options.connectorRegistry,
    onScheduledWorkChanged: options.onScheduledWorkChanged,
    repository,
  })
  const execute = createProviderUrlResolutionExecutor({
    normalizationOrchestrator: options.normalizationOrchestrator,
    normalizationRepository: options.normalizationRepository,
    pureNormalizationRegistry: createNormalizationResolverRegistry(
      options.normalizationRegistry.resolvers.filter(({ declaration }) =>
        declaration.capabilities.every((capability) => capability === 'pure')),
    ),
    now: options.now,
    random: Math.random,
    repository,
    resolve: createProviderUrlResolutionRuntime({
      authHost: options.authHost,
      connectorRegistry: options.connectorRegistry,
      connectorRepository: options.connectorRepository,
      connectorRuntime: options.connectorRuntime,
      governor: options.governor,
      now: options.now,
      workspaceId: options.workspaceId,
    }),
  })

  return {
    async ingestBatch(input: BatchRawSourceRecordsInput) {
      let scheduled = false
      const result = await options.rawSourceRepository.ingestBatch(input, {
        stage: async (transaction, staged) => {
          for (const [index, receipt] of staged.receipts.entries()) {
            const record = staged.records[index]
            if (record) {
              scheduled = await intake.enqueue(record, receipt, transaction) || scheduled
            }
          }
        },
      })
      if (scheduled) options.onScheduledWorkChanged?.()
      return result
    },
    source: createProviderUrlResolutionWorkSource({
      claimDue: (dueAt) => repository.claimDue(dueAt),
      execute,
      nextDueAt: () => repository.nextDueAt(),
      now: options.now,
    }),
  }
}
