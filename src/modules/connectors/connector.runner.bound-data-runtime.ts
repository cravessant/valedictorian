import type {
  ConnectorCaptureInput,
  ConnectorRuntime,
} from '@sparxie/valedictorian-connectors-core'
import type {
  AppJobConnector,
} from './connector.runner'
import type { AppConnectorCaptureHost } from './connector.capture-host'

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
