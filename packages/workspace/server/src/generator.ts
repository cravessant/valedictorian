import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  workspaceFailureDefinitions,
  type WorkspaceFailureCode,
} from './authority-protocol.js'
import {
  sortWorkspaceRoutes,
  workspaceRouteRegistry,
  type WorkspaceRoute,
} from './contract.js'

export const workspaceOpenApiVersion = '1.1.0'
export const workspaceGeneratorVersion = 'workspace-contract-generator/2'

export type JsonObject = Record<string, unknown>
type ReleasedSchemaSnapshot = Readonly<{
  inputSchemas: Readonly<Record<string, JsonObject>>
  schemas: Readonly<Record<string, JsonObject>>
  source: Readonly<{ commit: string; package: string; version: string }>
}>

let releasedSnapshot: ReleasedSchemaSnapshot | undefined

export function readReleasedSdkSchemaSnapshot(): ReleasedSchemaSnapshot {
  if (releasedSnapshot) return releasedSnapshot
  const snapshotPath = fileURLToPath(new URL('./released-sdk-schemas.json', import.meta.url))
  releasedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as ReleasedSchemaSnapshot
  return releasedSnapshot
}

function cloneSchema(schema: JsonObject): JsonObject {
  return structuredClone(schema)
}

export function releasedSchema(
  name: string,
  io: 'input' | 'output' = 'output',
): JsonObject {
  const snapshot = readReleasedSdkSchemaSnapshot()
  const schema = (io === 'input' ? snapshot.inputSchemas : snapshot.schemas)[name]
  if (!schema) throw new Error(`Missing released SDK schema: ${name}`)
  return cloneSchema(schema)
}

function projectSchema(name: string, omitted: readonly string[] = []): JsonObject {
  const schema = releasedSchema(name, 'input')
  if (!omitted.length || schema.type !== 'object') return schema
  const properties = { ...schema.properties as JsonObject }
  for (const key of omitted) delete properties[key]
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string' && !omitted.includes(key))
    : undefined
  return {
    ...schema,
    properties,
    ...(required?.length ? { required } : { required: undefined }),
  }
}

export function operationRequestSchema(route: WorkspaceRoute): JsonObject | undefined {
  const request = route.schemas.request
  return request ? projectSchema(request.schema, request.omit) : undefined
}

export function operationResponseSchema(route: WorkspaceRoute): JsonObject | undefined {
  if (!route.schemas.response) return undefined
  const schema = releasedSchema(route.schemas.response)
  return route.schemas.responseNullable
    ? { oneOf: [schema, { type: 'null' }] }
    : schema
}

function sortedRoutes(): WorkspaceRoute[] {
  return sortWorkspaceRoutes(workspaceRouteRegistry)
}

function schemaName(route: WorkspaceRoute, suffix: 'Request' | 'Response'): string {
  return `${route.operationId.replace(/[^A-Za-z0-9]+/g, '_')}_${suffix}`
}

function crossFailureSchemaName(code: WorkspaceFailureCode): string {
  return `WorkspaceFailure_${code}`
}

function endpointFailureSchemaName(code: string): string {
  return `ReleasedEndpointFailure_${code}`
}

function endpointFailureSchema(route: WorkspaceRoute, code: string): JsonObject {
  const failure = route.endpointFailures.find((candidate) => candidate.code === code)
  if (!failure) throw new Error(`Missing endpoint failure ${code} for ${route.operationId}`)
  return {
    allOf: [
      releasedSchema(failure.schema),
      {
        type: 'object',
        required: ['code'],
        properties: { code: { const: code } },
      },
    ],
  }
}

type WorkspaceHeaderContract = Readonly<{
  description?: string
  name: string
  required: boolean
  schema: JsonObject
}>

function portableRequestHeaderContracts(route: WorkspaceRoute): WorkspaceHeaderContract[] {
  if (!portableMutation(route)) return []
  const description = 'Required by portable authorities; adapted for the compatible v1 local authority.'
  return [
    {
      name: 'Idempotency-Key',
      required: false,
      description,
      schema: { type: 'string', minLength: 1 },
    },
    {
      name: 'X-Workspace-Authority-Epoch',
      required: false,
      description,
      schema: { type: 'integer', minimum: 0 },
    },
    {
      name: 'X-Request-Fingerprint',
      required: false,
      description,
      schema: { type: 'string', minLength: 1 },
    },
  ]
}

