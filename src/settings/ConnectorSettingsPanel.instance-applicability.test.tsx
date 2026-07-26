import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectorsApi,
  createProfileApi,
  lastCreatedConnectorInstanceId,
} from '../App.test-helpers'
import { JOBRIGHT_CONNECTOR_VERSION } from '../modules/connectors/jobright.constants'
import { unavailableScheduleApi } from './connector-schedule.test-helpers'
import type { ConnectorSettingsUiApi } from './connector-settings.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'
import { openConnectorEditor } from './ConnectorSettingsPanel.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function renderPanel(
  connectorsApi: ConnectorSettingsUiApi,
  profileApi = createProfileApi(),
) {
  return render(
    <ConnectorSettingsPanel
      connectorsApi={connectorsApi}
      connectorScheduleApi={unavailableScheduleApi()}
      onRunSettled={vi.fn()}
      profileApi={profileApi}
      workspaceId="workspace-1"
    />,
  )
}

const fixtureInstance = {
  id: 'fixture-default',
  connectorId: 'fixture.jobs',
  connectorVersion: '0.0.0-fixture',
  displayName: 'Fixture jobs',
  enabled: true,
  auth: [{
    id: 'fixture-api',
    mode: 'api_key' as const,
    label: 'Fixture API key',
    configured: true,
  }],
  config: {},
  filters: {},
  earliestBackfillDate: '2026-07-02',
  createdAt: '2026-07-09T15:00:00.000Z',
  updatedAt: '2026-07-09T15:00:00.000Z',
}

describe('ConnectorSettingsPanel instance applicability', () => {
  it('adds a Jobright connector instance with released auth and default US filter', async () => {
    const connectorsApi = createConnectorsApi()

    renderPanel(connectorsApi)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
    await openConnectorEditor('Jobright internslist')

    await waitFor(() => {
      expect(connectorsApi.create).toHaveBeenCalledWith(expect.objectContaining({
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
          },
        ],
        config: {},
        connectorId: 'jobright.resolver',
        connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
        displayName: 'Jobright internslist',
        enabled: false,
        filters: { country: 'US' },
      }))
    })
    const createdId = lastCreatedConnectorInstanceId(connectorsApi)
    expect(createdId).not.toBe('jobright-default')
    expect(createdId.length).toBeGreaterThan(0)
    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add credentials' })).toBeInTheDocument()
    expect(screen.getByText('1 connector instance configured.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(screen.queryByText('Credentials stored')).not.toBeInTheDocument()
    expect(screen.queryByText(/login window/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Login to Jobright' })).not.toBeInTheDocument()
    expect(screen.queryByText('Auth verified')).not.toBeInTheDocument()
  })

  it('does not auto-validate non-Jobright configured connectors on settings load', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [fixtureInstance],
    })

    renderPanel(connectorsApi)

    expect(await screen.findByText('Fixture jobs')).toBeInTheDocument()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()
    expect(screen.queryByText('Checking auth...')).not.toBeInTheDocument()
  })

  it('keeps Jobright target and advanced settings off non-Jobright connector cards', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [fixtureInstance],
    })

    renderPanel(connectorsApi)

    const fixtureCard = await openConnectorEditor('Fixture jobs')
    expect(within(fixtureCard).getByRole('heading', { name: 'Fixture jobs details' }))
      .toBeInTheDocument()
    expect(fixtureCard).toHaveTextContent('fixture.jobs')
    expect(within(fixtureCard).queryByLabelText('Useful results target')).not.toBeInTheDocument()
    expect(within(fixtureCard).queryByText('Advanced connector limits')).not.toBeInTheDocument()
    expect(within(fixtureCard).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(within(fixtureCard).queryByRole('button', { name: 'Run Jobright now' }))
      .not.toBeInTheDocument()
    fireEvent.click(within(fixtureCard).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Add Jobright connector' })).toBeInTheDocument()
  })

  it('treats legacy Jobright api_key auth as unconfigured API credentials', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    await connectorsApi.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.3.0',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'api_key',
        label: 'Jobright API key',
        secretKey: 'legacy-jobright-session',
      }],
      config: {},
      filters: {},
    })
    vi.mocked(connectorsApi.create).mockClear()
    vi.mocked(connectorsApi.update).mockClear()
    vi.mocked(connectorsApi.status.reconnect).mockClear()

    renderPanel(connectorsApi, profileApi)

    await openConnectorEditor('Jobright public jobs')

    expect(await screen.findByText('jobright.resolver')).toBeInTheDocument()
    expect(screen.getByText('Auth required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add credentials' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(connectorsApi.status.reconnect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add credentials' }))
    fireEvent.change(await screen.findByLabelText('Jobright email'), {
      target: { value: 'demo@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Jobright password'), {
      target: { value: ' pass with spaces ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenCalled()
      expect(connectorsApi.update).toHaveBeenCalledWith({
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
            secretKey: 'connector_jobright_credentials_jobright_default',
          },
        ],
        connectorInstanceId: 'jobright-default',
      })
      expect(connectorsApi.status.reconnect).toHaveBeenCalledWith({
        connectorInstanceId: 'jobright-default',
      })
    })
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()
  })
})
