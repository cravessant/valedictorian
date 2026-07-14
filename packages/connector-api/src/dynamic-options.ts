export type ConnectorOptionScalar = string | number | boolean
export type ConnectorOptionValue =
  | ConnectorOptionScalar
  | { readonly [property: string]: ConnectorOptionScalar }

export function parseConnectorOptionValue(
  input: unknown,
  schema?: ConnectorOptionValueSchema,
): ConnectorOptionValue {
  let parsed: ConnectorOptionValue
  if (typeof input === "string") {
    if (input.length > 10_000) throw new TypeError("connector option string is too long")
    parsed = input
  } else if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new TypeError("connector option number must be finite")
    parsed = input
  } else if (typeof input === "boolean") {
    parsed = input
  } else if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new TypeError("connector option value must be a scalar or flat object")
  } else {
    const entries = Object.entries(input)
    if (entries.length < 1 || entries.length > 100) {
      throw new TypeError("connector option object has an invalid property count")
    }
    const parsedObject: Record<string, ConnectorOptionScalar> = {}
    for (const [key, value] of entries) {
      if (
        !dynamicOptionIdentifierPattern.test(key) ||
        dynamicOptionReservedPropertyNames.has(key)
      ) {
        throw new TypeError("connector option property name is invalid")
      }
      if (typeof value === "string") {
        if (value.length > 10_000) throw new TypeError("connector option string is too long")
        parsedObject[key] = value
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("connector option number must be finite")
        parsedObject[key] = value
      } else if (typeof value === "boolean") {
        parsedObject[key] = value
      } else {
        throw new TypeError("connector option object values must be scalar")
      }
    }
    parsed = parsedObject
  }
  if (schema !== undefined && !connectorOptionValueMatchesSchema(parsed, schema)) {
    throw new TypeError("connector option value does not match its source schema")
  }
  return parsed
}
export type ConnectorOptionScalarSchema =
  | {
      type: "string"
      minLength?: number
      maxLength: number
      enum?: readonly string[]
      const?: string
    }
  | {
      type: "number"
      minimum?: number
      maximum?: number
      integer?: boolean
    }
  | {
      type: "integer"
      minimum?: number
      maximum?: number
      enum?: readonly number[]
    }
  | { type: "boolean" }

export type ConnectorOptionObjectSchema = {
  type: "object"
  properties: Readonly<Record<string, ConnectorOptionScalarSchema>>
  required: readonly string[]
  additionalProperties: false
  maxProperties: number
}

export type ConnectorOptionValueSchema =
  | ConnectorOptionScalarSchema
  | ConnectorOptionObjectSchema
  | { oneOf: readonly ConnectorOptionObjectSchema[] }

export type ConnectorDynamicOptionSource = {
  id: string
  version: string
  label: string
  valueSchema: ConnectorOptionValueSchema
  display:
    | { kind: "value" }
    | { kind: "property"; labelPointer: string }
    | {
        kind: "first_nonempty_property"
        labelPointers: readonly string[]
      }
  operations: {
    search: {
      minSearchLength: number
      maxSearchLength: number
      defaultLimit: number
      maxLimit: number
    }
    resolve?: { maxValues: number }
  }
  auth:
    | { mode: "none" }
    | { mode: "connector"; requirementIds: readonly string[] }
  dependencies?: readonly {
    id: string
    filterPointer: string
    cardinality: "one" | "many"
    required: boolean
  }[]
}

export type ConnectorDynamicOptionsDeclaration = {
  protocolVersion: "connector-dynamic-options@1"
  version: string
  sources: readonly ConnectorDynamicOptionSource[]
  bindings: readonly {
    filterPointer: string
    sourceId: string
    cardinality: "one" | "many"
    intent: "include" | "exclude"
  }[]
}

const dynamicOptionIdentifierPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i
const dynamicOptionReservedPropertyNames = new Set([
  "__proto__",
  "constructor",
  "prototype",
])
const dynamicOptionVersionPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*@\d+$/i
const rfc6901PointerPattern = /^(?:\/(?:[^~/]|~[01])*)*$/
const maxDynamicOptionSources = 100
const maxDynamicOptionBindings = 500
const maxDynamicOptionProperties = 100
const maxDynamicOptionStringLength = 10_000
const maxDynamicOptionQueryLimit = 1_000

