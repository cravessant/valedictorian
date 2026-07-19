import { describe, expect, it } from 'vitest'
import type { CanonicalCandidateField, JsonValue } from 'sparxie'
import {
  createDefaultNormalizationResolverRegistry,
  type NormalizationResolverContext,
} from './normalization.registry'

describe('deterministic normalization facts', () => {
  it.each([
    [{ value: '2026-02-29', precision: 'date', raw: 'Feb 29' }, { value: null, precision: 'unknown', raw: 'Feb 29' }],
    [{ value: 'not-a-date', precision: 'date', raw: 'not-a-date' }, { value: null, precision: 'unknown', raw: 'not-a-date' }],
    [{ value: '2026-07-10T12:00:00', precision: 'instant', raw: 'no timezone' }, { value: null, precision: 'unknown', raw: 'no timezone' }],
    [{ value: '2026-02-29T12:00:00Z', precision: 'instant', raw: 'bad leap day' }, { value: null, precision: 'unknown', raw: 'bad leap day' }],
    [{ value: '2026-07-10T12:00:00+99:00', precision: 'instant', raw: 'bad offset' }, { value: null, precision: 'unknown', raw: 'bad offset' }],
    [{ value: '2 days ago', precision: 'relative', raw: '2 days ago' }, { value: null, precision: 'relative', raw: '2 days ago' }],
    [{ value: 'stale', precision: 'unknown', raw: 'unknown' }, { value: null, precision: 'unknown', raw: 'unknown' }],
    [{ value: '2024-02-29', precision: 'date', raw: 'Feb 29' }, { value: '2024-02-29', precision: 'date', raw: 'Feb 29' }],
    [{ value: '2026-07-10T12:00:00-04:00', precision: 'instant', raw: 'Jul 10' }, { value: '2026-07-10T12:00:00-04:00', precision: 'instant', raw: 'Jul 10' }],
  ])('normalizes postedAt without constructing PGlite: %j', async (postedAt, expected) => {
    const outcome = await explicitFactOutcome({ postedAt }, 'postedAt')

    expect(outcome).toMatchObject({
      value: expected,
      evidence: [expect.objectContaining({ value: postedAt })],
    })
  })

  it.each([
    [{ minimum: 100, maximum: 10, currency: '', interval: 'year', raw: '$100-$10' }, null],
    [{ minimum: 10, maximum: 100, currency: '', interval: 'year', raw: '$10-$100' }, null],
    [{ minimum: -1, maximum: null, currency: 'usd', interval: 'year', raw: '-$1' }, null],
    [{ minimum: null, maximum: null, currency: null, interval: 'year', raw: null }, null],
    [{ minimum: 10, maximum: 100, currency: ' usd ', interval: 'year', raw: ' $10-$100 ' }, { minimum: 10, maximum: 100, currency: 'USD', interval: 'year', raw: '$10-$100' }],
    [{ minimum: null, maximum: null, currency: null, interval: 'year', raw: ' Competitive ' }, { minimum: null, maximum: null, currency: null, interval: 'year', raw: 'Competitive' }],
    [{ minimum: 10, maximum: null, currency: 'USD', interval: 'fortnight', raw: '$10' }, null],
  ])('normalizes compensation without constructing PGlite: %j', async (compensation, expected) => {
    const outcome = await explicitFactOutcome({ compensation }, 'compensation')

    expect(outcome).toMatchObject({
      value: expected,
      evidence: [expect.objectContaining({ value: compensation })],
    })
  })

  it('preserves invalid structured optional input as raw evidence', async () => {
    const compensation = { minimum: 'many', interval: 'year' }
    const outcome = await explicitFactOutcome({ compensation }, 'compensation')

    expect(outcome).toMatchObject({
      value: null,
      evidence: [expect.objectContaining({ value: compensation })],
    })
  })
})

async function explicitFactOutcome(
  payload: Record<string, JsonValue>,
  field: CanonicalCandidateField,
) {
  const resolver = createDefaultNormalizationResolverRegistry().resolvers.find(
    ({ declaration }) => declaration.id === 'deterministic.explicit-facts',
  )
  if (!resolver) throw new Error('Explicit facts resolver is missing')

  const context = {
    rawRevision: { payload },
    sourceEntity: null,
    enabledCapabilities: ['pure'],
    resolverId: resolver.declaration.id,
    hashInput(value: JsonValue) {
      return JSON.stringify(value) ?? 'undefined'
    },
  } as unknown as NormalizationResolverContext
  const outcomes = await resolver.resolve(context)
  const outcome = outcomes.find((candidate) => candidate.field === field)
  if (!outcome) throw new Error(`Explicit facts resolver omitted ${field}`)
  return outcome
}
