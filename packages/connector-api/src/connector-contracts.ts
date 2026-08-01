import { z } from 'zod'
import { snapshotBoundedPlainData } from "./plain-data.js"

const connectorDescriptorMaxSchemaDepth = 16
const connectorDescriptorMaxProperties = 256
const connectorDescriptorMaxEnumValues = 256
const connectorDescriptorMaxOneOfBranches = 16
const connectorDescriptorMaxStringLength = 10_000
const connectorDescriptorMaxArrayItems = 1_000
const connectorDescriptorMaxSources = 100
const connectorDescriptorMaxBindings = 500
const connectorDescriptorMaxDependencies = 50
const connectorDescriptorMaxIdentifierLength = 128
const connectorDescriptorMaxLabelLength = 256
const connectorDescriptorMaxVersionLength = 128
const connectorDescriptorMaxPointerLength = 1_024
const connectorDescriptorMaxDisplayPointers = 10
const connectorDescriptorMaxDynamicObjectProperties = 100

const unsafeNames = new Set(['__proto__', 'prototype', 'constructor'])
const capabilityIdPattern = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/
const genericVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/
const capabilityTextSchema = (maximum: number, pattern: RegExp) => z.string()
  .min(1)
  .max(maximum)
  .regex(pattern)
const identifierSchema = capabilityTextSchema(
  connectorDescriptorMaxIdentifierLength,
  capabilityIdPattern,
)
const versionSchema = capabilityTextSchema(
  connectorDescriptorMaxVersionLength,
  genericVersionPattern,
)
const dynamicVersionSchema = z.string().min(3).max(connectorDescriptorMaxVersionLength)
  .regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*@\d+$/)
const labelSchema = z.string().min(1).max(connectorDescriptorMaxLabelLength)
  .refine((value) => value.trim() === value)
const pointerSchema = z.string().max(connectorDescriptorMaxPointerLength)
  .regex(/^(?:\/(?:[^~/]|~[01])*)+$/)
const finiteNumberSchema = z.number().finite()
const boundedIntegerSchema = z.number().int().nonnegative()
  .max(connectorDescriptorMaxStringLength)
const safeIntegerSchema = z.number().int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)

type ConnectorRendererSchema =
  | { type: 'boolean'; default?: boolean }
  | {
      type: 'number' | 'integer'
      minimum?: number
      maximum?: number
      multipleOf?: number
      default?: number
      enum?: number[]
    }
  | {
      type: 'string'
      format?: 'date'
      minLength?: number
      maxLength?: number
      default?: string
      const?: string
      enum?: string[]
    }
  | {
      type: 'array'
      minItems?: number
      maxItems: number
      uniqueItems?: boolean
      items: ConnectorRendererSchema
    }
  | {
      type: 'object'
      additionalProperties: boolean
      properties: Record<string, ConnectorRendererSchema>
      required?: string[]
      maxProperties?: number
    }
  | { oneOf: ConnectorRendererSchema[] }

function issue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: 'custom', message })
}

function boundsAreValid(minimum: number | undefined, maximum: number | undefined): boolean {
  return minimum === undefined || maximum === undefined || minimum <= maximum
}

function isMultipleOf(value: number, divisor: number): boolean {
  const quotient = value / divisor
  return Math.abs(quotient - Math.round(quotient)) <= Number.EPSILON * 100
}

function numberMatches(
  value: number,
  schema: {
    type: 'number' | 'integer'
    minimum?: number | undefined
    maximum?: number | undefined
    multipleOf?: number | undefined
  },
): boolean {
  if (schema.type === 'integer' && !Number.isInteger(value)) return false
  if (schema.minimum !== undefined && value < schema.minimum) return false
  if (schema.maximum !== undefined && value > schema.maximum) return false
  return schema.multipleOf === undefined || isMultipleOf(value, schema.multipleOf)
}

