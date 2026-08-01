import { describe, expect, it } from 'vitest'

import {
  parseStrictIntegerOption,
  parseStrictJsonObject,
  parseStrictJsonValue,
} from './valedictorian-cli.parser-options.js'
import { CliUsageError } from './valedictorian-cli.failures.js'

describe('strict option/JSON validation', () => {
  it('rejects empty, non-object, and malformed JSON objects', () => {
    expect(() => parseStrictJsonObject('', '--metadata-json')).toThrow(CliUsageError)
    expect(() => parseStrictJsonObject('[]', '--metadata-json')).toThrow(CliUsageError)
    expect(() => parseStrictJsonObject('"x"', '--metadata-json')).toThrow(CliUsageError)
    expect(() => parseStrictJsonObject('{', '--metadata-json')).toThrow(CliUsageError)
    expect(() => parseStrictJsonObject('null', '--metadata-json')).toThrow(CliUsageError)
    expect(parseStrictJsonObject('{"ok":true}', '--metadata-json')).toEqual({ ok: true })
  })

  it('rejects malformed JSON values and empty payloads', () => {
    expect(() => parseStrictJsonValue('', '--payload-json')).toThrow(CliUsageError)
    expect(() => parseStrictJsonValue('   ', '--payload-json')).toThrow(CliUsageError)
    expect(() => parseStrictJsonValue('{bad', '--payload-json')).toThrow(CliUsageError)
    expect(parseStrictJsonValue('[]', '--payload-json')).toEqual([])
    expect(parseStrictJsonValue('0', '--payload-json')).toBe(0)
  })

  it('rejects partial and prefixed numeric values without coercion', () => {
    expect(() => parseStrictIntegerOption('25abc', '--limit')).toThrow(CliUsageError)
    expect(() => parseStrictIntegerOption('1e2', '--limit')).toThrow(CliUsageError)
    expect(() => parseStrictIntegerOption('01', '--limit')).toThrow(CliUsageError)
    expect(() => parseStrictIntegerOption('', '--limit')).toThrow(CliUsageError)
    expect(() => parseStrictIntegerOption(' 2 ', '--limit')).toThrow(CliUsageError)
    expect(parseStrictIntegerOption('25', '--limit')).toBe(25)
    expect(parseStrictIntegerOption('0', '--offset')).toBe(0)
  })
})
