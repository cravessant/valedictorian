import { describe, expect, it } from 'vitest'
import { sources } from '../db/schema'
import { useResettablePgliteTestOwner } from './pglite-test-owner'

const owner = useResettablePgliteTestOwner()
const database = () => owner().database

describe.sequential('resettable PGlite test database', () => {
  it('allows an ordinary test to persist data', async () => {
    await database().insert(sources).values({
      id: 'source-from-first-test',
      name: 'First test source',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    })

    await expect(database().select().from(sources)).resolves.toHaveLength(1)
  })

  it('starts the next test empty without constructing another database', async () => {
    await expect(database().select().from(sources)).resolves.toEqual([])
  })

  it('allows a test to change a session-local query setting', async () => {
    await owner().client.exec('set enable_seqscan = off')

    await expect(readEnableSequentialScan()).resolves.toBe('off')
  })

  it('resets session-local settings before the next test', async () => {
    await expect(readEnableSequentialScan()).resolves.toBe('on')
  })
})

async function readEnableSequentialScan() {
  const result = await owner().client.query<{ enable_seqscan: string }>('show enable_seqscan')
  return result.rows[0]?.enable_seqscan
}
