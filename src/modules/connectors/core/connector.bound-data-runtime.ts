import type {
  ConnectorCaptureInput,
  ConnectorRuntime,
} from '@sparxie/valedictorian-connectors-core'
import type { AppJobConnector } from '../ports/connector.runner-contracts'
import type { AppConnectorCaptureHost } from '../ports/connector.capture-host.port'

export function createBoundConnectorDataRuntime({
  captureHost,
  connector,
  connectorInstanceId,
  connectorRunId,
  executionScopeId,
}: {
  captureHost: AppConnectorCaptureHost | undefined
  connector: AppJobConnector
  connectorInstanceId: string
  connectorRunId: string
  executionScopeId: string
}): Pick<ConnectorRuntime, 'captureIntake'> {
  const adapter = {
    id: connector.definition.id,
    kind: 'connector' as const,
    version: connector.definition.version,
  }
  return captureHost
    ? {
        captureIntake: {
          async capture(input: ConnectorCaptureInput) {
            return captureHost.capture({
              input,
              adapter,
              connectorInstanceId,
              connectorRunId,
              executionScopeId,
            })
          },
        },
      }
    : {}
}
