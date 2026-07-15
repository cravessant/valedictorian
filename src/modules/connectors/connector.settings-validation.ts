import type { AppJobConnector } from './connector.runner'
import type { ConnectorRendererSchema } from 'sparxie'
import { installedConnectorDescriptorSchema } from 'sparxie'
import { projectInstalledConnectorDescriptor } from './connector.capabilities'
import {
  validateConnectorConfigPersistenceValue,
  validateConnectorSchemaValue,
} from './connector.renderer-schema-validation'

export function assertSupportedConnectorSettings(
  connector: AppJobConnector,
  config: unknown,
  filters: unknown,
) {
  const configRecord = jsonRecord(config, 'config')
  const filterRecord = jsonRecord(filters, 'filters')
  const descriptor = installedConnectorDescriptorSchema.parse(
    projectInstalledConnectorDescriptor(connector),
  )
  validateDeclaredSettings('config', descriptor.configSchema?.schema, configRecord, true)
  validateDeclaredSettings('filters', descriptor.filterSchema?.schema, filterRecord, true)
}

export function validateCompleteConnectorFilters(
  connector: AppJobConnector,
  filters: unknown,
) {
  const filterRecord = jsonRecord(filters, 'filters')
  const schema = projectInstalledConnectorDescriptor(connector).filterSchema?.schema
  validateDeclaredSettings('filters', schema, filterRecord, false)
}

export function validateCompleteConnectorSettings(
  connector: AppJobConnector,
  config: unknown,
  filters: unknown,
) {
  const configRecord = jsonRecord(config, 'config')
  const filterRecord = jsonRecord(filters, 'filters')
  const descriptor = projectInstalledConnectorDescriptor(connector)
  validateDeclaredSettings('config', descriptor.configSchema?.schema, configRecord, false)
  validateDeclaredSettings('filters', descriptor.filterSchema?.schema, filterRecord, false)
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
