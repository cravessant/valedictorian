import { describe, expect, it } from 'vitest'
import { createInMemoryDatabase } from '../../db/sqlite'
import { createApplicationServiceFromSqlite } from './application.runtime'

describe('application runtime factory', () => {
  it('creates a seeded application service from SQLite', async () => {
    const sqlite = createInMemoryDatabase()

    const service = createApplicationServiceFromSqlite(sqlite)
    const result = await service.listApplications()

    expect(result.items).toHaveLength(3)
    expect(result.total).toBe(3)
  })
})