function dynamicOptionRecord(value: unknown, name: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function dynamicOptionExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string,
): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (dynamicOptionReservedPropertyNames.has(key) || !allowedKeys.has(key)) {
      throw new TypeError(`${name}.${key} is not allowed`)
    }
  }
}

function dynamicOptionText(
  value: unknown,
  name: string,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxDynamicOptionStringLength ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new TypeError(`${name} is invalid`)
  }
  return value
}

function dynamicOptionPositiveInteger(
  value: unknown,
  name: string,
  maximum = maxDynamicOptionQueryLimit,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${name} is invalid`)
  }
  return value as number
}

function dynamicOptionNonNegativeInteger(
  value: unknown,
  name: string,
  maximum = maxDynamicOptionStringLength,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${name} is invalid`)
  }
  return value as number
}

function dynamicOptionPointer(value: unknown, name: string): string {
  const pointer = dynamicOptionText(value, name)
  if (pointer === "" || !rfc6901PointerPattern.test(pointer)) {
    throw new TypeError(`${name} is not an RFC 6901 pointer`)
  }
  return pointer
}

function parseOptionScalarSchema(
  input: unknown,
  name: string,
): ConnectorOptionScalarSchema {
  const value = dynamicOptionRecord(input, name)
  if (value.type === "string") {
    dynamicOptionExactKeys(value, ["type", "minLength", "maxLength", "enum", "const"], name)
    const minLength = value.minLength === undefined
      ? undefined
      : dynamicOptionNonNegativeInteger(value.minLength, `${name}.minLength`)
    const maxLength = dynamicOptionPositiveInteger(value.maxLength, `${name}.maxLength`, maxDynamicOptionStringLength)
    if (minLength !== undefined && minLength > maxLength) throw new TypeError(`${name} has invalid string bounds`)
    const enumValues = value.enum === undefined ? undefined : (() => {
      if (!Array.isArray(value.enum) || value.enum.length < 1 || value.enum.length > 100) throw new TypeError(`${name}.enum is invalid`)
      const parsed = value.enum.map((item, index) => dynamicOptionText(item, `${name}.enum[${index}]`))
      if (parsed.some((item) => item.length < (minLength ?? 0) || item.length > maxLength)) throw new TypeError(`${name}.enum is outside its bounds`)
      if (new Set(parsed).size !== parsed.length) throw new TypeError(`${name}.enum contains duplicates`)
      return parsed
    })()
    const constant = value.const === undefined ? undefined : dynamicOptionText(value.const, `${name}.const`)
    if (constant !== undefined && (constant.length < (minLength ?? 0) || constant.length > maxLength || (enumValues !== undefined && !enumValues.includes(constant)))) throw new TypeError(`${name}.const is outside its bounds`)
    return {
      type: "string",
      maxLength,
      ...(minLength === undefined ? {} : { minLength }),
      ...(enumValues === undefined ? {} : { enum: enumValues }),
      ...(constant === undefined ? {} : { const: constant }),
    }
  }
  if (value.type === "number") {
    dynamicOptionExactKeys(value, ["type", "minimum", "maximum", "integer"], name)
    const minimum = value.minimum
    const maximum = value.maximum
    if (typeof minimum !== "number" || !Number.isFinite(minimum)) throw new TypeError(`${name}.minimum is invalid`)
    if (typeof maximum !== "number" || !Number.isFinite(maximum)) throw new TypeError(`${name}.maximum is invalid`)
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) throw new TypeError(`${name} has invalid numeric bounds`)
    if (value.integer !== undefined && typeof value.integer !== "boolean") throw new TypeError(`${name}.integer is invalid`)
    return { type: "number", minimum, maximum, ...(value.integer === undefined ? {} : { integer: value.integer }) }
  }
  if (value.type === "integer") {
    dynamicOptionExactKeys(value, ["type", "minimum", "maximum", "enum"], name)
    const minimum = value.minimum
    const maximum = value.maximum
    if (!Number.isSafeInteger(minimum)) throw new TypeError(`${name}.minimum is invalid`)
    if (!Number.isSafeInteger(maximum)) throw new TypeError(`${name}.maximum is invalid`)
    if (minimum !== undefined && maximum !== undefined && (minimum as number) > (maximum as number)) throw new TypeError(`${name} has invalid numeric bounds`)
    let enumValues: number[] | undefined
    if (value.enum !== undefined) {
      if (!Array.isArray(value.enum) || value.enum.length < 1 || value.enum.length > 100 || !value.enum.every(Number.isSafeInteger)) throw new TypeError(`${name}.enum is invalid`)
      enumValues = value.enum as number[]
      if (new Set(enumValues).size !== enumValues.length) throw new TypeError(`${name}.enum contains duplicates`)
      if (enumValues.some((item) => item < (minimum as number) || item > (maximum as number))) throw new TypeError(`${name}.enum is outside its bounds`)
    }
    return { type: "integer", minimum: minimum as number, maximum: maximum as number, ...(enumValues === undefined ? {} : { enum: enumValues }) }
  }
  if (value.type === "boolean") {
    dynamicOptionExactKeys(value, ["type"], name)
    return { type: "boolean" }
  }
  throw new TypeError(`${name}.type is invalid`)
}

