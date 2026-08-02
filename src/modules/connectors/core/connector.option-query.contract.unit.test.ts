import { describe, expect, it } from 'vitest'
import type {
  ConnectorOptionQueryBody,
  ConnectorOptionQueryErrorCode,
} from '@sparxie/sdk'
import { connectorOptionQueryResultSchema } from '@sparxie/sdk'
import {
  sanitizeConnectorOptionCoreResult,
  validateConnectorOptionQueryContract,
} from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/core/connector.option-query.contract'

describe('connector option query contract', () => {
  it.each([
    {
      name: 'an undeclared module-like source',
      mutate: (body: ConnectorOptionQueryBody) => ({ ...body, sourceId: 'internal.module.exec' }),
      code: 'option_source_undeclared',
    },
    {
      name: 'an arbitrary endpoint source',
      mutate: (body: ConnectorOptionQueryBody) => ({ ...body, sourceId: 'https://attacker.invalid/options' }),
      code: 'option_source_undeclared',
    },
    {
      name: 'an undeclared dependency',
      mutate: (body: ConnectorOptionQueryBody) => ({
        ...body,
        dependencies: { ...body.dependencies, endpoint: 'https://attacker.invalid/options' },
      }),
      code: 'option_dependency_undeclared',
    },
    {
      name: 'a search beyond the source bound',
      mutate: (body: ConnectorOptionQueryBody) => ({
        ...body,
        operation: { kind: 'search' as const, search: 'x'.repeat(101), limit: 10 },
      }),
      code: 'option_value_invalid',
    },
    {
      name: 'a result limit beyond the source bound',
      mutate: (body: ConnectorOptionQueryBody) => ({
        ...body,
        operation: { kind: 'search' as const, search: 'react', limit: 21 },
      }),
      code: 'option_value_invalid',
    },
    {
      name: 'a malformed resolve value',
      mutate: (body: ConnectorOptionQueryBody) => ({
        ...body,
        operation: { kind: 'resolve' as const, values: [42] },
      }),
      code: 'option_value_invalid',
    },
    {
      name: 'too many resolve values',
      mutate: (body: ConnectorOptionQueryBody) => ({
        ...body,
        operation: {
          kind: 'resolve' as const,
          values: Array.from({ length: 11 }, (_, index) => `skill-${index}`),
        },
      }),
      code: 'option_value_invalid',
    },
  ] satisfies Array<{
    name: string
    mutate: (body: ConnectorOptionQueryBody) => ConnectorOptionQueryBody
    code: ConnectorOptionQueryErrorCode
  }>)('maps $name to $code without HTTP or a database', ({ mutate, code }) => {
    expect(() => validate(mutate(validBody()))).toThrow(expect.objectContaining({ code }))
  })

  it.each([
    {
      name: 'connector descriptor',
      code: 'unsupported_descriptor',
      actual: { ...actualIdentity(), connectorId: 'fixture.stale-provider' },
      expected: expectedIdentity(),
    },
    {
      name: 'connector version',
      code: 'connector_version_mismatch',
      actual: { ...actualIdentity(), connectorVersion: '1.2.2' },
      expected: expectedIdentity(),
    },
    {
      name: 'filter schema',
      code: 'filter_schema_version_mismatch',
      actual: { ...actualIdentity(), filterSchemaVersion: 'fixture-provider-filters@0' },
      expected: expectedIdentity(),
    },
    {
      name: 'option catalog',
      code: 'option_catalog_version_mismatch',
      actual: { ...actualIdentity(), catalogVersion: 'fixture-provider-options@0' },
      expected: expectedIdentity(),
    },
    {
      name: 'option source',
      code: 'option_source_version_mismatch',
      actual: actualIdentity(),
      expected: { ...expectedIdentity(), sourceVersion: 'fixture-skills@0' },
    },
  ] satisfies Array<{
    name: string
    code: ConnectorOptionQueryErrorCode
    actual: ReturnType<typeof actualIdentity>
    expected: ReturnType<typeof expectedIdentity>
  }>)('maps stale $name identity to $code without persistence', ({ actual, code, expected }) => {
    expect(() => validate(validBody(), actual, expected)).toThrow(
      expect.objectContaining({ code }),
    )
  })

  it.each([
    {
      name: 'rate-limited retryability',
      core: { status: 'error', code: 'rate_limited', retryable: false, retryAfterMs: 125 },
      public: { status: 'error', code: 'rate_limited', retryable: true, retryAfterMs: 125 },
    },
    {
      name: 'temporary retryability',
      core: { status: 'error', code: 'temporarily_unavailable', retryable: false },
      public: { status: 'error', code: 'temporarily_unavailable', retryable: true },
    },
    {
      name: 'provider rejection terminality',
      core: { status: 'error', code: 'provider_rejected', retryable: true, retryAfterMs: 125 },
      public: { status: 'error', code: 'provider_rejected', retryable: false },
    },
    {
      name: 'terminal retry-after removal',
      core: { status: 'error', code: 'unexpected_response', retryable: false, retryAfterMs: 125 },
      public: { status: 'error', code: 'unexpected_response', retryable: false },
    },
    {
      name: 'retryable unexpected response',
      core: { status: 'error', code: 'unexpected_response', retryable: true, retryAfterMs: 125 },
      public: { status: 'error', code: 'unexpected_response', retryable: true, retryAfterMs: 125 },
    },
    {
      name: 'private provider error',
      core: {
        status: 'error', code: 'private_cookie_expired', retryable: false,
        message: 'session_cookie=private-cookie; password=private-password', retryAfterMs: 125,
      },
      public: { status: 'error', code: 'unexpected_response', retryable: false },
    },
    {
      name: 'private retryable value',
      core: {
        status: 'error', code: 'unexpected_response', retryable: 'session_cookie=private-cookie',
        message: 'password=private-password', retryAfterMs: 125,
      },
      public: { status: 'error', code: 'unexpected_response', retryable: false },
    },
    {
      name: 'invalid retry-after',
      core: {
        status: 'error', code: 'temporarily_unavailable', retryable: true, retryAfterMs: -125,
      },
      public: { status: 'error', code: 'temporarily_unavailable', retryable: true },
    },
  ])('sanitizes $name without HTTP or persistence', ({ core, public: publicResult }) => {
    const result = connectorOptionQueryResultSchema.parse({
      connectorInstanceId: 'fixture-provider-instance',
      ...actualIdentity(),
      sourceId: 'fixture.skills',
      sourceVersion: 'fixture-skills@1',
      ...sanitizeConnectorOptionCoreResult(core as never, fixtureSource.valueSchema),
    })

    expect(result).toEqual(expect.objectContaining(publicResult))
    expect(JSON.stringify(result)).not.toMatch(
      /private_cookie|session_cookie|private-cookie|private-password|password/i,
    )
  })
})

