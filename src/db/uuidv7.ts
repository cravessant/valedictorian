/**
 * App-side UUIDv7 generator + clock port (issue #300).
 *
 * Runtime Job minting uses this; the migration's deterministic `mint_job_uuid`
 * stays migration-only. Layout (RFC 9562): 48-bit big-endian unix-ms timestamp,
 * 4-bit version (7), 12 bits rand_a, 2-bit variant (0b10), 62 bits rand_b — 74
 * random bits total. Lowercase hex, matching the sparxie contract's
 * case-insensitive UUIDv7 regex.
 *
 * Deliberately no monotonic counter: intra-millisecond collision odds across 74
 * random bits are negligible, and the strong-identity unique index is the real
 * uniqueness guarantee (issue #300 ruling). The timestamp prefix gives rough
 * lexical time-ordering.
 */
import { randomBytes } from 'node:crypto'

/**
 * Build a UUIDv7 from a unix-ms timestamp and 10 random bytes. `random` is
 * injectable so tests are deterministic.
 */
export function uuidv7(unixMs: number, random: Uint8Array = randomBytes(10)): string {
  if (random.length < 10) throw new Error('uuidv7 requires at least 10 random bytes')
  const ms = Math.max(0, Math.floor(unixMs))
  const bytes = new Uint8Array(16)
  // 48-bit big-endian timestamp. Modulo (not &0xff) avoids int32 truncation for
  // millisecond values above 2^31.
  bytes[0] = Math.floor(ms / 2 ** 40) % 256
  bytes[1] = Math.floor(ms / 2 ** 32) % 256
  bytes[2] = Math.floor(ms / 2 ** 24) % 256
  bytes[3] = Math.floor(ms / 2 ** 16) % 256
  bytes[4] = Math.floor(ms / 2 ** 8) % 256
  bytes[5] = ms % 256
  bytes[6] = 0x70 | (random[0]! & 0x0f) // version 7 + 4 bits rand_a
  bytes[7] = random[1]! // 8 bits rand_a
  bytes[8] = 0x80 | (random[2]! & 0x3f) // variant 0b10 + 6 bits rand_b
  bytes[9] = random[3]!
  bytes[10] = random[4]!
  bytes[11] = random[5]!
  bytes[12] = random[6]!
  bytes[13] = random[7]!
  bytes[14] = random[8]!
  bytes[15] = random[9]!
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Clock port: returns the current wall-clock time. Injectable for deterministic tests. */
export type Clock = () => Date

/** A UUIDv7 generator bound to a clock. */
export type UuidV7Generator = () => string

export function createUuidV7Generator(now: Clock): UuidV7Generator {
  return () => uuidv7(now().getTime())
}
