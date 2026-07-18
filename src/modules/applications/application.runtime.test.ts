import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase, type PgliteClient } from '../../db/pglite'
import { createApplicationServiceFromPglite } from './application.runtime'

const clients: PgliteClient[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

describe('application runtime factory', () => {
  it('creates an empty application service from PGlite by default', async () => {
    const client = await createPgliteClient()
    clients.push(client)
    const database = await migratePgliteDatabase(client)

    const service = createApplicationServiceFromPglite(database)
    const result = await service.listApplications()

    expect(result.items).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})