function validate(
  body: ConnectorOptionQueryBody,
  actual = actualIdentity(),
  expected = expectedIdentity(),
) {
  return validateConnectorOptionQueryContract({
    actualIdentity: actual,
    body,
    dynamicOptions: fixtureDynamicOptions,
    expectedIdentity: expected,
    filterSchema: fixtureFilterSchema.schema,
  })
}

function validBody(): ConnectorOptionQueryBody {
  return {
    sourceId: 'fixture.skills',
    dependencies: { country: 'US' },
    operation: { kind: 'search', search: 'react', limit: 10 },
  }
}

function actualIdentity() {
  return {
    connectorId: 'fixture.provider',
    connectorVersion: '1.2.3',
    filterSchemaVersion: 'fixture-provider-filters@1',
    catalogVersion: 'fixture-provider-options@1',
  }
}

function expectedIdentity() {
  return { ...actualIdentity(), sourceVersion: 'fixture-skills@1' }
}

const fixtureFilterSchema = {
  version: 'fixture-provider-filters@1',
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      country: { type: 'string' as const, enum: ['US', 'CA'] },
      skills: {
        type: 'array' as const,
        maxItems: 10,
        uniqueItems: true,
        items: { type: 'string' as const, minLength: 1, maxLength: 100 },
      },
    },
  },
}

const fixtureDynamicOptions = {
  protocolVersion: 'connector-dynamic-options@1' as const,
  version: 'fixture-provider-options@1',
  sources: [{
    id: 'fixture.skills',
    version: 'fixture-skills@1',
    label: 'Skill',
    valueSchema: { type: 'string' as const, minLength: 1, maxLength: 100 },
    display: { kind: 'value' as const },
    operations: {
      search: { minSearchLength: 1, maxSearchLength: 100, defaultLimit: 10, maxLimit: 20 },
      resolve: { maxValues: 10 },
    },
    dependencies: [{
      id: 'country', filterPointer: '/country', cardinality: 'one' as const, required: true,
    }],
  }],
  bindings: [{
    filterPointer: '/skills', sourceId: 'fixture.skills', cardinality: 'many' as const,
    intent: 'include' as const,
  }],
}

const fixtureSource = fixtureDynamicOptions.sources[0]
