import { describe, expect, it } from 'vitest'
import { UUID_V7_PATTERN } from '@sparxie/valedictorian-local-runtime/testing/db/lifecycle-vocabulary'
import { createUuidV7Generator, uuidv7 } from '@sparxie/valedictorian-local-runtime/testing/db/uuidv7'

const uuidV7Regex = new RegExp(UUID_V7_PATTERN, 'i')
const lowercaseUuidV7 = new RegExp(UUID_V7_PATTERN)

describe('uuidv7 (#300 app-side generator)', () => {
  it('builds a contract-valid lowercase UUIDv7 with version 7 and variant bits from a fixed timestamp + bytes', () => {
    const random = Uint8Array.from([0xff, 0xff, 0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    const id = uuidv7(0x0192_3456_789a, random)

    expect(id).toMatch(uuidV7Regex)
    expect(id).toMatch(lowercaseUuidV7) // lowercase hex only
    expect(id[14]).toBe('7') // version nibble
    expect('89ab').toContain(id[19]) // variant nibble
    // 48-bit big-endian timestamp prefix is faithful (0x0192 3456 789a).
    expect(id.slice(0, 8)).toBe('01923456')
    expect(id.slice(9, 13)).toBe('789a')
  })

  it('is lexically time-ordered by the timestamp prefix', () => {
    const random = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const earlier = uuidv7(1_000, random)
    const later = uuidv7(2_000, random)
    expect(earlier < later).toBe(true)
  })

  it('produces contract-valid ids from the real random source and the clock generator', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(uuidv7(Date.now())).toMatch(uuidV7Regex)
    }
    let tick = 0
    const generate = createUuidV7Generator(() => new Date(1_700_000_000_000 + tick++))
    const ids = Array.from({ length: 50 }, () => generate())
    expect(ids.every((id) => uuidV7Regex.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length) // no collisions
  })

  it('rejects insufficient random material', () => {
    expect(() => uuidv7(0, Uint8Array.from([1, 2, 3]))).toThrow(/at least 10 random bytes/)
  })
})