function successHeaderContracts(): WorkspaceHeaderContract[] {
  return [
    {
      name: 'Idempotency-Replayed',
      required: false,
      schema: { type: 'boolean' },
    },
    {
      name: 'X-Workspace-Authority-Epoch',
      required: false,
      schema: { type: 'integer', minimum: 0 },
    },
  ]
}

function errorHeaderContracts(): WorkspaceHeaderContract[] {
  return [
    {
      name: 'Retry-After',
      required: false,
      schema: { type: 'string' },
    },
    {
      name: 'X-Workspace-Authority-Epoch',
      required: false,
      schema: { type: 'integer', minimum: 0 },
    },
  ]
}

function responseHeaders(
  contracts: readonly WorkspaceHeaderContract[],
): JsonObject {
  return Object.fromEntries(contracts.map(({ name, ...header }) => [name, header]))
}

function errorResponses(route: WorkspaceRoute): JsonObject {
  const failures = [
    ...route.endpointFailures.map((failure) => ({
      code: failure.code,
      status: failure.httpStatus,
      ref: endpointFailureSchemaName(failure.code),
    })),
    ...route.safeErrors.map((code) => ({
      code,
      status: workspaceFailureDefinitions[code].httpStatus,
      ref: crossFailureSchemaName(code),
    })),
  ]
  const statuses = [...new Set(failures.map((failure) => failure.status))].sort((a, b) => a - b)
  return Object.fromEntries(statuses.map((status) => {
    const matching = failures.filter((failure) => failure.status === status)
    return [
      String(status),
      {
        description: `Declared failures in precedence order: ${matching.map(({ code }) => code).join(', ')}.`,
        headers: responseHeaders(errorHeaderContracts()),
        content: {
          'application/json': {
            schema: {
              oneOf: matching.map(({ ref }) => ({ $ref: `#/components/schemas/${ref}` })),
            },
          },
        },
        'x-failure-precedence': matching.map(({ code }) => code),
      },
    ]
  }))
}

function pathParameters(route: WorkspaceRoute): JsonObject[] {
  return [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    in: 'path',
    name: match[1],
    required: true,
    schema: { type: 'string', minLength: 1 },
  }))
}

function queryParameters(route: WorkspaceRoute): JsonObject[] {
  if (route.schemas.request?.location !== 'query') return []
  const schema = operationRequestSchema(route)
  const properties = schema?.properties as JsonObject | undefined
  const required = new Set(Array.isArray(schema?.required) ? schema.required : [])
  return Object.entries(properties ?? {}).map(([name, propertySchema]) => ({
    in: 'query',
    name,
    required: required.has(name),
    schema: propertySchema,
  }))
}

function portableMutation(route: WorkspaceRoute): boolean {
  return [
    'authoritative_execution',
    'authoritative_mutation',
    'secret_administration',
  ].includes(route.operationClass)
}

function operationDocument(route: WorkspaceRoute): JsonObject {
  const mutation = portableMutation(route)
  const requestHeaders = portableRequestHeaderContracts(route)
  return {
    operationId: route.operationId,
    tags: [route.capability],
    parameters: [
      ...pathParameters(route),
      ...queryParameters(route),
      ...requestHeaders.map((header) => ({ in: 'header', ...header })),
    ],
    ...(route.schemas.request?.location === 'body'
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${schemaName(route, 'Request')}` },
              },
            },
          },
        }
      : {}),
    responses: {
      [route.successStatus]: {
        description: route.successStatus === 204 ? 'No content.' : 'Successful response.',
        headers: responseHeaders(successHeaderContracts()),
        ...(route.successStatus === 204
          ? {}
          : {
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${schemaName(route, 'Response')}` },
                },
              },
            }),
      },
      ...errorResponses(route),
    },
    security: route.authentication === 'none' ? [] : [{ bearerAuth: [] }, {}],
    'x-workspace-capability': route.capability,
    'x-workspace-operation-class': route.operationClass,
    ...(route.localOnly ? { 'x-workspace-local-only': true } : {}),
    ...(mutation
      ? {
          'x-portable-required-headers': requestHeaders.map(({ name }) => name),
        }
      : {}),
  }
}

