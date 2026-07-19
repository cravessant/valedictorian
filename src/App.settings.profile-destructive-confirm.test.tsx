import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createListResult,
  createProfileApi,
  createSettingsApi,
  openSettingsPage,
  stubCmdkEnvironment,
} from './App.test-helpers'

beforeEach(() => {
  stubCmdkEnvironment()
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

async function seedRemovableProfile(profileApi: ReturnType<typeof createProfileApi>) {
  await profileApi.update({
    answers: [
      {
        answer: 'LinkedIn',
        category: null,
        includeInAgentContext: true,
        key: 'referral_source',
        label: 'Referral source',
        questionPattern: 'How did you hear about us?',
      },
    ],
    education: [
      {
        classStanding: null,
        degree: null,
        educationType: 'College',
        graduationDate: null,
        id: 'university_of_colorado_boulder',
        major: 'Computer Science',
        notes: null,
        satScore: null,
        school: 'University of Colorado Boulder',
        transcriptPath: null,
      },
    ],
  })
  await profileApi.secrets.upsert({
    key: 'greenhouse_password',
    kind: 'password',
    label: 'Greenhouse password',
    value: 'correct horse battery staple',
  })
}

describe('profile destructive confirmations', () => {
  it('removes education only after alert confirmation', async () => {
    const profileApi = createProfileApi()
    await seedRemovableProfile(profileApi)
    const updateCallsBeforeOpen = vi.mocked(profileApi.update).mock.calls.length

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByText('University of Colorado Boulder')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove education University of Colorado Boulder' }),
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove education University of Colorado Boulder?',
    })
    expect(vi.mocked(profileApi.update).mock.calls.length).toBe(updateCallsBeforeOpen)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', {
          name: 'Remove education University of Colorado Boulder?',
        }),
      ).not.toBeInTheDocument()
    })
    expect(vi.mocked(profileApi.update).mock.calls.length).toBe(updateCallsBeforeOpen)
    expect(screen.getByText('University of Colorado Boulder')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove education University of Colorado Boulder' }),
    )
    const confirmDialog = await screen.findByRole('alertdialog', {
      name: 'Remove education University of Colorado Boulder?',
    })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Remove education' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledTimes(updateCallsBeforeOpen + 1)
    })
    expect(vi.mocked(profileApi.update).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        education: [],
      }),
    )
    expect(await screen.findByText('Education removed.')).toBeInTheDocument()
    expect(screen.queryByText('University of Colorado Boulder')).not.toBeInTheDocument()
  })

  it('removes answers and secure values only after alert confirmation', async () => {
    const profileApi = createProfileApi()
    await seedRemovableProfile(profileApi)
    const updateCallsBeforeOpen = vi.mocked(profileApi.update).mock.calls.length
    const deleteCallsBeforeOpen = vi.mocked(profileApi.secrets.delete).mock.calls.length

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByText('Referral source')).toBeInTheDocument()
    expect(screen.getByText('Greenhouse password')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove answer Referral source' }))
    const answerDialog = await screen.findByRole('alertdialog', {
      name: 'Remove answer Referral source?',
    })
    expect(vi.mocked(profileApi.update).mock.calls.length).toBe(updateCallsBeforeOpen)
    fireEvent.click(within(answerDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Remove answer Referral source?' }),
      ).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove answer Referral source' }))
    fireEvent.click(
      within(
        await screen.findByRole('alertdialog', { name: 'Remove answer Referral source?' }),
      ).getByRole('button', { name: 'Remove answer' }),
    )
    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledTimes(updateCallsBeforeOpen + 1)
    })
    expect(vi.mocked(profileApi.update).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        answers: [],
      }),
    )
    expect(await screen.findByText('Answer removed.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove secure value Greenhouse password' }))
    const secretDialog = await screen.findByRole('alertdialog', {
      name: 'Remove secure value Greenhouse password?',
    })
    expect(vi.mocked(profileApi.secrets.delete).mock.calls.length).toBe(deleteCallsBeforeOpen)
    fireEvent.click(within(secretDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', {
          name: 'Remove secure value Greenhouse password?',
        }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText('Greenhouse password')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove secure value Greenhouse password' }))
    fireEvent.click(
      within(
        await screen.findByRole('alertdialog', {
          name: 'Remove secure value Greenhouse password?',
        }),
      ).getByRole('button', { name: 'Remove secure value' }),
    )
    await waitFor(() => {
      expect(profileApi.secrets.delete).toHaveBeenCalledWith('greenhouse_password')
    })
    expect(await screen.findByText('Secure value removed.')).toBeInTheDocument()
    expect(screen.queryByText('Greenhouse password')).not.toBeInTheDocument()
  })

  it('disables profile removal confirm while pending and keeps the alert open on error', async () => {
    const profileApi = createProfileApi()
    await seedRemovableProfile(profileApi)
    let rejectDelete: ((reason?: unknown) => void) | undefined
    profileApi.secrets.delete = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectDelete = reject
        }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByText('Greenhouse password')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove secure value Greenhouse password' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove secure value Greenhouse password?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove secure value' }))

    await waitFor(() => {
      expect(profileApi.secrets.delete).toHaveBeenCalledTimes(1)
    })
    expect(within(dialog).getByRole('button', { name: 'Removing...' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    rejectDelete?.(new Error('Vault locked.'))

    expect(await within(dialog).findByText(/Could not remove secure value/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove secure value' })).toBeEnabled()
    expect(
      screen.getByRole('alertdialog', { name: 'Remove secure value Greenhouse password?' }),
    ).toBeInTheDocument()
  })

  it('keeps education removal dialog retryable and preserves the item after a failed update', async () => {
    const profileApi = createProfileApi()
    await seedRemovableProfile(profileApi)
    const updateCallsBeforeOpen = vi.mocked(profileApi.update).mock.calls.length
    vi.mocked(profileApi.update)
      .mockRejectedValueOnce(new Error('education remove dump /secret/vault'))
      .mockImplementation(async (patch) => {
        const current = await profileApi.get()
        return {
          ...current,
          ...patch,
          answers: patch.answers ?? current.answers,
          education: patch.education ?? current.education,
        }
      })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByText('University of Colorado Boulder')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove education University of Colorado Boulder' }),
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove education University of Colorado Boulder?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove education' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledTimes(updateCallsBeforeOpen + 1)
    })
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).toHaveTextContent(/Could not remove education/)
    expect(alert).not.toHaveTextContent('/secret')
    expect(document.activeElement).toBe(alert)
    expect(screen.queryByText(/education remove dump/i)).not.toBeInTheDocument()
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-slot="form-failure"]')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Remove education' })).toBeEnabled()
    expect(screen.getByText('University of Colorado Boulder')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', {
          name: 'Remove education University of Colorado Boulder?',
        }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText('University of Colorado Boulder')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove education University of Colorado Boulder' }),
    )
    const retryDialog = await screen.findByRole('alertdialog', {
      name: 'Remove education University of Colorado Boulder?',
    })
    fireEvent.click(within(retryDialog).getByRole('button', { name: 'Remove education' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledTimes(updateCallsBeforeOpen + 2)
    })
    expect(vi.mocked(profileApi.update).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        education: [],
      }),
    )
    expect(await screen.findByText('Education removed.')).toBeInTheDocument()
    expect(screen.queryByText('University of Colorado Boulder')).not.toBeInTheDocument()
  })

  it('keeps reusable-answer removal dialog retryable and preserves the item after a failed update', async () => {
    const profileApi = createProfileApi()
    await seedRemovableProfile(profileApi)
    const updateCallsBeforeOpen = vi.mocked(profileApi.update).mock.calls.length
    vi.mocked(profileApi.update)
      .mockRejectedValueOnce(new Error('answer remove dump /secret/vault'))
      .mockImplementation(async (patch) => {
        const current = await profileApi.get()
        return {
          ...current,
          ...patch,
          answers: patch.answers ?? current.answers,
          education: patch.education ?? current.education,
        }
      })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByText('Referral source')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove answer Referral source' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove answer Referral source?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove answer' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledTimes(updateCallsBeforeOpen + 1)
    })
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).toHaveTextContent(/Could not remove answer/)
    expect(alert).not.toHaveTextContent('/secret')
    expect(document.activeElement).toBe(alert)
    expect(screen.queryByText(/answer remove dump/i)).not.toBeInTheDocument()
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-slot="form-failure"]')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Remove answer' })).toBeEnabled()
    expect(screen.getByText('Referral source')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Remove answer Referral source?' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText('Referral source')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove answer Referral source' }))
    fireEvent.click(
      within(
        await screen.findByRole('alertdialog', { name: 'Remove answer Referral source?' }),
      ).getByRole('button', { name: 'Remove answer' }),
    )

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledTimes(updateCallsBeforeOpen + 2)
    })
    expect(vi.mocked(profileApi.update).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        answers: [],
      }),
    )
    expect(await screen.findByText('Answer removed.')).toBeInTheDocument()
    expect(screen.queryByText('Referral source')).not.toBeInTheDocument()
  })
})