function stringMatches(
  value: string,
  schema: {
    type: 'string'
    format?: 'date' | undefined
    minLength?: number | undefined
    maxLength?: number | undefined
  },
): boolean {
  if (schema.minLength !== undefined && value.length < schema.minLength) return false
  if (schema.maxLength !== undefined && value.length > schema.maxLength) return false
  return schema.format !== 'date' || z.iso.date().safeParse(value).success
}

const connectorRendererSchema = z.lazy(() => {
  const numberSchema = z.object({
    type: z.enum(['number', 'integer']),
    minimum: finiteNumberSchema.optional(),
    maximum: finiteNumberSchema.optional(),
    multipleOf: finiteNumberSchema.positive().optional(),
    default: finiteNumberSchema.optional(),
    enum: z.array(finiteNumberSchema).min(1).max(connectorDescriptorMaxEnumValues).optional(),
  }).strict().superRefine((schema, context) => {
    if (!boundsAreValid(schema.minimum, schema.maximum)) issue(context, 'invalid numeric bounds')
    if (schema.enum === undefined && (schema.minimum === undefined || schema.maximum === undefined)) {
      issue(context, 'number requires a finite domain')
    }
    if (schema.enum !== undefined) {
      if (new Set(schema.enum).size !== schema.enum.length) issue(context, 'duplicate enum value')
      if (schema.enum.some((value) => !numberMatches(value, schema))) {
        issue(context, 'enum value violates numeric constraints')
      }
    }
    if (schema.default !== undefined) {
      if (!numberMatches(schema.default, schema)) issue(context, 'invalid numeric default')
      if (schema.enum !== undefined && !schema.enum.includes(schema.default)) {
        issue(context, 'default is not an enum value')
      }
    }
  })

  const stringSchema = z.object({
    type: z.literal('string'),
    format: z.literal('date').optional(),
    minLength: boundedIntegerSchema.optional(),
    maxLength: boundedIntegerSchema.max(connectorDescriptorMaxStringLength).optional(),
    default: z.string().max(connectorDescriptorMaxStringLength).optional(),
    const: z.string().max(connectorDescriptorMaxStringLength).optional(),
    enum: z.array(z.string().max(connectorDescriptorMaxStringLength))
      .min(1).max(connectorDescriptorMaxEnumValues).optional(),
  }).strict().superRefine((schema, context) => {
    if (!boundsAreValid(schema.minLength, schema.maxLength)) issue(context, 'invalid string bounds')
    if (schema.maxLength === undefined && schema.enum === undefined && schema.const === undefined) {
      issue(context, 'string requires a finite domain')
    }
    if (schema.enum !== undefined) {
      if (new Set(schema.enum).size !== schema.enum.length) issue(context, 'duplicate enum value')
      if (schema.enum.some((value) => !stringMatches(value, schema))) {
        issue(context, 'enum value violates string constraints')
      }
    }
    if (schema.const !== undefined && !stringMatches(schema.const, schema)) {
      issue(context, 'const violates string constraints')
    }
    if (schema.default !== undefined) {
      if (!stringMatches(schema.default, schema)) issue(context, 'invalid string default')
      if (schema.const !== undefined && schema.default !== schema.const) {
        issue(context, 'default does not equal const')
      }
      if (schema.enum !== undefined && !schema.enum.includes(schema.default)) {
        issue(context, 'default is not an enum value')
      }
    }
  })

  const arraySchema = z.object({
    type: z.literal('array'),
    minItems: boundedIntegerSchema.max(connectorDescriptorMaxArrayItems).optional(),
    maxItems: boundedIntegerSchema.max(connectorDescriptorMaxArrayItems),
    uniqueItems: z.boolean().optional(),
    items: connectorRendererSchema,
  }).strict().superRefine((schema, context) => {
    if (!boundsAreValid(schema.minItems, schema.maxItems)) issue(context, 'invalid array bounds')
  })

  const objectSchema = z.object({
    type: z.literal('object'),
    additionalProperties: z.boolean(),
    properties: z.record(z.string().min(1).max(connectorDescriptorMaxIdentifierLength),
      connectorRendererSchema),
    required: z.array(z.string().min(1).max(connectorDescriptorMaxIdentifierLength))
      .max(connectorDescriptorMaxProperties).optional(),
    maxProperties: z.number().int().nonnegative().max(connectorDescriptorMaxProperties).optional(),
  }).strict().superRefine((schema, context) => {
    const names = Object.keys(schema.properties)
    if (names.length > connectorDescriptorMaxProperties) issue(context, 'too many properties')
    if (names.some((name) => unsafeNames.has(name))) issue(context, 'unsafe property name')
    if (schema.maxProperties !== undefined && names.length > schema.maxProperties) {
      issue(context, 'declared properties exceed maxProperties')
    }
    if (schema.required !== undefined) {
      if (new Set(schema.required).size !== schema.required.length) issue(context, 'duplicate required key')
      if (schema.required.some((name) =>
        !Object.prototype.hasOwnProperty.call(schema.properties, name))) {
        issue(context, 'required key is not declared')
      }
      if (schema.maxProperties !== undefined && schema.required.length > schema.maxProperties) {
        issue(context, 'required keys exceed maxProperties')
      }
    }
  })

  return z.union([
    z.object({ type: z.literal('boolean'), default: z.boolean().optional() }).strict(),
    numberSchema,
    stringSchema,
    arraySchema,
    objectSchema,
    z.object({
      oneOf: z.array(connectorRendererSchema).min(2).max(connectorDescriptorMaxOneOfBranches),
    }).strict(),
  ])
}) as unknown as z.ZodType<ConnectorRendererSchema>

