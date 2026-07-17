import type { BatchRawSourceRecordsInput } from 'sparxie'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { LocalConnectorRegistry } from '../connectors/connector.registry'
import type { createSqliteConnectorRepository } from '../connectors/connector.repository'
import type {
  AppConnectorAuthHost,
  AppConnectorRuntimePorts,
} from '../connectors/connector.runner'
import type { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'
import type { createNormalizationOrchestrator } from './normalization.orchestrator'
import { createNormalizationResolverRegistry, type NormalizationResolverRegistry } from './normalization.registry'
import type { createSqliteNormalizationRepository } from './normalization.repository'
import { createProviderUrlResolutionExecutor } from './provider-url-resolution.executor'
import { createProviderUrlResolutionIntake } from './provider-url-resolution.intake'
import { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'
import { createProviderUrlResolutionRuntime } from './provider-url-resolution.runtime'
import { createProviderUrlResolutionWorkSource } from './provider-url-resolution.source'
import type { RawSourceRepository } from './raw-source.repository'

export function createProviderUrlResolutionService(options: {
  authHost?: AppConnectorAuthHost
  connectorRegistry: LocalConnectorRegistry
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
  connectorRuntime?: AppConnectorRuntimePorts
  database: DrizzleDatabase
  governor: ReturnType<typeof createSourceExecutionGovernor>
  normalizationOrchestrator: ReturnType<typeof createNormalizationOrchestrator>
  normalizationRegistry: NormalizationResolverRegistry
  normalizationRepository: ReturnType<typeof createSqliteNormalizationRepository>
  now: () => Date
  onScheduledWorkChanged?: () => void
  rawSourceRepository: RawSourceRepository
  workspaceId: string
}) {
  const repository = createProviderUrlResolutionRepository(
    options.database,
    options.now,
  )
  repository.recoverAcquired(options.now().toISOString())
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
        stage: (transaction, staged) => {
          staged.receipts.forEach((receipt, index) => {
            const record = staged.records[index]
            if (record) scheduled = intake.enqueue(record, receipt, transaction) || scheduled
          })
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
