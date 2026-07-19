import type {
  LocalConnectorReconnectActionResult,
} from '../../runtime/local-valedictorian-client'
import type { ConnectorSkipActionResult } from '../../ipc/connectors.public'
import type { ConnectorStatusAction, ConnectorStatusView } from './connector.status'

export function performConnectorStatusAction(input: {
  action: ConnectorStatusAction
  connector: ConnectorStatusView
  onCompleted: () => void
  reconnect: (input: { connectorInstanceId: string }) => Promise<LocalConnectorReconnectActionResult>
  skip: (input: {
    connectorInstanceId: string
    reason: string
  }) => Promise<ConnectorSkipActionResult>
  toast: (input: {
    description: string
    operationId?: string
    title: string
    variant?: 'default' | 'destructive' | 'success'
  }) => void
}): void {
  const { action, connector, onCompleted, reconnect, skip, toast } = input
  const operationId = `connector-status:${action.id}:${connector.id}`
  if (action.id !== 'reconnect' && action.id !== 'skip') {
    toast({
      description: `${action.label} is not available in this local runtime.`,
      operationId,
      title: `${action.label} ${connector.displayName}`,
      variant: 'destructive',
    })
    return
  }
  const title = action.id === 'reconnect'
    ? `Reconnect ${connector.displayName}`
    : `Skip ${connector.displayName}`
  const request = action.id === 'reconnect'
    ? reconnect({ connectorInstanceId: connector.id })
    : skip({
      connectorInstanceId: connector.id,
      reason: 'user_skipped_auth_required_run',
    })
  void request.then((result) => {
    toast({ description: result.message, title })
    onCompleted()
  }).catch(() => {
    toast({
      description: 'Connector status action could not be completed.',
      operationId,
      title,
      variant: 'destructive',
    })
  })
}