function parseOptionObjectSchema(
  input: unknown,
  name: string,
): ConnectorOptionObjectSchema {
  const value = dynamicOptionRecord(input, name)
  dynamicOptionExactKeys(value, ["type", "properties", "required", "additionalProperties", "maxProperties"], name)
  if (value.type !== "object" || value.additionalProperties !== false) throw new TypeError(`${name} must be a closed object schema`)
  const maxProperties = dynamicOptionPositiveInteger(value.maxProperties, `${name}.maxProperties`, maxDynamicOptionProperties)
  const rawProperties = dynamicOptionRecord(value.properties, `${name}.properties`)
  const propertyEntries = Object.entries(rawProperties)
  if (propertyEntries.length < 1 || propertyEntries.length > maxProperties) throw new TypeError(`${name}.properties is invalid`)
  const properties: Record<string, ConnectorOptionScalarSchema> = {}
  for (const [property, schema] of propertyEntries) {
    dynamicOptionText(property, `${name}.property`, dynamicOptionIdentifierPattern)
    if (dynamicOptionReservedPropertyNames.has(property)) throw new TypeError(`${name}.property is reserved`)
    properties[property] = parseOptionScalarSchema(schema, `${name}.properties.${property}`)
  }
  if (!Array.isArray(value.required) || value.required.length < 1 || !value.required.every((item) => typeof item === "string" && Object.hasOwn(properties, item))) throw new TypeError(`${name}.required is invalid`)
  if (new Set(value.required).size !== value.required.length) throw new TypeError(`${name}.required contains duplicates`)
  return { type: "object", properties, required: value.required as string[], additionalProperties: false, maxProperties }
}

function connectorOptionValueMatchesScalarSchema(
  value: ConnectorOptionScalar,
  schema: ConnectorOptionScalarSchema,
): boolean {
  if (schema.type === "string") {
    return typeof value === "string" &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= schema.maxLength &&
      (schema.enum === undefined || schema.enum.includes(value)) &&
      (schema.const === undefined || schema.const === value)
  }
  if (schema.type === "boolean") return typeof value === "boolean"
  if (schema.type === "number") {
    return typeof value === "number" && Number.isFinite(value) &&
      value >= (schema.minimum ?? Number.NEGATIVE_INFINITY) &&
      value <= (schema.maximum ?? Number.POSITIVE_INFINITY) &&
      (schema.integer !== true || Number.isSafeInteger(value))
  }
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= (schema.minimum ?? Number.MIN_SAFE_INTEGER) &&
    value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER) &&
    (schema.enum === undefined || schema.enum.includes(value))
}

