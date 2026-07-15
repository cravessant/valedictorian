import { describe, expect, it } from 'vitest'
import type { ConnectorRendererSchema } from 'sparxie'
import { validateConnectorSchemaValue } from './connector.renderer-schema-validation'

describe('connector renderer schema validation', () => {
  const dateSchema = {
    type: 'string',
    format: 'date',
    maxLength: 10,
  } satisfies ConnectorRendererSchema

  it.each([
    '2025-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
  ])('rejects the impossible calendar date %s', (value) => {
    expect(validateConnectorSchemaValue(dateSchema, value)).toEqual([
      { path: '/', message: 'must be a date' },
    ])
  })

  it.each([
    '2024-02-29',
    '2026-04-30',
    '2026-12-31',
  ])('accepts the real calendar date %s', (value) => {
    expect(validateConnectorSchemaValue(dateSchema, value)).toEqual([])
  })
})
