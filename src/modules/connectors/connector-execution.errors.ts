export class ConnectorExecutionError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 409) {
    super(message)
    this.name = 'ConnectorExecutionError'
    this.statusCode = statusCode
  }
}

export function connectorDisabledExecutionError(
  connectorInstanceId: string,
): ConnectorExecutionError {
  return new ConnectorExecutionError(`Connector instance is disabled: ${connectorInstanceId}`)
}

export function unexpectedConnectorExecutionError(): ConnectorExecutionError {
  return new ConnectorExecutionError('Connector execution failed.', 500)
}