function connectorOptionValueMatchesObjectSchema(
  value: ConnectorOptionValue,
  schema: ConnectorOptionObjectSchema,
): boolean {
  if (typeof value !== "object") return false
  const entries = Object.entries(value)
  return entries.length <= schema.maxProperties &&
    schema.required.every((property) => Object.hasOwn(value, property)) &&
    entries.every(([property, item]) => {
      const propertySchema = schema.properties[property]
      return propertySchema !== undefined &&
        connectorOptionValueMatchesScalarSchema(item, propertySchema)
    })
}

function connectorOptionValueMatchesSchema(
  value: ConnectorOptionValue,
  schema: ConnectorOptionValueSchema,
): boolean {
  if ("oneOf" in schema) {
    return schema.oneOf.some((variant) => connectorOptionValueMatchesObjectSchema(value, variant))
  }
  return schema.type === "object"
    ? connectorOptionValueMatchesObjectSchema(value, schema)
    : typeof value !== "object" && connectorOptionValueMatchesScalarSchema(value, schema)
}

function displayPointerProperty(pointer: string): string | null {
  if (!pointer.startsWith("/") || pointer.slice(1).includes("/")) return null
  return pointer.slice(1).replaceAll("~1", "/").replaceAll("~0", "~")
}

function optionObjectSchemas(schema: ConnectorOptionValueSchema): readonly ConnectorOptionObjectSchema[] {
  if ("oneOf" in schema) return schema.oneOf
  return schema.type === "object" ? [schema] : []
}

function validateDisplayProjection(
  display: ConnectorDynamicOptionSource["display"],
  schema: ConnectorOptionValueSchema,
  name: string,
): void {
  if (display.kind === "value") return
  const objectSchemas = optionObjectSchemas(schema)
  if (objectSchemas.length === 0) throw new TypeError(`${name} requires object option values`)
  const pointers = display.kind === "property" ? [display.labelPointer] : display.labelPointers
  const properties = pointers.map((pointer) => displayPointerProperty(pointer))
  if (properties.some((property) => property === null)) throw new TypeError(`${name} must use direct property pointers`)
  if (display.kind === "property") {
    if (!objectSchemas.every((variant) => Object.hasOwn(variant.properties, properties[0]!))) throw new TypeError(`${name} points to an unknown property`)
    return
  }
  if (!objectSchemas.every((variant) => properties.some((property) => Object.hasOwn(variant.properties, property!)))) throw new TypeError(`${name} does not cover every option variant`)
  if (properties.some((property) => !objectSchemas.some((variant) => Object.hasOwn(variant.properties, property!)))) throw new TypeError(`${name} points to an unknown property`)
}

function parseOptionValueSchema(input: unknown, name: string): ConnectorOptionValueSchema {
  const value = dynamicOptionRecord(input, name)
  if (Array.isArray(value.oneOf)) {
    dynamicOptionExactKeys(value, ["oneOf"], name)
    if (value.oneOf.length < 1 || value.oneOf.length > 10) throw new TypeError(`${name}.oneOf is invalid`)
    return { oneOf: value.oneOf.map((schema, index) => parseOptionObjectSchema(schema, `${name}.oneOf[${index}]`)) }
  }
  return value.type === "object"
    ? parseOptionObjectSchema(value, name)
    : parseOptionScalarSchema(value, name)
}

