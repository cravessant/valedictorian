import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
} from './jobright.constants'

export function signatureForFilters(filters: Record<string, unknown>): string {
  return `filters:${stableJsonStringify(filters)}`
}

export function connectorCheckpointSignature(input: {
  connectorId: string
  connectorVersion: string
  supportsFiltering?: boolean
  filters: Record<string, unknown>
}): string {
  return isJobrightProviderStateSignature(input)
    ? `provider-state:${input.connectorId}@${input.connectorVersion}`
    : signatureForFilters(input.filters)
}

export function isJobrightProviderStateSignature(input: {
  connectorId: string
  connectorVersion: string
  supportsFiltering?: boolean
}): boolean {
  return input.connectorId === JOBRIGHT_CONNECTOR_ID
    && input.connectorVersion === JOBRIGHT_CONNECTOR_VERSION
    && input.supportsFiltering === false
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}
