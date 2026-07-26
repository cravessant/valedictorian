import type { ConnectorRendererSchema, InstalledConnectorDescriptor } from '@sparxie/sdk'
import {
  validateConnectorConfigPersistenceValue,
  validateConnectorSchemaValue,
} from './connector.renderer-schema-validation'

export type ConnectorSettingsAdmissionMode = 'draft' | 'enabled'

export interface ConnectorSettings {
  config: unknown
  filters: unknown
}

/**
 * Host-boundary admission for caller-supplied settings. `draft` tolerates missing root
 * required values; `enabled` is the single complete pass, never a weaker pass plus a retry.
 */
export function admitConnectorSettings(
  descriptor: InstalledConnectorDescriptor,
  settings: ConnectorSettings,
  mode: ConnectorSettingsAdmissionMode,
) {
  validateDeclaredConnectorSettings(descriptor, settings, mode === 'draft')
}

/** Distinct trust boundary: persisted settings re-checked before load or execution. */
export function revalidatePersistedConnectorSettings(
  descriptor: InstalledConnectorDescriptor,
  settings: ConnectorSettings,
) {
  validateDeclaredConnectorSettings(descriptor, settings, false)
}

/** Distinct trust boundary: persisted settings re-checked across installed-version drift. */
export function revalidatePersistedConnectorSettingsForVersionDrift(
  descriptor: InstalledConnectorDescriptor,
  settings: ConnectorSettings,
) {
  validateDeclaredConnectorSettings(descriptor, settings, true)
}

function validateDeclaredConnectorSettings(
  descriptor: InstalledConnectorDescriptor,
  settings: ConnectorSettings,
  allowMissingRootRequired: boolean,
) {
  const config = jsonRecord(settings.config, 'config')
  const filters = jsonRecord(settings.filters, 'filters')
  validateDeclaredSettings('config', descriptor.configSchema?.schema, config, allowMissingRootRequired)
  validateDeclaredSettings('filters', descriptor.filterSchema?.schema, filters, allowMissingRootRequired)
}

function validateDeclaredSettings(
  fieldName: 'config' | 'filters',
  schema: ConnectorRendererSchema | undefined,
  value: Record<string, unknown>,
  allowMissingRootRequired: boolean,
) {
  if (!schema) return
  const issues = fieldName === 'config'
    ? validateConnectorConfigPersistenceValue(schema, value, { allowMissingRootRequired })
    : validateConnectorSchemaValue(schema, value, { allowMissingRootRequired })
  if (issues[0]) {
    throw new Error(`Invalid connector ${fieldName} field ${issues[0].path}: ${issues[0].message}`)
  }
}

function jsonRecord(value: unknown, fieldName: string): Record<string, unknown> {
  const candidate = value ?? {}
  if (typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>
  }
  throw new Error(`Invalid connector ${fieldName}`)
}
