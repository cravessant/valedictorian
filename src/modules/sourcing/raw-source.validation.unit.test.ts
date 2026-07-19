import { describe, expect, it } from 'vitest'
import type { BatchRawSourceRecordsInput, RawSourceRecordInput } from 'sparxie'
import { validateRawSourceBatchInput } from './raw-source.repository'

const baseRecord: RawSourceRecordInput = {
  adapter: { id: 'fixture.cli', kind: 'cli', version: '1' },
  observedAt: '2026-07-10T12:00:00.000Z',
}

describe('raw source batch input validation', () => {
  const credentialUrl = 'https://raw-user:raw-password@jobs.lever.co/acme/job-1'

  it('accepts a payload at the released JSON-byte limit', () => {
    const input = batch({
      ...baseRecord,
      payload: { data: 'x'.repeat(262_144 - 11) },
    })

    expect(() => validateRawSourceBatchInput(input)).not.toThrow()
  })

  it.each([
    [
      'an oversized payload',
      batch({ ...baseRecord, payload: { data: 'x'.repeat(262_144 - 10) } }),
      /payload exceeds 262144 JSON bytes/,
    ],
    [
      'an oversized evidence value',
      batch({
        ...baseRecord,
        evidence: [{ kind: 'fixture', label: 'oversized', value: 'x'.repeat(16_384 - 1) }],
      }),
      /evidence\[0\]\.value exceeds 16384 JSON bytes/,
    ],
    [
      'too many evidence items',
      batch({
        ...baseRecord,
        evidence: Array.from(
          { length: 51 },
          () => ({ kind: 'fixture', label: 'item', value: null }),
        ),
      }),
      /evidence must contain at most 50 items/,
    ],
    [
      'too many records',
      {
        records: Array.from({ length: 101 }, () => ({ ...baseRecord })),
      },
      /records must contain at most 100 items/,
    ],
  ] satisfies Array<[string, BatchRawSourceRecordsInput, RegExp]>)
  ('rejects %s with the released validation error', (_label, input, message) => {
    expect(() => validateRawSourceBatchInput(input)).toThrow(
      expect.objectContaining({ message: expect.stringMatching(message), statusCode: 400 }),
    )
  })

  it.each([
    ['payload', { payload: { nested: [{ applicationUrl: credentialUrl }] } }],
    ['evidence', {
      evidence: [{ kind: 'fixture', label: 'nested URL', value: { applicationUrl: credentialUrl } }],
    }],
    ['reported origin', {
      reportedOrigin: { kind: 'job_board' as const, name: 'Fixture', url: credentialUrl },
    }],
    ['provider record id', { providerRecordId: credentialUrl }],
  ] satisfies Array<[string, Partial<RawSourceRecordInput>]>)
  ('rejects credential-bearing HTTP URLs throughout raw envelopes: %s', (_label, envelope) => {
    expect(() => validateRawSourceBatchInput(batch({ ...baseRecord, ...envelope }))).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('credential-bearing HTTP URL'),
        statusCode: 400,
      }),
    )
  })

  it('rejects exact credential header aliases throughout fixed envelopes', () => {
    const secretValue = 'envelope-secret-must-not-leak'
    const inputs = [
      { records: [baseRecord], 'X-Auth-Token': secretValue },
      { records: [{ ...baseRecord, 'X-Access-Token': secretValue }] },
      {
        records: [{
          ...baseRecord,
          adapter: { ...baseRecord.adapter, 'X-Api-Token': secretValue },
        }],
      },
      {
        records: [{
          ...baseRecord,
          reportedOrigin: {
            kind: 'job_board' as const,
            name: 'Fixture',
            'proxy-authorization': secretValue,
          },
        }],
      },
      {
        records: [{
          ...baseRecord,
          evidence: [
            { kind: 'fixture', label: 'unsafe', value: null, authentication: secretValue },
          ],
        }],
      },
    ]

    for (const input of inputs) {
      let caught: unknown
      try {
        validateRawSourceBatchInput(input as never)
      } catch (error) {
        caught = error
      }

      expect(caught).toEqual(expect.objectContaining({
        message: expect.stringContaining('forbidden sensitive key'),
        statusCode: 400,
      }))
      expect((caught as Error).message).not.toContain(secretValue)
    }
  })

  it('rejects unknown keys on every fixed transport envelope', () => {
    const inputs = [
      { records: [baseRecord], extra: true },
      { records: [{ ...baseRecord, extra: true }] },
      { records: [{ ...baseRecord, adapter: { ...baseRecord.adapter, extra: true } }] },
      {
        records: [{
          ...baseRecord,
          reportedOrigin: { kind: 'job_board' as const, name: 'Fixture', extra: true },
        }],
      },
      {
        records: [{
          ...baseRecord,
          evidence: [{ kind: 'fixture', label: 'unknown', value: null, extra: true }],
        }],
      },
    ]

    for (const input of inputs) {
      expect(() => validateRawSourceBatchInput(input as never)).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('contains an unsupported property'),
          statusCode: 400,
        }),
      )
    }
  })
})

function batch(record: RawSourceRecordInput): BatchRawSourceRecordsInput {
  return { records: [record] }
}
