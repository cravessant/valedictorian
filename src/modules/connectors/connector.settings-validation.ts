import type { AppJobConnector } from './connector.runner'

const jobrightConfigFields = new Set([
  'discoveryCount',
  'maxRetryAttemptsPerSource',
  'maxRunElapsedMs',
])

export function assertSupportedConnectorSettings(
  connector: AppJobConnector,
  config: unknown,
  filters: unknown,
) {
  if (connector.definition.id !== 'jobright.resolver') return
  const configRecord = jsonRecord(config, 'config')
  const filterRecord = jsonRecord(filters, 'filters')
  const unsupportedConfig = Object.keys(configRecord).find((key) => !jobrightConfigFields.has(key))
  if (unsupportedConfig) throw new Error(`Unsupported Jobright config field: ${unsupportedConfig}`)
  const unsupportedFilter = Object.keys(filterRecord)[0]
  if (unsupportedFilter) throw new Error(`Unsupported Jobright filter field: ${unsupportedFilter}`)
}

function jsonRecord(value: unknown, fieldName: string): Record<string, unknown> {
  const candidate = value ?? {}
  if (typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>
  }
  throw new Error(`Invalid connector ${fieldName}`)
}