function protocolSchemas(): JsonObject {
  return {
    WorkspaceCapabilityDocument: {
      type: 'object',
      additionalProperties: false,
      required: ['authorityEpoch', 'authorityId', 'capabilities', 'version', 'workspaceId'],
      properties: {
        authorityEpoch: { type: 'integer', minimum: 0 },
        authorityId: { type: 'string', minLength: 1 },
        capabilities: {
          type: 'object',
          additionalProperties: {
            enum: ['supported', 'temporarily_unavailable', 'unsupported'],
          },
        },
        version: { type: 'string', minLength: 1 },
        workspaceId: { type: 'string', minLength: 1 },
      },
    },
    WorkspaceIdentityV1: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'source', 'workspaceId'],
      properties: {
        name: { type: 'string' },
        source: { type: 'string' },
        workspaceId: { type: 'string' },
      },
    },
    WorkspaceIdentityV2: {
      type: 'object',
      additionalProperties: false,
      required: [
        'authorityEpoch', 'authorityId', 'capabilityDocumentVersion',
        'capabilityStates', 'name', 'source', 'workspaceId',
      ],
      properties: {
        authorityEpoch: { type: 'integer', minimum: 0 },
        authorityId: { type: 'string' },
        capabilityDocumentVersion: { type: 'string' },
        capabilityStates: { type: 'object', additionalProperties: { type: 'string' } },
        name: { type: 'string' },
        source: { type: 'string' },
        workspaceId: { type: 'string' },
      },
    },
    WorkspaceIdentity: {
      oneOf: [
        { $ref: '#/components/schemas/WorkspaceIdentityV1' },
        { $ref: '#/components/schemas/WorkspaceIdentityV2' },
      ],
    },
    WorkspaceReceipt: releasedSchema('workspaceReceiptSchema'),
  }
}

export function createWorkspaceOpenApiDocument(): JsonObject {
  const paths: JsonObject = {}
  const schemas: JsonObject = protocolSchemas()
  for (const [code, definition] of Object.entries(workspaceFailureDefinitions)) {
    schemas[crossFailureSchemaName(code as WorkspaceFailureCode)] = {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'httpStatus', 'kind', 'message', 'retry'],
      properties: {
        code: { const: code },
        httpStatus: { const: definition.httpStatus },
        kind: { const: definition.kind },
        message: { type: 'string' },
        retry: { const: definition.retry },
      },
    }
  }
  for (const route of sortedRoutes()) {
    const pathItem = (paths[route.path] ??= {}) as JsonObject
    pathItem[route.method.toLowerCase()] = operationDocument(route)
    const request = operationRequestSchema(route)
    const response = operationResponseSchema(route)
    if (request) {
      schemas[schemaName(route, 'Request')] = {
        ...request,
        'x-authored-schema': true,
        'x-operation-id': route.operationId,
      }
    }
    if (response) {
      schemas[schemaName(route, 'Response')] = {
        ...response,
        'x-authored-schema': true,
        'x-operation-id': route.operationId,
      }
    }
    for (const failure of route.endpointFailures) {
      schemas[endpointFailureSchemaName(failure.code)] = endpointFailureSchema(
        route,
        failure.code,
      )
    }
  }
  const source = readReleasedSdkSchemaSnapshot().source
  return {
    openapi: '3.1.0',
    info: {
      title: 'Valedictorian Workspace API',
      version: workspaceOpenApiVersion,
      description: 'Producer-owned portable workspace wire contract.',
    },
    servers: [{ url: 'http://127.0.0.1:4317' }],
    paths,
    components: {
      schemas,
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
    'x-generator': { name: workspaceGeneratorVersion },
    'x-released-sdk-baseline': source,
  }
}

function typeName(operationId: string, suffix: 'Input' | 'Result'): string {
  return `${operationId.split(/[^A-Za-z0-9]+/).map(
    (part) => part.slice(0, 1).toUpperCase() + part.slice(1),
  ).join('')}${suffix}`
}

