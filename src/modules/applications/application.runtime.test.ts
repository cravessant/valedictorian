import { describe, expect, it } from 'vitest'
import { createInMemoryDatabase } from '../../db/sqlite'
import { createApplicationServiceFromSqlite } from './application.runtime'

describe('application runtime factory', () => {
  it('creates an empty application service from SQLite by default', async () => {
    const sqlite = createInMemoryDatabase()

    const service = createApplicationServiceFromSqlite(sqlite)
    const result = await service.listApplications()

    expect(result.items).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})
