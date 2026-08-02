import type { ConnectorScheduleErrorCode } from '@sparxie/sdk'

export class ConnectorScheduleError extends Error {
  readonly code: ConnectorScheduleErrorCode
  readonly statusCode: number

  constructor(code: ConnectorScheduleErrorCode, message: string, statusCode = 400) {
    super(message)
    this.name = 'ConnectorScheduleError'
    this.code = code
    this.statusCode = statusCode
  }
}

export function createConnectorScheduleError(
  code: ConnectorScheduleErrorCode,
  message: string,
  statusCode = 400,
): ConnectorScheduleError {
  return new ConnectorScheduleError(code, message, statusCode)
}

export function connectorSchedulingUnavailableError(): ConnectorScheduleError {
  return createConnectorScheduleError(
    'connector_scheduling_unavailable',
    'Connector scheduling is unavailable',
  )
}
