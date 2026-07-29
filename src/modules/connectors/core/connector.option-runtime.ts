import type {
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorOptionRuntime,
} from '@sparxie/valedictorian-connectors-core'
import type { SourceExecutionScopeId } from '@sparxie/sdk'
import type { AppConnectorAuthHost } from '../ports/connector.runner-contracts'
import { createRunRuntime } from './connector.run-runtime'

export function createConnectorOptionRuntime({
  authHost,
  authReferences,
  authRequirements,
  executionScopeId,
  signal,
}: {
  authHost?: AppConnectorAuthHost
  authReferences: ConnectorAuthReference[]
  authRequirements: ConnectorAuthRequirement[]
  executionScopeId: SourceExecutionScopeId
  signal?: AbortSignal
}): ConnectorOptionRuntime {
  const runtime = createRunRuntime(
    {},
    authReferences,
    authRequirements,
    authHost,
    new Set<string>(),
    executionScopeId,
    null,
    false,
    undefined,
  )
  return {
    auth: runtime.auth,
    ...(signal ? { cancellation: { signal } } : {}),
  }
}
