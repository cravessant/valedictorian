import {
  assertKnownOptions,
  hasFlag,
  parseNullableStringOption,
  parseNullableTimestampOption,
  readOption,
  setOptionalStringOption,
  validateLimit,
} from './valedictorian-cli.parser-options.js'

const connectorRunModes = new Set(['manual'])

export interface ConnectorRunTriggerInput {
  connectorInstanceId: string
  mode?: 'manual'
  coverageStartedAt?: string | null
  coverageEndedAt?: string | null
  filterSignature?: string | null
  reason?: string | null
  dryRun?: boolean
}

export interface ConnectorRunsListInput {
  connectorInstanceId: string
  status?: string
  mode?: string
  limit?: number
  offset?: number
}

export interface ConnectorObservationsListInput {
  connectorInstanceId: string
  connectorRunId?: string
  limit?: number
  offset?: number
}

export function parseConnectorRunTrigger(
  connectorInstanceId: string,
  argv: string[],
): ConnectorRunTriggerInput {
  assertKnownOptions(argv, [
    '--coverage-ended-at',
    '--coverage-started-at',
    '--dry-run',
    '--filter-signature',
    '--json',
    '--mode',
    '--reason',
  ])
  const input: ConnectorRunTriggerInput = { connectorInstanceId }
  const mode = readOption(argv, '--mode')

  if (mode !== undefined) {
    if (!connectorRunModes.has(mode)) {
      throw new Error(`Invalid connector run mode: ${mode}`)
    }

    input.mode = mode as ConnectorRunTriggerInput['mode']
  }

  const coverageStartedAt = readOption(argv, '--coverage-started-at')
  const coverageEndedAt = readOption(argv, '--coverage-ended-at')
  const filterSignature = readOption(argv, '--filter-signature')
  const reason = readOption(argv, '--reason')

  if (coverageStartedAt !== undefined) {
    input.coverageStartedAt = parseNullableTimestampOption(coverageStartedAt, 'coverageStartedAt')
  }

  if (coverageEndedAt !== undefined) {
    input.coverageEndedAt = parseNullableTimestampOption(coverageEndedAt, 'coverageEndedAt')
  }

  if (filterSignature !== undefined) {
    input.filterSignature = parseNullableStringOption(filterSignature, 'filterSignature')
  }

  if (reason !== undefined) {
    input.reason = parseNullableStringOption(reason, 'reason')
  }

  if (hasFlag(argv, '--dry-run')) {
    input.dryRun = true
  }

  return input
}

export function parseConnectorRunsList(
  connectorInstanceId: string,
  argv: string[],
): ConnectorRunsListInput {
  assertKnownOptions(argv, ['--json', '--limit', '--mode', '--offset', '--status'])
  const input: ConnectorRunsListInput = { connectorInstanceId }
  const limit = readOption(argv, '--limit')
  const offset = readOption(argv, '--offset')

  setOptionalStringOption(input, argv, '--status', 'status')
  setOptionalStringOption(input, argv, '--mode', 'mode')

  if (limit !== undefined) {
    input.limit = Number(limit)
    validateLimit(input.limit)
  }

  if (offset !== undefined) {
    input.offset = Number(offset)
  }

  return input
}

export function parseConnectorObservationsList(
  connectorInstanceId: string,
  argv: string[],
): ConnectorObservationsListInput {
  assertKnownOptions(argv, ['--connector-run-id', '--json', '--limit', '--offset'])
  const input: ConnectorObservationsListInput = { connectorInstanceId }
  const limit = readOption(argv, '--limit')
  const offset = readOption(argv, '--offset')

  setOptionalStringOption(input, argv, '--connector-run-id', 'connectorRunId')

  if (limit !== undefined) {
    input.limit = Number(limit)
    validateLimit(input.limit)
  }

  if (offset !== undefined) {
    input.offset = Number(offset)
  }

  return input
}
