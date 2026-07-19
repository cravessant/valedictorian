import { describe, expect, it } from 'vitest'
import { createConnectorsApi } from './App.test-helpers'
import { JOBRIGHT_CONNECTOR_ID, JOBRIGHT_CONNECTOR_VERSION } from './modules/connectors/jobright.constants'

describe('createConnectorsApi tombstone parity', () => {
  it('rejects recreating a removed connector-instance id instead of hard-deleting history', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create(jobrightInput('jobright-tombstone'))
    await connectorsApi.remove({ connectorInstanceId: 'jobright-tombstone' })
    await expect(connectorsApi.list()).resolves.toEqual({ items: [] })

    await expect(connectorsApi.create(jobrightInput('jobright-tombstone')))
      .rejects.toMatchObject({
        status: 409,
        body: {
          code: 'already_configured',
          message: 'This connector is already configured. Manage the existing instance.',
        },
      })
  })

  it('allows a fresh Jobright id after the active instance is retired', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create(jobrightInput('jobright-old'))
    await connectorsApi.remove({ connectorInstanceId: 'jobright-old' })
    const replacement = await connectorsApi.create(jobrightInput('jobright-new'))
    expect(replacement.id).toBe('jobright-new')
    await expect(connectorsApi.list()).resolves.toMatchObject({
      items: [{ id: 'jobright-new' }],
    })
  })
})

function jobrightInput(id: string) {
  return {
    id,
    connectorId: JOBRIGHT_CONNECTOR_ID,
    connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
    displayName: 'Jobright internslist',
    enabled: true,
    auth: [{ id: 'jobright', label: 'Jobright credentials', mode: 'username_password' as const }],
    config: {},
    filters: {},
  }
}