function schemaDepth(schema: ConnectorRendererSchema): number {
  if ('oneOf' in schema) return 1 + Math.max(...schema.oneOf.map(schemaDepth))
  if (schema.type === 'array') return 1 + schemaDepth(schema.items)
  if (schema.type === 'object') {
    return 1 + Math.max(0, ...Object.values(schema.properties).map(schemaDepth))
  }
  return 1
}

const boundedRendererSchema = connectorRendererSchema.refine(
  (schema) => schemaDepth(schema) <= connectorDescriptorMaxSchemaDepth,
  'renderer schema is too deeply nested',
)

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function rootPropertyPointerName(pointer: string): string | undefined {
  if (!pointer.startsWith('/') || pointer.length < 2) return undefined
  const rest = pointer.slice(1)
  if (rest.includes('/')) return undefined
  return decodePointerSegment(rest)
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true
  }
  return false
}

function isMarkupShapedHtml(value: string): boolean {
  return /<[^>\s][^>]*>/.test(value)
}

const providerRouteAnySegmentPattern = /^(?:api|private|internal|v\d+|connectors?|options)$/i
const providerRouteRootSegmentPattern = /^(?:api|v\d+|connectors?|options)$/i

function containsProviderRoutePayload(value: string): boolean {
  for (const match of value.matchAll(/(?:^|[\s(])(\/)?([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+)/g)) {
    const segments = match[2]!.split('/')
    if (match[1] === '/') {
      if (segments.some((segment) => providerRouteAnySegmentPattern.test(segment))) return true
      continue
    }
    if (providerRouteRootSegmentPattern.test(segments[0]!)) return true
  }
  return false
}

function containsUriOrRoutePayload(value: string): boolean {
  if (/:\/\//.test(value)) return true
  if (/\b[a-z][a-z0-9+.-]*:[^\s]/i.test(value)) return true
  if (/\bwww\./i.test(value)) return true
  if (/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b(?:\/\S*)?/i.test(value)) return true
  return containsProviderRoutePayload(value)
}

function containsAuthOrSecretMaterial(value: string): boolean {
  return /\b(?:bearer|authorization|passwords?|tokens?|credentials?|cookies?|secrets?|session-secret|oauth|api\s*keys?|sessionids?|session\s*ids?)\b/i
    .test(value)
}

function containsMarkupOrCodeForm(value: string): boolean {
  if (isMarkupShapedHtml(value)) return true
  if (/`/.test(value)) return true
  if (/!\[[^\]]*]\([^)]*\)|\[[^\]]*]\([^)]*\)/.test(value)) return true
  if (/\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~/.test(value)) return true
  if (/(?<![\w*])\*[^*\s][^*]*\*(?![\w*])/.test(value)) return true
  if (/(?<![\w_])_[^_\s][^_]*_(?![\w_])/.test(value)) return true
  if (/^#{1,6}\s/m.test(value)) return true
  if (/^([*+-]|\d+\.)\s/m.test(value)) return true
  return /\{\s*\}/.test(value)
}

function isCodeShapedCallee(callee: string): boolean {
  if (callee.startsWith('$')) return true
  if (callee.includes('.') || callee.includes('_')) return true
  return /[a-z][A-Z]/.test(callee)
}

function isExplicitExecutableName(callee: string): boolean {
  return /^(?:eval|alert|Function|setTimeout|setInterval|fetch|require|import|exec|spawn)$/
    .test(callee)
}

function isNaturalPluralMarker(callee: string, args: string): boolean {
  return args.trim() === 's'
    && /^[A-Za-z]+$/.test(callee)
    && !isCodeShapedCallee(callee)
}

function hasTightCodeArgs(args: string): boolean {
  const trimmed = args.trim()
  if (trimmed.length === 0) return true
  if (/^(['"]).*\1$/.test(trimmed)) return true
  if (/"/.test(trimmed)) return true
  if (/(?<![A-Za-z])'[^']+'(?![A-Za-z])/.test(trimmed)) return true
  return /^[+-]?\d+(\.\d+)?$/.test(trimmed)
}

function containsExecutableForm(value: string): boolean {
  if (/=>/.test(value)) return true
  if (/\(\s*\)/.test(value)) return true
  const callPattern = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\s*)\(([^)]*)\)/g
  for (const match of value.matchAll(callPattern)) {
    const callee = match[1]!
    const whitespace = match[2]!
    const args = match[3]!
    if (isNaturalPluralMarker(callee, args)) continue
    if (whitespace.length === 0) return true
    if (isCodeShapedCallee(callee) || isExplicitExecutableName(callee) || hasTightCodeArgs(args)) {
      return true
    }
  }
  return false
}

function isDisallowedPresentationPlainText(value: string): boolean {
  return containsUriOrRoutePayload(value)
    || containsAuthOrSecretMaterial(value)
    || containsMarkupOrCodeForm(value)
    || containsExecutableForm(value)
}

const presentationPlainTextSchema = (maximum: number) => z.string()
  .min(1)
  .max(maximum)
  .refine((value) => value.trim() === value, 'presentation text must be trimmed')
  .refine((value) => !containsControlCharacter(value), 'presentation text must exclude control characters')
  .refine((value) => !isDisallowedPresentationPlainText(value), 'presentation text must be plain declarative copy')

const connectorDescriptorMaxDescriptionLength = connectorDescriptorMaxStringLength
const connectorDescriptorMaxPresentationFields = connectorDescriptorMaxProperties

const presentationOptionLabelSchema = presentationPlainTextSchema(connectorDescriptorMaxLabelLength)

const presentationOptionSchema = z.object({
  value: z.union([z.string().max(connectorDescriptorMaxStringLength), finiteNumberSchema]),
  label: presentationOptionLabelSchema,
}).strict()

const presentationFieldSchema = z.object({
  label: presentationPlainTextSchema(connectorDescriptorMaxLabelLength),
  description: presentationPlainTextSchema(connectorDescriptorMaxDescriptionLength),
  options: z.array(presentationOptionSchema)
    .min(1)
    .max(connectorDescriptorMaxEnumValues)
    .optional(),
  display: z.object({
    kind: z.literal('duration'),
    storageUnit: z.literal('milliseconds'),
    displayUnit: z.literal('minutes'),
  }).strict().optional(),
}).strict()

const presentationSchema = z.object({
  fields: z.record(pointerSchema, presentationFieldSchema)
    .refine((fields) => Object.keys(fields).length <= connectorDescriptorMaxPresentationFields,
      'too many presentation fields'),
}).strict()

function schemaEnumValues(
  schema: ConnectorRendererSchema,
): Array<string | number> | undefined {
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

function optionValuesCoverEnum(
  options: Array<{ value: string | number }>,
  values: Array<string | number>,
): boolean {
  if (options.length !== values.length) return false
  const seen = new Set<string | number>()
  for (const option of options) {
    if (seen.has(option.value)) return false
    seen.add(option.value)
  }
  return values.every((value) => seen.has(value))
}

const versionedRendererSchemaSchema = z.object({
  version: versionSchema,
  schema: boundedRendererSchema,
  presentation: presentationSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!('type' in value.schema) || value.schema.type !== 'object') {
    issue(context, 'renderer schema must have an object root')
    return
  }
  if (value.presentation === undefined) return
  const properties = value.schema.properties
  for (const [pointer, field] of Object.entries(value.presentation.fields)) {
    const name = rootPropertyPointerName(pointer)
    if (name === undefined
      || !Object.prototype.hasOwnProperty.call(properties, name)
      || unsafeNames.has(name)) {
      issue(context, 'presentation pointer is unresolved')
      continue
    }
    const property = properties[name]!
    if (field.options !== undefined) {
      const enumValues = schemaEnumValues(property)
      if (enumValues === undefined || !optionValuesCoverEnum(field.options, enumValues)) {
        issue(context, 'presentation options must exactly cover the field enum')
      }
    }
    if (field.display !== undefined) {
      if ('oneOf' in property
        || (property.type !== 'number' && property.type !== 'integer')) {
        issue(context, 'presentation display is unsupported for this field')
      }
    }
  }
})

type DynamicScalarSchema =
  | { type: 'boolean' }
  | {
      type: 'number'
      minimum?: number
      maximum?: number
      integer?: boolean
    }
  | {
      type: 'integer'
      minimum?: number
      maximum?: number
      enum?: number[]
    }
  | {
      type: 'string'
      minLength?: number
      maxLength: number
      const?: string
      enum?: string[]
    }
type DynamicObjectSchema = {
  type: 'object'
  additionalProperties: false
  properties: Record<string, DynamicScalarSchema>
  required: string[]
  maxProperties: number
}
type DynamicValueSchema = DynamicScalarSchema | DynamicObjectSchema | { oneOf: DynamicObjectSchema[] }

const dynamicScalarSchema = z.union([
  z.object({ type: z.literal('boolean') }).strict(),
  z.object({
    type: z.literal('number'),
    minimum: finiteNumberSchema.optional(),
    maximum: finiteNumberSchema.optional(),
    integer: z.boolean().optional(),
  }).strict().superRefine((schema, context) => {
    if (!boundsAreValid(schema.minimum, schema.maximum)) issue(context, 'invalid numeric bounds')
    if (schema.minimum === undefined || schema.maximum === undefined) {
      issue(context, 'number requires a finite domain')
    }
  }),
  z.object({
    type: z.literal('integer'),
    minimum: safeIntegerSchema.optional(),
    maximum: safeIntegerSchema.optional(),
    enum: z.array(safeIntegerSchema).min(1).max(100).optional(),
  }).strict().superRefine((schema, context) => {
    if (!boundsAreValid(schema.minimum, schema.maximum)) issue(context, 'invalid numeric bounds')
    if (schema.minimum === undefined || schema.maximum === undefined) {
      issue(context, 'integer requires a finite domain')
    }
    const values = schema.enum ?? []
    if (new Set(values).size !== values.length) issue(context, 'duplicate enum value')
    if (values.some((value) => !Number.isInteger(value)
      || (schema.minimum !== undefined && value < schema.minimum)
      || (schema.maximum !== undefined && value > schema.maximum))) {
      issue(context, 'enum value violates numeric constraints')
    }
  }),
  z.object({
    type: z.literal('string'),
    minLength: boundedIntegerSchema.optional(),
    maxLength: boundedIntegerSchema.positive().max(connectorDescriptorMaxStringLength),
    const: z.string().min(1).max(connectorDescriptorMaxStringLength).optional(),
    enum: z.array(z.string().min(1).max(connectorDescriptorMaxStringLength))
      .min(1).max(100).optional(),
  }).strict().superRefine((schema, context) => {
    if (!boundsAreValid(schema.minLength, schema.maxLength)) issue(context, 'invalid string bounds')
    const values = [...(schema.enum ?? []), ...(schema.const === undefined ? [] : [schema.const])]
    if (schema.enum !== undefined && new Set(schema.enum).size !== schema.enum.length) {
      issue(context, 'duplicate enum value')
    }
    if (schema.const !== undefined
      && schema.enum !== undefined
      && !schema.enum.includes(schema.const)) {
      issue(context, 'const is not an enum value')
    }
    if (values.some((value) => value.length < (schema.minLength ?? 0)
      || value.length > schema.maxLength)) issue(context, 'string value violates bounds')
  }),
]) as unknown as z.ZodType<DynamicScalarSchema>

const dynamicObjectSchema = z.object({
  type: z.literal('object'),
  additionalProperties: z.literal(false),
  properties: z.record(
    identifierSchema, dynamicScalarSchema,
  ).refine((properties) => Object.keys(properties).length > 0),
  required: z.array(identifierSchema)
    .min(1).max(connectorDescriptorMaxDynamicObjectProperties),
  maxProperties: z.number().int().positive()
    .max(connectorDescriptorMaxDynamicObjectProperties),
}).strict().superRefine((schema, context) => {
  const names = Object.keys(schema.properties)
  if (names.length > connectorDescriptorMaxDynamicObjectProperties) issue(context, 'too many properties')
  if (names.length > schema.maxProperties) {
    issue(context, 'declared properties exceed maxProperties')
  }
  if (new Set(schema.required).size !== schema.required.length) issue(context, 'duplicate required key')
  if (schema.required.some((name) =>
    !Object.prototype.hasOwnProperty.call(schema.properties, name))) {
    issue(context, 'required key is not declared')
  }
}) as unknown as z.ZodType<DynamicObjectSchema>

const dynamicValueSchema = z.union([
  dynamicScalarSchema,
  dynamicObjectSchema,
  z.object({
    oneOf: z.array(dynamicObjectSchema).min(1).max(10),
  }).strict(),
]) as unknown as z.ZodType<DynamicValueSchema>

function dynamicBranches(schema: DynamicValueSchema): DynamicValueSchema[] {
  return 'oneOf' in schema ? schema.oneOf : [schema]
}

function directProperties(schema: DynamicValueSchema): Set<string> {
  if (!('type' in schema) || schema.type !== 'object') return new Set()
  return new Set(Object.keys(schema.properties).map((name) => `/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`))
}

const searchSchema = z.object({
  minSearchLength: z.number().int().positive().max(connectorDescriptorMaxStringLength),
  maxSearchLength: z.number().int().nonnegative().max(connectorDescriptorMaxStringLength),
  defaultLimit: z.number().int().positive().max(connectorDescriptorMaxArrayItems),
  maxLimit: z.number().int().positive().max(connectorDescriptorMaxArrayItems),
}).strict().superRefine((value, context) => {
  if (value.minSearchLength > value.maxSearchLength) issue(context, 'invalid search bounds')
  if (value.defaultLimit > value.maxLimit) issue(context, 'defaultLimit exceeds maxLimit')
})

const sourceDisplaySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value') }).strict(),
  z.object({ kind: z.literal('property'), labelPointer: pointerSchema }).strict(),
  z.object({
    kind: z.literal('first_nonempty_property'),
    labelPointers: z.array(pointerSchema).min(1).max(connectorDescriptorMaxDisplayPointers),
  }).strict(),
])

const dependencySchema = z.object({
  id: identifierSchema,
  filterPointer: pointerSchema,
  cardinality: z.enum(['one', 'many']),
  required: z.boolean(),
}).strict()

const dynamicSourceSchema = z.object({
  id: identifierSchema,
  version: dynamicVersionSchema,
  label: labelSchema,
  valueSchema: dynamicValueSchema,
  display: sourceDisplaySchema,
  operations: z.object({
    search: searchSchema,
    resolve: z.object({
      maxValues: z.number().int().positive().max(connectorDescriptorMaxArrayItems),
    }).strict().optional(),
  }).strict(),
  dependencies: z.array(dependencySchema).max(connectorDescriptorMaxDependencies).optional(),
}).strict().superRefine((source, context) => {
  const dependencies = source.dependencies ?? []
  if (new Set(dependencies.map((dependency) => dependency.id)).size !== dependencies.length) {
    issue(context, 'duplicate dependency id')
  }
  const branchProperties = dynamicBranches(source.valueSchema).map(directProperties)
  if (source.display.kind === 'property') {
    const { labelPointer } = source.display
    if (branchProperties.some((properties) => !properties.has(labelPointer))) {
      issue(context, 'property display must exist in every branch')
    }
  }
  if (source.display.kind === 'first_nonempty_property') {
    const { labelPointers } = source.display
    if (new Set(labelPointers).size !== labelPointers.length) {
      issue(context, 'duplicate display pointer')
    }
    if (labelPointers.some((pointer) =>
      !branchProperties.some((properties) => properties.has(pointer)))) {
      issue(context, 'display pointer is not declared')
    }
    if (branchProperties.some((properties) =>
      !labelPointers.some((pointer) => properties.has(pointer)))) {
      issue(context, 'display fallbacks must cover every branch')
    }
  }
})

const bindingSchema = z.object({
  filterPointer: pointerSchema,
  sourceId: identifierSchema,
  cardinality: z.enum(['one', 'many']),
  intent: z.enum(['include', 'exclude']),
}).strict()

const dynamicOptionsSchema = z.object({
  protocolVersion: z.literal('connector-dynamic-options@1'),
  version: dynamicVersionSchema,
  sources: z.array(dynamicSourceSchema).min(1).max(connectorDescriptorMaxSources),
  bindings: z.array(bindingSchema).max(connectorDescriptorMaxBindings),
}).strict()

export type ConnectorVersionedRendererSchema = z.infer<typeof versionedRendererSchemaSchema>
type ConnectorDynamicOptions = z.infer<typeof dynamicOptionsSchema>

interface InstalledConnectorDescriptor {
  connectorId: string
  connectorVersion: string
  displayName: string
  configSchema?: ConnectorVersionedRendererSchema
  filterSchema?: ConnectorVersionedRendererSchema
  dynamicOptions?: ConnectorDynamicOptions
}

interface FilterTarget {
  pointer: string
  cardinality: 'one' | 'many' | 'ambiguous'
}

function filterTargets(schema: ConnectorRendererSchema): FilterTarget[] {
  const targets = new Map<string, FilterTarget>()
  const pending: Array<{ schema: ConnectorRendererSchema; prefix: string }> = [
    { schema, prefix: '' },
  ]
  while (pending.length > 0) {
    const current = pending.pop()!
    if ('oneOf' in current.schema) {
      for (const branch of current.schema.oneOf) {
        pending.push({ schema: branch, prefix: current.prefix })
      }
      continue
    }
    if (current.schema.type !== 'object') continue
    for (const [name, property] of Object.entries(current.schema.properties)) {
      const escaped = name.replace(/~/g, '~0').replace(/\//g, '~1')
      const pointer = `${current.prefix}/${escaped}`
      const target: FilterTarget = {
        pointer,
        cardinality: 'type' in property && property.type === 'array' ? 'many' : 'one',
      }
      const existing = targets.get(pointer)
      if (existing === undefined) {
        targets.set(pointer, target)
      } else if (existing.cardinality !== target.cardinality) {
        targets.set(pointer, { pointer, cardinality: 'ambiguous' })
      }
      if (!('type' in property) || property.type !== 'array') {
        pending.push({ schema: property, prefix: pointer })
      }
    }
  }
  return [...targets.values()]
}

const descriptorInnerSchema = z.object({
  connectorId: identifierSchema,
  connectorVersion: versionSchema,
  displayName: labelSchema,
  configSchema: versionedRendererSchemaSchema.optional(),
  filterSchema: versionedRendererSchemaSchema.optional(),
  dynamicOptions: dynamicOptionsSchema.optional(),
}).strict().superRefine((descriptor, context) => {
  if (descriptor.dynamicOptions === undefined) return
  const sourceIds = descriptor.dynamicOptions.sources.map((source) => source.id)
  if (new Set(sourceIds).size !== sourceIds.length) issue(context, 'duplicate source id')

  const bindings = descriptor.dynamicOptions.bindings
  const bindingKeys = bindings.map((binding) =>
    `${binding.filterPointer}\u0000${binding.sourceId}\u0000${binding.cardinality}\u0000${binding.intent}`)
  if (new Set(bindingKeys).size !== bindingKeys.length) issue(context, 'duplicate binding')
  if (bindings.some((binding) => !sourceIds.includes(binding.sourceId))) {
    issue(context, 'binding source is undeclared')
  }

  const targets = new Map(
    descriptor.filterSchema === undefined
      ? []
      : filterTargets(descriptor.filterSchema.schema).map((target) => [target.pointer, target]),
  )
  if (bindings.some((binding) => targets.get(binding.filterPointer)?.cardinality
    !== binding.cardinality)) {
    issue(context, 'binding pointer or cardinality is invalid')
  }
  if (descriptor.dynamicOptions.sources.some((source) =>
    (source.dependencies ?? []).some((dependency) =>
      targets.get(dependency.filterPointer)?.cardinality !== dependency.cardinality))) {
    issue(context, 'dependency pointer or cardinality is invalid')
  }
}) as unknown as z.ZodType<InstalledConnectorDescriptor>

const descriptorPlainDataSchema = z.unknown().transform((value, context) => {
  const snapshot = snapshotBoundedPlainData(value, {
    maxDepth: connectorDescriptorMaxSchemaDepth + 12,
    maxNodes: 100_000,
    maxArrayLength: 10_000,
  })
  if (!snapshot.success) {
    context.addIssue({ code: 'custom', message: 'descriptor must be bounded plain data' })
    return z.NEVER
  }
  return snapshot.value
})

export const installedConnectorDescriptorSchema =
  descriptorPlainDataSchema.pipe(descriptorInnerSchema) as unknown as z.ZodType<InstalledConnectorDescriptor>

export type ConnectorNewestFrontierState =
  | { state: 'not_started' }
  | { state: 'advancing' | 'caught_up' }

export type ConnectorHistoricalBackfillState =
  | { state: 'not_started'; boundary: { earliestDate: string } }
  | {
      state: 'advancing' | 'caught_up' | 'boundary_reached' | 'source_exhausted'
      boundary: { earliestDate: string }
    }
