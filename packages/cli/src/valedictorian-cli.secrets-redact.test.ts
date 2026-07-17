import { describe, expect, it } from 'vitest'

import { redactExactValues } from './valedictorian-cli.secrets-redact.js'

describe('exact-match secret redaction', () => {
  it('redacts longest-first and leaves unrelated text alone', () => {
    const text = 'prefix secret-long-value mid secret-long secret-long-value suffix'
    const redacted = redactExactValues(text, ['secret-long-value', 'secret-long'])
    expect(redacted).toBe('prefix [redacted] mid [redacted] [redacted] suffix')
    expect(redacted).not.toContain('secret-long')
    expect(redacted).not.toContain('secret-long-value')
  })

  it('handles regex punctuation, overlaps, duplicates, and control bytes without broad replacement', () => {
    const canary = 'a+b*(c)|d?[e]{2}.$'
    const overlapping = `${canary}-extra`
    const withControls = `pre\u0001${canary}\u001b[31m${overlapping}\npost`

    const redacted = redactExactValues(withControls, [overlapping, canary, canary, ''])

    expect(redacted).toBe('pre\u0001[redacted]\u001b[31m[redacted]\npost')
    expect(redacted).not.toContain(canary)
    expect(redacted).not.toContain(overlapping)
    expect(redactExactValues('unchanged text', [''])).toBe('unchanged text')
    expect(redactExactValues('keep dots and stars a+b', ['a+b*(c)'])).toBe('keep dots and stars a+b')
  })

  it('avoids markers that equal or contain a resolved value', () => {
    const cases: Array<{
      label: string
      text: string
      values: string[]
    }> = [
      {
        label: 'marker-equal',
        text: 'before [redacted] after',
        values: ['[redacted]'],
      },
      {
        label: 'marker-substring',
        text: 'before redacted after',
        values: ['redacted'],
      },
      {
        label: 'overlaps',
        text: 'aaabbb aaabb',
        values: ['aaabbb', 'aaabb'],
      },
      {
        label: 'duplicates',
        text: 'x secret-dup y secret-dup z',
        values: ['secret-dup', 'secret-dup'],
      },
      {
        label: 'controls',
        text: 'pre\u0001ctrl-canary\u001bpost',
        values: ['ctrl-canary'],
      },
      {
        label: 'ordinary',
        text: 'ordinary-canary-value in text',
        values: ['ordinary-canary-value'],
      },
    ]

    for (const testCase of cases) {
      const redacted = redactExactValues(testCase.text, testCase.values)
      for (const value of testCase.values) {
        if (value.length > 0) {
          expect(redacted, testCase.label).not.toContain(value)
        }
      }
    }
  })

  it('does not recreate a secret across a replacement boundary', () => {
    const cases: Array<{ label: string; text: string; values: string[] }> = [
      {
        label: 'prefix-plus-marker',
        text: 'xx[redacted]',
        values: ['x[redacted]'],
      },
      {
        label: 'adjacent-overlap',
        text: 'ababab',
        values: ['abab', 'aba'],
      },
      {
        label: 'marker-bridge',
        text: 'secret[redacted]secret',
        values: ['secret[redacted]', '[redacted]secret'],
      },
      {
        label: 'nested-recreation',
        text: 'yy[redacted]z',
        values: ['y[redacted]', '[redacted]z'],
      },
    ]

    for (const testCase of cases) {
      const redacted = redactExactValues(testCase.text, testCase.values)
      for (const value of testCase.values) {
        expect(redacted, testCase.label).not.toContain(value)
      }
      expect(redacted, `${testCase.label}: nonempty`).toEqual(expect.any(String))
    }

    // Exact known boundary: one pass would recreate x[redacted]
    expect(redactExactValues('xx[redacted]', ['x[redacted]'])).not.toContain('x[redacted]')
  })
})
