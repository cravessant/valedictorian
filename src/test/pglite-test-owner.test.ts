import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applications } from '../db/schema'
import { createPgliteTestOwner } from './pglite-test-owner'

describe('PGlite test owner', () => {
  it('opens an isolated migrated database with no domain rows', async () => {
    const owner = await createPgliteTestOwner()

    await expect(owner.database.select().from(applications)).resolves.toEqual([])
  })

  it('cleans its cloned directory when callers close the exposed client', async () => {
    const owner = await createPgliteTestOwner()

    await owner.client.close()
    await owner.client.close()

    expect(fs.existsSync(owner.dataPath)).toBe(false)
  })
})
