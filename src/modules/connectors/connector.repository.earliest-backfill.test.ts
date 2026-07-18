import { describe, expect, it } from 'vitest'
import { createConnectorRepositoryTestContext } from './connector.repository.pglite-test-helpers'

describe('connector repository earliest backfill date persistence', () => {
  it('defaults create from injected createdAt and preserves explicit earliest dates across updates', async () => {
    const { repository } = await createConnectorRepositoryTestContext()

    const created = await repository.upsertInstance({
      id: 'earliest-default',
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: 'Earliest default',
      enabled: true,
      createdAt: '2026-07-11T15:30:00.000Z',
    })
    expect(created.earliestBackfillDate).toBe('2026-07-04')

    const explicit = await repository.upsertInstance({
      id: 'earliest-explicit',
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: 'Earliest explicit',
      enabled: true,
      createdAt: '2026-07-11T15:30:00.000Z',
      earliestBackfillDate: '2026-05-01',
    })
    expect(explicit.earliestBackfillDate).toBe('2026-05-01')

    const earlier = await repository.upsertInstance({
      ...explicit,
      earliestBackfillDate: '2026-04-20',
      config: { keep: true },
    })
    expect(earlier.earliestBackfillDate).toBe('2026-04-20')

    const later = await repository.upsertInstance({
      ...earlier,
      earliestBackfillDate: '2026-07-01',
      auth: [{ id: 'fixture', mode: 'none' }],
    })
    expect(later.earliestBackfillDate).toBe('2026-07-01')

    const reloaded = await repository.listInstances()
    expect(reloaded.find((item) => item.id === 'earliest-default')?.earliestBackfillDate)
      .toBe('2026-07-04')
    expect(reloaded.find((item) => item.id === 'earliest-explicit')?.earliestBackfillDate)
      .toBe('2026-07-01')

    const preserved = await repository.upsertInstance({
      id: 'earliest-explicit',
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: 'Renamed',
      enabled: false,
      config: { keep: true, extra: 1 },
      auth: [{ id: 'fixture', mode: 'none' }],
      createdAt: '2026-07-11T15:30:00.000Z',
    })
    expect(preserved).toMatchObject({
      displayName: 'Renamed',
      enabled: false,
      earliestBackfillDate: '2026-07-01',
      config: { keep: true, extra: 1 },
    })
  })

  it('fails closed when a persisted earliest backfill date is missing or invalid', async () => {
    const { client, repository } = await createConnectorRepositoryTestContext()
    await client.exec("insert into source_execution_scopes (id, created_at, updated_at) values ('scope-broken-earliest', '2026-07-11T15:30:00.000Z', '2026-07-11T15:30:00.000Z')")
    await client.exec(`
      insert into connector_instances (
        id, execution_scope_id, connector_id, connector_version, display_name, enabled,
        config_json, auth_json, filters_json, earliest_backfill_date,
        created_at, updated_at, deleted_at
      ) values (
        'broken-earliest', 'scope-broken-earliest', 'fixture.jobs', '1.0.0', 'Broken', true,
        '{}', '[]', '{}', null,
        '2026-07-11T15:30:00.000Z', '2026-07-11T15:30:00.000Z', null
      )
    `)

    await expect(repository.getInstance('broken-earliest')).rejects.toThrow(/earliest backfill date/i)

    await client.exec(`
      update connector_instances
      set earliest_backfill_date = '2026-7-4'
      where id = 'broken-earliest'
    `)
    await expect(repository.listInstances()).rejects.toThrow(/earliest backfill date/i)
  })
})