function schemaType(
  schema: JsonObject,
  root: JsonObject = schema,
  visitedReferences: ReadonlySet<string> = new Set(),
): string {
  if ('$ref' in schema && typeof schema.$ref === 'string') {
    if (visitedReferences.has(schema.$ref)) return 'unknown'
    const reference = schema.$ref.match(/^#\/(\$defs|definitions)\/(.+)$/)
    const definitions = reference?.[1] === '$defs' ? root.$defs : root.definitions
    const definition = reference?.[2]
      && (definitions as JsonObject | undefined)?.[reference[2]]
    return definition && typeof definition === 'object'
      ? schemaType(
        definition as JsonObject,
        root,
        new Set([...visitedReferences, schema.$ref]),
      )
      : 'unknown'
  }
  if (schema.nullable === true) {
    return unionType([
      schemaType({ ...schema, nullable: false }, root, visitedReferences),
      'null',
    ])
  }
  if ('const' in schema) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  for (const unionKey of ['oneOf', 'anyOf'] as const) {
    const union = schema[unionKey]
    if (Array.isArray(union)) {
      return unionType(union.map((candidate) =>
        schemaType(candidate as JsonObject, root, visitedReferences)))
    }
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.map((candidate) =>
      schemaType(candidate as JsonObject, root, visitedReferences)).join(' & ')
  }
  if (schema.type === 'null') return 'null'
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'array') {
    const item = typeof schema.items === 'object' ? schema.items as JsonObject : {}
    return `readonly (${schemaType(item, root, visitedReferences)})[]`
  }
  if (schema.type === 'object' || schema.properties) {
    const properties = schema.properties as JsonObject | undefined
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const members = Object.entries(properties ?? {}).map(([key, value]) =>
      `readonly ${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${schemaType(value as JsonObject, root, visitedReferences)}`)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      members.push(`readonly [key: string]: ${schemaType(schema.additionalProperties as JsonObject, root, visitedReferences)}`)
    }
    return `Readonly<{ ${members.join('; ')} }>`
  }
  return 'unknown'
}

function unionType(types: readonly string[]): string {
  const simpleUnion = types.every((type) => !/[<({[]/.test(type))
  const unique = [...new Set(simpleUnion
    ? types.flatMap((type) => type.split(' | '))
    : types)]
  if (unique.includes('unknown')) return 'unknown'
  const stringLiteralUnion = /^(?:"[^"]*"(?: \| )?)+$/
  const simplified = unique.includes('string')
    ? unique.filter((type) => !stringLiteralUnion.test(type))
    : unique
  return simplified.join(' | ')
}

function projectedOperationSchemas(route: WorkspaceRoute): {
  request?: JsonObject
  response?: JsonObject
} {
  return {
    ...(operationRequestSchema(route) ? { request: operationRequestSchema(route) } : {}),
    ...(operationResponseSchema(route) ? { response: operationResponseSchema(route) } : {}),
  }
}

/** Full immutable compatibility input for the released 0.36.0 operation set. */
export function createReleasedWorkspaceCompatibilitySnapshot(): readonly JsonObject[] {
  return sortedRoutes()
    .filter((route) => route.operationId !== 'receipts.getByIdempotencyKey')
    .map((route) => ({
      operationId: route.operationId,
      method: route.method,
      path: route.path,
      successStatus: route.successStatus,
      authentication: route.authentication,
      request: operationRequestSchema(route) ?? null,
      requestLocation: route.schemas.request?.location ?? null,
      requestHeaders: portableRequestHeaderContracts(route),
      response: operationResponseSchema(route) ?? null,
      successHeaders: successHeaderContracts(),
      errorHeaders: errorHeaderContracts(),
      endpointFailures: route.endpointFailures.map(({ surface, code, httpStatus, kind }) => ({
        surface,
        code,
        httpStatus,
        kind,
        schema: endpointFailureSchema(route, code),
      })),
      crossCuttingFailures: route.safeErrors.map((code) => ({
        code,
        httpStatus: workspaceFailureDefinitions[code].httpStatus,
        kind: workspaceFailureDefinitions[code].kind,
        retry: workspaceFailureDefinitions[code].retry,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'httpStatus', 'kind', 'message', 'retry'],
          properties: {
            code: { const: code },
            httpStatus: { const: workspaceFailureDefinitions[code].httpStatus },
            kind: { const: workspaceFailureDefinitions[code].kind },
            message: { type: 'string' },
            retry: { const: workspaceFailureDefinitions[code].retry },
          },
        },
      })),
    }))
}

function clientOperationLiteral(route: WorkspaceRoute): string {
  const schemas = projectedOperationSchemas(route)
  const failures = [
    ...route.endpointFailures.map((failure) => ({
      ...failure,
      category: 'endpoint',
      schema: endpointFailureSchema(route, failure.code),
    })),
    ...route.safeErrors.map((code) => ({
      code,
      category: 'cross-cutting',
      ...workspaceFailureDefinitions[code],
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'httpStatus', 'kind', 'message', 'retry'],
        properties: {
          code: { const: code },
          httpStatus: { const: workspaceFailureDefinitions[code].httpStatus },
          kind: { const: workspaceFailureDefinitions[code].kind },
          message: { type: 'string' },
          retry: { const: workspaceFailureDefinitions[code].retry },
        },
      },
    })),
  ]
  return JSON.stringify({
    operationId: route.operationId,
    method: route.method,
    path: route.path,
    requestLocation: route.schemas.request?.location ?? null,
    requestSchema: schemas.request ?? null,
    responseSchema: schemas.response ?? null,
    failures,
    successStatus: route.successStatus,
  })
}