export function parseConnectorDynamicOptionsDeclaration(
  input: unknown,
): ConnectorDynamicOptionsDeclaration {
  const value = dynamicOptionRecord(input, "dynamicOptions")
  dynamicOptionExactKeys(value, ["protocolVersion", "version", "sources", "bindings"], "dynamicOptions")
  if (value.protocolVersion !== "connector-dynamic-options@1") throw new TypeError("dynamicOptions.protocolVersion is unsupported")
  const version = dynamicOptionText(value.version, "dynamicOptions.version", dynamicOptionVersionPattern)
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > maxDynamicOptionSources) throw new TypeError("dynamicOptions.sources is invalid")
  const sourceIds = new Set<string>()
  const sources = value.sources.map((inputSource, index): ConnectorDynamicOptionSource => {
    const name = `dynamicOptions.sources[${index}]`
    const source = dynamicOptionRecord(inputSource, name)
    dynamicOptionExactKeys(source, ["id", "version", "label", "valueSchema", "display", "operations", "auth", "dependencies"], name)
    const id = dynamicOptionText(source.id, `${name}.id`, dynamicOptionIdentifierPattern)
    if (sourceIds.has(id)) throw new TypeError("dynamicOptions source ids must be unique")
    sourceIds.add(id)
    const sourceVersion = dynamicOptionText(source.version, `${name}.version`, dynamicOptionVersionPattern)
    const label = dynamicOptionText(source.label, `${name}.label`)
    const display = dynamicOptionRecord(source.display, `${name}.display`)
    let parsedDisplay: ConnectorDynamicOptionSource["display"]
    if (display.kind === "value") {
      dynamicOptionExactKeys(display, ["kind"], `${name}.display`)
      parsedDisplay = { kind: "value" }
    } else if (display.kind === "property") {
      dynamicOptionExactKeys(display, ["kind", "labelPointer"], `${name}.display`)
      parsedDisplay = { kind: "property", labelPointer: dynamicOptionPointer(display.labelPointer, `${name}.display.labelPointer`) }
    } else if (display.kind === "first_nonempty_property") {
      dynamicOptionExactKeys(display, ["kind", "labelPointers"], `${name}.display`)
      if (!Array.isArray(display.labelPointers) || display.labelPointers.length < 1 || display.labelPointers.length > 10) throw new TypeError(`${name}.display.labelPointers is invalid`)
      const labelPointers = display.labelPointers.map((pointer, pointerIndex) => dynamicOptionPointer(pointer, `${name}.display.labelPointers[${pointerIndex}]`))
      if (new Set(labelPointers).size !== labelPointers.length) throw new TypeError(`${name}.display.labelPointers contains duplicates`)
      parsedDisplay = { kind: "first_nonempty_property", labelPointers }
    } else throw new TypeError(`${name}.display.kind is invalid`)
    const operations = dynamicOptionRecord(source.operations, `${name}.operations`)
    dynamicOptionExactKeys(operations, ["search", "resolve"], `${name}.operations`)
    const search = dynamicOptionRecord(operations.search, `${name}.operations.search`)
    dynamicOptionExactKeys(search, ["minSearchLength", "maxSearchLength", "defaultLimit", "maxLimit"], `${name}.operations.search`)
    const minSearchLength = dynamicOptionPositiveInteger(search.minSearchLength, `${name}.operations.search.minSearchLength`, maxDynamicOptionStringLength)
    const maxSearchLength = dynamicOptionPositiveInteger(search.maxSearchLength, `${name}.operations.search.maxSearchLength`, maxDynamicOptionStringLength)
    const defaultLimit = dynamicOptionPositiveInteger(search.defaultLimit, `${name}.operations.search.defaultLimit`)
    const maxLimit = dynamicOptionPositiveInteger(search.maxLimit, `${name}.operations.search.maxLimit`)
    if (minSearchLength > maxSearchLength || defaultLimit > maxLimit) throw new TypeError(`${name}.operations.search has inconsistent limits`)
    let resolve: { maxValues: number } | undefined
    if (operations.resolve !== undefined) {
      const rawResolve = dynamicOptionRecord(operations.resolve, `${name}.operations.resolve`)
      dynamicOptionExactKeys(rawResolve, ["maxValues"], `${name}.operations.resolve`)
      resolve = { maxValues: dynamicOptionPositiveInteger(rawResolve.maxValues, `${name}.operations.resolve.maxValues`) }
    }
    const auth = dynamicOptionRecord(source.auth, `${name}.auth`)
    let parsedAuth: ConnectorDynamicOptionSource["auth"]
    if (auth.mode === "none") {
      dynamicOptionExactKeys(auth, ["mode"], `${name}.auth`)
      parsedAuth = { mode: "none" }
    } else if (auth.mode === "connector") {
      dynamicOptionExactKeys(auth, ["mode", "requirementIds"], `${name}.auth`)
      if (!Array.isArray(auth.requirementIds) || auth.requirementIds.length < 1 || auth.requirementIds.length > 20) throw new TypeError(`${name}.auth.requirementIds is invalid`)
      const requirementIds = auth.requirementIds.map((item, requirementIndex) => dynamicOptionText(item, `${name}.auth.requirementIds[${requirementIndex}]`, dynamicOptionIdentifierPattern))
      if (new Set(requirementIds).size !== requirementIds.length) throw new TypeError(`${name}.auth.requirementIds contains duplicates`)
      parsedAuth = { mode: "connector", requirementIds }
    } else throw new TypeError(`${name}.auth.mode is invalid`)
    let dependencies: ConnectorDynamicOptionSource["dependencies"]
    if (source.dependencies !== undefined) {
      if (!Array.isArray(source.dependencies) || source.dependencies.length > 50) throw new TypeError(`${name}.dependencies is invalid`)
      const dependencyIds = new Set<string>()
      dependencies = source.dependencies.map((rawDependency, dependencyIndex) => {
        const dependencyName = `${name}.dependencies[${dependencyIndex}]`
        const dependency = dynamicOptionRecord(rawDependency, dependencyName)
        dynamicOptionExactKeys(dependency, ["id", "filterPointer", "cardinality", "required"], dependencyName)
        const dependencyId = dynamicOptionText(dependency.id, `${dependencyName}.id`, dynamicOptionIdentifierPattern)
        if (dependencyIds.has(dependencyId)) throw new TypeError(`${name}.dependencies ids must be unique`)
        dependencyIds.add(dependencyId)
        if (dependency.cardinality !== "one" && dependency.cardinality !== "many") throw new TypeError(`${dependencyName}.cardinality is invalid`)
        if (typeof dependency.required !== "boolean") throw new TypeError(`${dependencyName}.required is invalid`)
        return { id: dependencyId, filterPointer: dynamicOptionPointer(dependency.filterPointer, `${dependencyName}.filterPointer`), cardinality: dependency.cardinality, required: dependency.required }
      })
    }
    const valueSchema = parseOptionValueSchema(source.valueSchema, `${name}.valueSchema`)
    validateDisplayProjection(parsedDisplay, valueSchema, `${name}.display`)
    return {
      id,
      version: sourceVersion,
      label,
      valueSchema,
      display: parsedDisplay,
      operations: { search: { minSearchLength, maxSearchLength, defaultLimit, maxLimit }, ...(resolve === undefined ? {} : { resolve }) },
      auth: parsedAuth,
      ...(dependencies === undefined ? {} : { dependencies }),
    }
  })
  if (!Array.isArray(value.bindings) || value.bindings.length > maxDynamicOptionBindings) throw new TypeError("dynamicOptions.bindings is invalid")
  const bindingKeys = new Set<string>()
  const bindings = value.bindings.map((rawBinding, index): ConnectorDynamicOptionsDeclaration["bindings"][number] => {
    const name = `dynamicOptions.bindings[${index}]`
    const binding = dynamicOptionRecord(rawBinding, name)
    dynamicOptionExactKeys(binding, ["filterPointer", "sourceId", "cardinality", "intent"], name)
    const filterPointer = dynamicOptionPointer(binding.filterPointer, `${name}.filterPointer`)
    const sourceId = dynamicOptionText(binding.sourceId, `${name}.sourceId`, dynamicOptionIdentifierPattern)
    if (!sourceIds.has(sourceId)) throw new TypeError(`${name}.sourceId is not declared`)
    if (binding.cardinality !== "one" && binding.cardinality !== "many") throw new TypeError(`${name}.cardinality is invalid`)
    if (binding.intent !== "include" && binding.intent !== "exclude") throw new TypeError(`${name}.intent is invalid`)
    const bindingKey = `${filterPointer}\u0000${sourceId}\u0000${binding.intent}`
    if (bindingKeys.has(bindingKey)) throw new TypeError("dynamicOptions bindings must be unique")
    bindingKeys.add(bindingKey)
    return { filterPointer, sourceId, cardinality: binding.cardinality, intent: binding.intent }
  })
  return { protocolVersion: "connector-dynamic-options@1", version, sources, bindings }
}
