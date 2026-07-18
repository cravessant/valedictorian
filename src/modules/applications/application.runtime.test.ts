import { describe, expect, it } from 'vitest'
import { createPgliteTestDatabase } from '../../test/pglite-test-owner'
import { createApplicationServiceFromPglite } from './application.runtime'

describe('application runtime factory', () => {
  it('creates an empty application service from PGlite by default', async () => {
    const database = await createPgliteTestDatabase()

    const service = createApplicationServiceFromPglite(database)
    const result = await service.listApplications()

    expect(result.items).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})
