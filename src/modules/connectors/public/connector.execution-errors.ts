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

/**
 * A stored instance must match the installed connector definition exactly; nothing
 * reconciles a drifted version, so the only remedy is recreating the instance.
 */
export function connectorInstalledVersionMismatchError(
  connectorId: string,
  installedConnectorVersion: string,
): ConnectorExecutionError {
  return new ConnectorExecutionError(
    `Connector version mismatch for ${connectorId}: expected ${installedConnectorVersion}`,
  )
}

export function unexpectedConnectorExecutionError(): ConnectorExecutionError {
  return new ConnectorExecutionError('Connector execution failed.', 500)
}