function generatedTypeDeclarations(routes: readonly WorkspaceRoute[]): string {
  return routes.map((route) => {
    const request = operationRequestSchema(route)
    const response = operationResponseSchema(route)
    return `export type ${typeName(route.operationId, 'Input')} = ${request ? schemaType(request) : 'undefined'}
export type ${typeName(route.operationId, 'Result')} = ${response ? schemaType(response) : 'undefined'}`
  }).join('\n')
}

function inputMapEntries(routes: readonly WorkspaceRoute[]): string {
  return routes.map((route) => {
    const pathNames = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)
    const requestType = typeName(route.operationId, 'Input')
    const fields = [
      ...(route.schemas.request?.location === 'body' ? [`readonly body: ${requestType}`] : []),
      ...(route.schemas.request?.location === 'query' ? [`readonly query: ${requestType}`] : []),
      ...(pathNames.length
        ? [`readonly params: Readonly<{ ${pathNames.map((name) => `readonly ${JSON.stringify(name)}: string`).join('; ')} }>`]
        : []),
      'readonly headers?: Readonly<Record<string, string>>',
      'readonly signal?: AbortSignal',
    ]
    return `  readonly ${JSON.stringify(route.operationId)}: Readonly<{ ${fields.join('; ')} }>`
  }).join('\n')
}

function resultMapEntries(routes: readonly WorkspaceRoute[]): string {
  return routes.map((route) =>
    `  readonly ${JSON.stringify(route.operationId)}: ${typeName(route.operationId, 'Result')}`).join('\n')
}

