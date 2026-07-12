import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createSettingsApi,
  openSettingsPage
} from './App.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

describe('Jobright Google-only unsupported explanation', () => {
  it('explains password-only auth before credential editing and does not offer Google sign-in', async () => {
    const connectorsApi = createConnectorsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))

    const card = await screen.findByTestId('connector-instance-card-jobright-default')
    expect(within(card).getByText(/Jobright password is required/i)).toBeInTheDocument()
    expect(within(card).getByText(/Gmail address is only the username/i)).toBeInTheDocument()
    expect(within(card).getByText(/does not initiate Google OAuth/i)).toBeInTheDocument()
    expect(within(card).getByText(
      /Google-only Jobright accounts are currently unsupported until Jobright provides a supported desktop handoff/i,
    )).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Add credentials' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Google sign-?in|Sign in with Google|OAuth/i }))
      .not.toBeInTheDocument()
    expect(within(card).queryByLabelText('Jobright email')).not.toBeInTheDocument()
  })
})
