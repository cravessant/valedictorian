import type {
  ConnectorRendererPresentationField,
  ConnectorRendererSchema,
  ConnectorVersionedRendererSchema,
} from '@sparxie/sdk'

const MS_PER_MINUTE = 60_000

export type PresentationCompatibility = {
  compatible: true
} | {
  compatible: false
  message: string
}

export function durationStorageToDisplay(milliseconds: number): number {
  return milliseconds / MS_PER_MINUTE
}

export function durationDisplayToStorage(minutes: number): number {
  return Math.round(minutes * MS_PER_MINUTE)
}

export function isSupportedRendererField(schema: ConnectorRendererSchema): boolean {
  if ('oneOf' in schema) return false
  if (schema.type === 'object') return false
  if (schema.type === 'boolean' || schema.type === 'string') return true
  if (schema.type === 'number' || schema.type === 'integer') return true
  if (schema.type === 'array') {
    if ('oneOf' in schema.items) return false
    return true
  }
  return false
}

export function dynamicBindingPointers(
  dynamicOptions: { bindings: ReadonlyArray<{ filterPointer: string }> } | undefined,
): string[] {
  return (dynamicOptions?.bindings ?? []).map((binding) => binding.filterPointer)
}

export function evaluateVersionedPresentationCompatibility(
  declaration: ConnectorVersionedRendererSchema | undefined,
  options: {
    requiredDynamicPointers?: readonly string[]
  } = {},
): PresentationCompatibility {
  if (!declaration) return { compatible: true }
  if (!('type' in declaration.schema) || declaration.schema.type !== 'object') {
    return { compatible: true }
  }

  const properties = declaration.schema.properties
  const requiredPointers = new Set<string>()
  for (const [property, schema] of Object.entries(properties)) {
    if (isSupportedRendererField(schema)) {
      requiredPointers.add(`/${escapePointer(property)}`)
    }
  }
  for (const pointer of options.requiredDynamicPointers ?? []) {
    requiredPointers.add(pointer)
  }

  if (requiredPointers.size === 0) return { compatible: true }

  if (!declaration.presentation) {
    return {
      compatible: false,
      message: 'Released presentation metadata is missing, so these settings cannot be edited safely.',
    }
  }

  for (const pointer of requiredPointers) {
    const field = declaration.presentation.fields[pointer]
    if (!field?.label?.trim() || !field.description?.trim()) {
      return {
        compatible: false,
        message: 'Released presentation metadata is incomplete, so these settings cannot be edited safely.',
      }
    }
    const propertyName = rootPropertyPointerName(pointer)
    if (propertyName === undefined || !Object.prototype.hasOwnProperty.call(properties, propertyName)) {
      continue
    }
    const enumValues = schemaEnumValues(properties[propertyName])
    if (enumValues && !optionsCoverEnum(field.options, enumValues)) {
      return {
        compatible: false,
        message: 'Released presentation options are incomplete, so these settings cannot be edited safely.',
      }
    }
  }

  return { compatible: true }
}

export function presentationFieldForPointer(
  declaration: ConnectorVersionedRendererSchema | undefined,
  pointer: string,
): ConnectorRendererPresentationField | undefined {
  return declaration?.presentation?.fields[pointer]
}

export function optionPresentationLabel(
  field: ConnectorRendererPresentationField | undefined,
  value: string | number,
): string | undefined {
  return field?.options?.find((option) => option.value === value)?.label
}

export function dynamicActionLabel(
  intent: 'include' | 'exclude',
  fieldLabel: string,
): string {
  const stripped = fieldLabel.replace(
    intent === 'exclude'
      ? /^(excluded?|exclude)\s+/i
      : /^(included?|include)\s+/i,
    '',
  )
  return `${intent === 'include' ? 'Include' : 'Exclude'} ${stripped}`
}

export function escapePointer(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function rootPropertyPointerName(pointer: string): string | undefined {
  if (!pointer.startsWith('/') || pointer.includes('/', 1)) return undefined
  return pointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~')
}

function schemaEnumValues(schema: ConnectorRendererSchema): Array<string | number> | undefined {
  if ('oneOf' in schema) return undefined
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer') {
    return schema.enum === undefined ? undefined : [...schema.enum]
  }
  if (schema.type === 'array') {
    const { items } = schema
    if ('oneOf' in items) return undefined
    if (items.type === 'string' || items.type === 'number' || items.type === 'integer') {
      return items.enum === undefined ? undefined : [...items.enum]
    }
  }
  return undefined
}

function optionsCoverEnum(
  options: ConnectorRendererPresentationField['options'],
  values: Array<string | number>,
): boolean {
  if (!options || options.length !== values.length) return false
  const seen = new Set<string | number>()
  for (const option of options) {
    if (seen.has(option.value)) return false
    seen.add(option.value)
  }
  return values.every((value) => seen.has(value))
}
