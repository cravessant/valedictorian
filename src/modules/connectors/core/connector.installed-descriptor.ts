import type { InstalledConnectorDescriptor } from '@sparxie/sdk'
import { installedConnectorDescriptorSchema } from '@sparxie/sdk'
import type { AppJobConnector } from '../ports/connector.runner-contracts'

const MAX_REPORTED_ISSUES = 3
const SAFE_DIAGNOSTIC_SEGMENT = /^[A-Za-z0-9._@+-]{1,64}$/

export class ConnectorAdmissionError extends Error {
  constructor(readonly connectorIdentity: string, readonly reason: string) {
    super(`Connector ${connectorIdentity} failed registry admission: ${reason}`)
    this.name = 'ConnectorAdmissionError'
  }
}

export function admitInstalledConnectorDescriptor(
  connector: AppJobConnector,
): InstalledConnectorDescriptor {
  const connectorIdentity = safeConnectorIdentity(connector)
  let projected: unknown
  try {
    projected = projectConnectorDefinition(connector)
  } catch {
    throw new ConnectorAdmissionError(connectorIdentity, 'definition is not projectable')
  }
  const admitted = installedConnectorDescriptorSchema.safeParse(projected)
  if (!admitted.success) {
    throw new ConnectorAdmissionError(connectorIdentity, safeIssueSummary(admitted.error.issues))
  }
  return deepFreeze(admitted.data)
}

function projectConnectorDefinition(connector: AppJobConnector): unknown {
  const definition = connector.definition
  return {
    connectorId: definition.id,
    connectorVersion: definition.version,
    displayName: definition.displayName ?? definition.id,
    ...(definition.configSchema ? { configSchema: clonePlainData(definition.configSchema) } : {}),
    ...(definition.filterSchema ? { filterSchema: clonePlainData(definition.filterSchema) } : {}),
    ...(definition.dynamicOptions
      ? { dynamicOptions: projectDynamicOptions(definition.dynamicOptions) }
      : {}),
  }
}

function projectDynamicOptions(
  declaration: NonNullable<AppJobConnector['definition']['dynamicOptions']>,
) {
  return {
    protocolVersion: declaration.protocolVersion,
    version: declaration.version,
    sources: declaration.sources.map((source) => ({
      id: source.id,
      version: source.version,
      label: source.label,
      valueSchema: clonePlainData(source.valueSchema),
      display: clonePlainData(source.display),
      operations: clonePlainData(source.operations),
      ...(source.dependencies ? { dependencies: clonePlainData(source.dependencies) } : {}),
    })),
    bindings: declaration.bindings.map((binding) => ({ ...binding })),
  }
}

/** The SDK snapshot rejects repeated object references, so shared sub-schemas are un-aliased. */
function clonePlainData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clonePlainData)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      clonePlainData(nested),
    ]))
  }
  return value
}

/** Identity must survive a malformed definition, so every token is re-derived defensively. */
function safeConnectorIdentity(connector: AppJobConnector): string {
  const definition = (connector as { definition?: unknown } | null)?.definition
  const source = definition && typeof definition === 'object'
    ? definition as { id?: unknown; version?: unknown }
    : {}
  return `${safeDiagnosticToken(source.id)}@${safeDiagnosticToken(source.version)}`
}

function safeDiagnosticToken(value: unknown): string {
  return typeof value === 'string' && SAFE_DIAGNOSTIC_SEGMENT.test(value) ? value : 'unknown'
}

function safeIssueSummary(issues: ReadonlyArray<{ code: string; path: ReadonlyArray<PropertyKey> }>) {
  return issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${safeIssuePath(issue.path)}: ${issue.code}`)
    .join('; ')
}

function safeIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '<root>'
  return path
    .map((segment) => {
      const text = String(segment)
      return SAFE_DIAGNOSTIC_SEGMENT.test(text) ? text : '<redacted>'
    })
    .join('/')
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
