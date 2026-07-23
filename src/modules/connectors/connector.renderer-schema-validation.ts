import type { ConnectorRendererSchema } from '@sparxie/sdk'

export type ConnectorSchemaValidationIssue = {
  path: string
  message: string
}

export function validateConnectorSchemaValue(
  schema: ConnectorRendererSchema,
  value: unknown,
  options: { allowMissingRootRequired?: boolean; path?: string } = {},
): ConnectorSchemaValidationIssue[] {
  return validateValue(schema, value, options.path ?? '', options.allowMissingRootRequired === true)
}

export function validateConnectorConfigPersistenceValue(
  schema: ConnectorRendererSchema,
  value: unknown,
  options: { allowMissingRootRequired?: boolean; path?: string } = {},
): ConnectorSchemaValidationIssue[] {
  const boundarySchema = 'type' in schema && schema.type === 'object'
    ? { ...schema, additionalProperties: false as const }
    : schema
  return validateConnectorSchemaValue(boundarySchema, value, options)
}

export function connectorSchemaAtPointer(
  schema: ConnectorRendererSchema,
  pointer: string,
): ConnectorRendererSchema | null {
  if (pointer === '') return schema
  if (!pointer.startsWith('/')) return null
  let current: ConnectorRendererSchema = schema
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = encodedSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!('type' in current) || current.type !== 'object') return null
    const next = current.properties[segment]
    if (!next) return null
    current = next
  }
  return current
}

function validateValue(
  schema: ConnectorRendererSchema,
  value: unknown,
  path: string,
  allowMissingRequired: boolean,
): ConnectorSchemaValidationIssue[] {
  if ('oneOf' in schema) {
    const branchIssues = schema.oneOf.map((branch) => validateValue(branch, value, path, false))
    return branchIssues.some((issues) => issues.length === 0)
      ? []
      : [{ path, message: 'does not match any supported shape' }]
  }
  if (schema.type === 'boolean') {
    return typeof value === 'boolean' ? [] : issue(path, 'must be a boolean')
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return issue(path, 'must be a number')
    if (schema.type === 'integer' && !Number.isInteger(value)) return issue(path, 'must be an integer')
    if (schema.minimum !== undefined && value < schema.minimum) return issue(path, `must be at least ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) return issue(path, `must be at most ${schema.maximum}`)
    if (schema.multipleOf !== undefined && !isMultipleOf(value, schema.multipleOf)) {
      return issue(path, `must be a multiple of ${schema.multipleOf}`)
    }
    if (schema.enum && !schema.enum.includes(value)) return issue(path, 'is not a declared value')
    return []
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return issue(path, 'must be text')
    if (schema.const !== undefined && value !== schema.const) return issue(path, 'does not match the declared value')
    if (schema.enum && !schema.enum.includes(value)) return issue(path, 'is not a declared value')
    if (schema.minLength !== undefined && value.length < schema.minLength) return issue(path, `must contain at least ${schema.minLength} characters`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return issue(path, `must contain at most ${schema.maxLength} characters`)
    if (schema.format === 'date' && !isCalendarDate(value)) return issue(path, 'must be a date')
    return []
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return issue(path, 'must be a list')
    if (schema.minItems !== undefined && value.length < schema.minItems) return issue(path, `must contain at least ${schema.minItems} values`)
    if (value.length > schema.maxItems) return issue(path, `must contain at most ${schema.maxItems} values`)
    if (schema.uniqueItems && new Set(value.map(stableValueKey)).size !== value.length) {
      return issue(path, 'must not contain duplicate values')
    }
    const itemIssues = value.flatMap((item, index) =>
      validateValue(schema.items, item, joinPath(path, String(index)), false))
    if (isFixedNumericRangeSchema(schema) && value.length === 2) {
      const rangeIssues = [
        ...(typeof value[0] === 'number'
          ? []
          : issue(joinPath(path, '0'), 'range minimum endpoint is required and must be a number')),
        ...(typeof value[1] === 'number'
          ? []
          : issue(joinPath(path, '1'), 'range maximum endpoint is required and must be a number')),
      ]
      if (typeof value[0] === 'number' && typeof value[1] === 'number' && value[0] > value[1]) {
        rangeIssues.push(...issue(path, 'range minimum endpoint must not exceed the maximum endpoint'))
      }
      return [...itemIssues, ...rangeIssues]
    }
    return itemIssues
  }
  if (schema.type !== 'object') return issue(path, 'uses an unsupported schema')
  if (!isRecord(value)) return issue(path, 'must be an object')
  const keys = Object.keys(value)
  if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
    return issue(path, `must contain at most ${schema.maxProperties} fields`)
  }
  const issues: ConnectorSchemaValidationIssue[] = []
  if (!allowMissingRequired) {
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        issues.push(...issue(joinPath(path, required), 'is required'))
      }
    }
  }
  for (const key of keys) {
    const propertySchema = schema.properties[key]
    if (!propertySchema) {
      if (!schema.additionalProperties) issues.push(...issue(joinPath(path, key), 'is not declared'))
      continue
    }
    issues.push(...validateValue(propertySchema, value[key], joinPath(path, key), false))
  }
  return issues
}

function isFixedNumericRangeSchema(
  schema: Extract<ConnectorRendererSchema, { type: 'array' }>,
): boolean {
  return schema.minItems === 2
    && schema.maxItems === 2
    && 'type' in schema.items
    && (schema.items.type === 'number' || schema.items.type === 'integer')
}

function issue(path: string, message: string): ConnectorSchemaValidationIssue[] {
  return [{ path: path || '/', message }]
}

function joinPath(path: string, segment: string) {
  return `${path}/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableValueKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${key}:${stableValueKey(nested)}`)
    .join(',')}}`
}

function isMultipleOf(value: number, divisor: number) {
  const quotient = value / divisor
  return Number.isFinite(quotient) && Math.abs(quotient - Math.round(quotient)) < 1e-9
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]!
}