export function createWorkspaceClientSource(): string {
  const routes = sortedRoutes()
  const operationIds = routes.map(({ operationId }) => JSON.stringify(operationId)).join(' | ')
  return `/* @generated by ${workspaceGeneratorVersion}; DO NOT EDIT. */
/* Source: packages/workspace/openapi/workspace.openapi.json */

export type WorkspaceOperationId = ${operationIds}
export type WorkspaceHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

${generatedTypeDeclarations(routes)}

export type WorkspaceOperationInputMap = {
${inputMapEntries(routes)}
}
export type WorkspaceOperationResultMap = {
${resultMapEntries(routes)}
}
export type WorkspaceOperationInput<Id extends WorkspaceOperationId> = WorkspaceOperationInputMap[Id]
export type WorkspaceOperationResult<Id extends WorkspaceOperationId> = WorkspaceOperationResultMap[Id]

export type WorkspaceClientOptions = Readonly<{
  baseUrl: string | URL
  fetch?: typeof globalThis.fetch
  headers?: Readonly<Record<string, string>>
}>

export const workspaceClientOperations = [
${routes.map((route) => `  ${clientOperationLiteral(route)},`).join('\n')}
] as const

export type WorkspaceOperation = (typeof workspaceClientOperations)[number]

export class WorkspaceClientError extends Error {
  readonly operationId: WorkspaceOperationId
  readonly status: number
  readonly body: unknown
  constructor(operationId: WorkspaceOperationId, status: number, body: unknown) {
    super(\`Workspace operation \${operationId} failed with HTTP \${status}\`)
    this.name = 'WorkspaceClientError'
    this.operationId = operationId
    this.status = status
    this.body = body
  }
}

export class WorkspaceProtocolViolationError extends Error {
  readonly operationId: WorkspaceOperationId
  constructor(operationId: WorkspaceOperationId, message: string) {
    super(\`Workspace operation \${operationId} violated its contract: \${message}\`)
    this.name = 'WorkspaceProtocolViolationError'
    this.operationId = operationId
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringFormatMatches(format: unknown, value: string): boolean {
  if (format === undefined) return true
  if (format === 'uri') {
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  }
  if (format === 'date') {
    return /^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$/.test(value)
  }
  if (format === 'date-time') {
    return /^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d))$/.test(value)
  }
  return false
}

function schemaMatches(schema: Record<string, any>, value: unknown, root = schema): boolean {
  const schemaRoot = schema.$defs || schema.definitions ? schema : root
  if (schema.$ref) {
    const reference = String(schema.$ref).match(/^#\\/(\\$defs|definitions)\\/(.+)$/)
    const definitions = reference?.[1] === '$defs' ? schemaRoot.$defs : schemaRoot.definitions
    const target = reference?.[2] && definitions?.[reference[2]]
    return target ? schemaMatches(target, value, schemaRoot) : false
  }
  if ('const' in schema && value !== schema.const) return false
  if (Array.isArray(schema.enum) && !schema.enum.some((item: unknown) => Object.is(item, value))) return false
  if (schema.not && schemaMatches(schema.not, value, schemaRoot)) return false
  if (Array.isArray(schema.oneOf)) {
    if (schema.oneOf.filter((candidate: Record<string, any>) => schemaMatches(candidate, value, schemaRoot)).length !== 1) return false
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((candidate: Record<string, any>) => schemaMatches(candidate, value, schemaRoot))) return false
  if (Array.isArray(schema.allOf) && !schema.allOf.every((candidate: Record<string, any>) => schemaMatches(candidate, value, schemaRoot))) return false
  if (schema.nullable && value === null) return true
  if (schema.type === 'null') return value === null
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false
    if (schema.minLength !== undefined && value.length < schema.minLength) return false
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return false
    if (!stringFormatMatches(schema.format, value)) return false
  }
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false
  if (schema.type === 'integer' && (!Number.isSafeInteger(value))) return false
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false
    if (schema.maximum !== undefined && value > schema.maximum) return false
    if (schema.exclusiveMinimum === true && schema.minimum !== undefined && value <= schema.minimum) return false
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false
    if (schema.exclusiveMaximum === true && schema.maximum !== undefined && value >= schema.maximum) return false
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return false
    if (schema.multipleOf !== undefined && value / schema.multipleOf % 1 !== 0) return false
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false
    if (schema.minItems !== undefined && value.length < schema.minItems) return false
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return false
    if (schema.items && !value.every((item) => schemaMatches(schema.items, item, schemaRoot))) return false
  }
  if (schema.type === 'object' || schema.properties) {
    if (!isObject(value)) return false
    const properties = schema.properties ?? {}
    if ((schema.required ?? []).some((key: string) => !(key in value))) return false
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) return false
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) return false
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) {
        if (!schemaMatches(properties[key], item, schemaRoot)) return false
      } else if (schema.additionalProperties === false) {
        return false
      } else if (isObject(schema.additionalProperties)
        && !schemaMatches(schema.additionalProperties, item, schemaRoot)) {
        return false
      }
    }
  }
  return true
}

function requireSchema(
  operationId: WorkspaceOperationId,
  label: string,
  schema: Record<string, any> | null,
  value: unknown,
): void {
  if (!schema || !schemaMatches(schema, value)) {
    throw new WorkspaceProtocolViolationError(
      operationId,
      label === 'response'
        ? 'expected exactly the released response schema'
        : \`invalid \${label}\`,
    )
  }
}

function operationFor(operationId: WorkspaceOperationId): WorkspaceOperation {
  const operation = workspaceClientOperations.find((candidate) => candidate.operationId === operationId)
  if (!operation) throw new Error(\`Unknown workspace operation: \${operationId}\`)
  return operation
}

function expandPath(template: string, params: Readonly<Record<string, string>> = {}): string {
  return template.replace(/\\{([^}]+)\\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new TypeError(\`Missing path parameter: \${name}\`)
    return encodeURIComponent(value)
  })
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new TypeError('Workspace response must be JSON')
  return response.json()
}

export type WorkspaceOperationInvoker<Id extends WorkspaceOperationId> =
  {} extends WorkspaceOperationInput<Id>
    ? (input?: WorkspaceOperationInput<Id>) => Promise<WorkspaceOperationResult<Id>>
    : (input: WorkspaceOperationInput<Id>) => Promise<WorkspaceOperationResult<Id>>

export type WorkspaceClient = Readonly<{
  baseUrl: string
  request: <Id extends WorkspaceOperationId>(
    operationId: Id,
    input: WorkspaceOperationInput<Id>,
  ) => Promise<WorkspaceOperationResult<Id>>
  operations: { readonly [Id in WorkspaceOperationId]: WorkspaceOperationInvoker<Id> }
}>

export function createWorkspaceClient(options: WorkspaceClientOptions): WorkspaceClient {
  const baseUrl = new URL(options.baseUrl).toString().replace(/\\/$/, '')
  const fetchImplementation = options.fetch ?? globalThis.fetch
  if (!fetchImplementation) throw new Error('A fetch implementation is required')

  const request = async <Id extends WorkspaceOperationId>(
    operationId: Id,
    input: WorkspaceOperationInput<Id>,
  ): Promise<WorkspaceOperationResult<Id>> => {
    const operation = operationFor(operationId)
    const wireInput = (input ?? {}) as Record<string, any>
    const requestValue = operation.requestLocation === 'body' ? wireInput.body : wireInput.query
    if (operation.requestSchema) requireSchema(operationId, 'request', operation.requestSchema, requestValue)
    const url = new URL(baseUrl + expandPath(operation.path, wireInput.params))
    for (const [key, value] of Object.entries(wireInput.query ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (value !== undefined) {
        url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value))
      }
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...options.headers,
      ...wireInput.headers,
    }
    const init: RequestInit = { method: operation.method, headers, signal: wireInput.signal }
    if (operation.requestLocation === 'body') {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(wireInput.body)
    }
    const response = await fetchImplementation(url, init)
    const body = await readBody(response)
    if (response.status !== operation.successStatus) {
      if (!operation.failures.some((candidate) => candidate.httpStatus === response.status)) {
        throw new WorkspaceProtocolViolationError(
          operationId,
          \`undeclared HTTP status \${response.status}\`,
        )
      }
      const code = isObject(body) && typeof body.code === 'string' ? body.code : undefined
      const failure = operation.failures.find((candidate) =>
        candidate.code === code && candidate.httpStatus === response.status)
      if (!failure || !schemaMatches(failure.schema, body)) {
        throw new WorkspaceProtocolViolationError(operationId, 'undeclared or malformed failure')
      }
      throw new WorkspaceClientError(operationId, response.status, body)
    }
    if (operation.responseSchema) requireSchema(operationId, 'response', operation.responseSchema, body)
    else if (body !== undefined) throw new WorkspaceProtocolViolationError(operationId, 'expected no content')
    return body as WorkspaceOperationResult<Id>
  }

  const operations = Object.fromEntries(workspaceClientOperations.map((operation) => [
    operation.operationId,
    (input?: never) => request(operation.operationId, (input ?? {}) as never),
  ])) as unknown as WorkspaceClient['operations']
  return { baseUrl, request, operations }
}
`
}

export function writeWorkspaceContractArtifacts(repositoryRoot: string): void {
  const openApiPath = path.join(repositoryRoot, 'packages/workspace/openapi/workspace.openapi.json')
  const clientPath = path.join(repositoryRoot, 'packages/workspace/client/src/generated.ts')
  fs.mkdirSync(path.dirname(openApiPath), { recursive: true })
  fs.mkdirSync(path.dirname(clientPath), { recursive: true })
  fs.writeFileSync(openApiPath, `${JSON.stringify(createWorkspaceOpenApiDocument(), null, 2)}\n`)
  fs.writeFileSync(clientPath, createWorkspaceClientSource())
}
