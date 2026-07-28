import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeProfileAnswerInput,
  normalizeProfileEducationInput,
  type UserProfile,
} from '@sparxie/sdk'
import { Toaster } from '../../components/ui/sonner'
import {
  createProfileApi,
  selectComboboxOption,
  stubCmdkEnvironment,
} from '../../App.test-helpers'
import { ProfileSettingsPanel } from './ProfileSettingsPanel'

beforeEach(() => {
  stubCmdkEnvironment()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Partial<Window>).settings
  delete (window as Partial<Window>).profile
  delete (window as Partial<Window>).workspace
  delete (window as Partial<Window>).valedictorianWindowChrome
})

function renderProfileSettings(profileApi: ReturnType<typeof createProfileApi>) {
  return render(
    <>
      <ProfileSettingsPanel profileApi={profileApi} />
      <Toaster />
    </>,
  )
}

describe('profile settings', () => {
  it('exposes a named loading status while profile data is pending', async () => {
    const profileApi = createProfileApi()
    profileApi.get = vi.fn(() => new Promise<UserProfile>(() => undefined))

    renderProfileSettings(profileApi)

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Profile loading' })).toBeInTheDocument()
  })

  it('renders and persists structured profile sections with compact reusable answers and secure values', async () => {
    const profileApi = createProfileApi()

    renderProfileSettings(profileApi)

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByText('Coming later')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Profile Basics' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Education' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Work Authorization' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cover letter path')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Private Identifiers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Voluntary Self-ID' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sensitive Details' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reusable Application Answers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Secure Values' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Availability' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Kenny Lin' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kenny@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555-0100' } })
    fireEvent.change(screen.getByLabelText('Phone device type'), { target: { value: 'Mobile' } })
    fireEvent.change(screen.getByLabelText('Address line 1'), {
      target: { value: '470 Mockingbird Lane' },
    })
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'English' } })
    expect(screen.getByRole('table', { name: 'Education' })).toHaveAttribute('data-slot', 'table')
    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    fireEvent.change(screen.getByLabelText('Education type'), {
      target: { value: 'College' },
    })
    fireEvent.change(screen.getByLabelText('School name'), {
      target: { value: 'University of Colorado Boulder' },
    })
    fireEvent.change(screen.getByLabelText('Degree'), { target: { value: 'BS Computer Science' } })
    fireEvent.change(screen.getByLabelText('Major'), { target: { value: 'Computer Science' } })
    fireEvent.change(screen.getByLabelText('Graduation date'), {
      target: { value: 'December 2027' },
    })
    fireEvent.change(screen.getByLabelText('Class standing'), { target: { value: 'Senior' } })
    fireEvent.change(screen.getByLabelText('Transcript path'), {
      target: { value: 'transcripts/Kenny_Lin_S26_Transcript.pdf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save education' }))
    expect(await screen.findByText('University of Colorado Boulder')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    fireEvent.change(screen.getByLabelText('Education type'), {
      target: { value: 'Other' },
    })
    expect(screen.getByLabelText('Other education type')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Other education type'), {
      target: { value: 'Research fellowship' },
    })
    fireEvent.change(screen.getByLabelText('School name'), {
      target: { value: 'Open Source Lab' },
    })
    fireEvent.change(screen.getByLabelText('Education notes'), {
      target: { value: 'Maintainer fellowship.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save education' }))
    expect(await screen.findByText('Research fellowship')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Work authorization'), {
      target: { value: 'Authorized to work in the US.' },
    })
    fireEvent.change(screen.getByLabelText('Require sponsorship'), { target: { value: 'No' } })
    fireEvent.change(screen.getByLabelText('Require future sponsorship'), { target: { value: 'No' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Willing to relocate Yes' }))
    fireEvent.change(screen.getByLabelText('Relocation notes'), {
      target: { value: 'Open to NYC, Denver, or Bay Area roles.' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Willing to travel No' }))
    fireEvent.change(screen.getByLabelText('Travel notes'), {
      target: { value: 'Prefer under 25%.' },
    })
    fireEvent.change(screen.getByLabelText('Birth month'), { target: { value: '03' } })
    fireEvent.change(screen.getByLabelText('Birth day'), { target: { value: '16' } })
    selectComboboxOption('Birth year', '2004')
    fireEvent.change(screen.getByLabelText('Last 4 SSN'), { target: { value: '5125' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save date of birth' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith({ dateOfBirth: '2004-03-16' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set or replace SSN last four' }))
    await waitFor(() => expect(profileApi.identity.set).toHaveBeenCalledTimes(1))
    expect(screen.getByText('SSN last four: Configured')).toBeInTheDocument()
    expect(screen.getByLabelText('Last 4 SSN')).toHaveValue('')

    expect(screen.getByRole('combobox', { name: 'Race/ethnicity' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Gender' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Disability status' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Veteran status' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Hispanic/Latino' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Race/ethnicity'), { target: { value: 'Asian' } })
    fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'Man' } })
    fireEvent.change(screen.getByLabelText('Disability status'), { target: { value: 'No' } })
    fireEvent.change(screen.getByLabelText('Veteran status'), {
      target: { value: 'Not a protected veteran' },
    })
    fireEvent.change(screen.getByLabelText('Hispanic/Latino'), { target: { value: 'No' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save voluntary self-ID' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith({
        disabilityStatus: 'No',
        gender: 'Man',
        hispanicLatino: 'No',
        raceEthnicity: 'Asian',
        veteranStatus: 'Not a protected veteran',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add answer' }))
    fireEvent.change(screen.getByLabelText('Answer name'), {
      target: { value: 'How I heard about the role' },
    })
    fireEvent.change(screen.getByLabelText('Question hint'), {
      target: { value: 'How did you hear about us?' },
    })
    fireEvent.change(screen.getByLabelText('Answer to use'), {
      target: { value: 'LinkedIn' },
    })
    fireEvent.click(screen.getByLabelText('Available to automation'))
    fireEvent.click(screen.getByRole('button', { name: 'Save answer' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answers: [
            {
              answer: 'LinkedIn',
              category: null,
              includeInAgentContext: true,
              key: 'how_i_heard_about_the_role',
              label: 'How I heard about the role',
              questionPattern: 'How did you hear about us?',
            },
          ],
          addressLine1: '470 Mockingbird Lane',
          dateOfBirth: '2004-03-16',
          disabilityStatus: 'No',
          education: [
            {
              classStanding: 'Senior',
              degree: 'BS Computer Science',
              educationType: 'College',
              graduationDate: 'December 2027',
              id: 'university_of_colorado_boulder',
              major: 'Computer Science',
              notes: null,
              satScore: null,
              school: 'University of Colorado Boulder',
              transcriptPath: 'transcripts/Kenny_Lin_S26_Transcript.pdf',
            },
            {
              classStanding: null,
              degree: null,
              educationType: 'Research fellowship',
              graduationDate: null,
              id: 'open_source_lab',
              major: null,
              notes: 'Maintainer fellowship.',
              satScore: null,
              school: 'Open Source Lab',
              transcriptPath: null,
            },
          ],
          email: 'kenny@example.com',
          fullName: 'Kenny Lin',
          gender: 'Man',
          hispanicLatino: 'No',
          language: 'English',
          phone: '555-0100',
          phoneDeviceType: 'Mobile',
          raceEthnicity: 'Asian',
          relocationNotes: 'Open to NYC, Denver, or Bay Area roles.',
          requireSponsorship: 'No',
          requireSponsorshipFuture: 'No',
          travelNotes: 'Prefer under 25%.',
          veteranStatus: 'Not a protected veteran',
          willingToRelocate: true,
          willingToTravel: false,
          workAuthorization: 'Authorized to work in the US.',
        }),
      )
    })
    expect(screen.getByRole('table', { name: 'Reusable Application Answers' }))
      .toHaveAttribute('data-slot', 'table')

    fireEvent.click(screen.getByRole('button', { name: 'Add secure value' }))
    fireEvent.change(screen.getByLabelText('Secure value name'), {
      target: { value: 'Greenhouse password' },
    })
    fireEvent.change(screen.getByLabelText('Secure value key'), {
      target: { value: 'greenhouse_password' },
    })
    fireEvent.change(screen.getByLabelText('Secure value'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save secure value' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenCalledWith({
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse password',
        value: 'correct horse battery staple',
      })
    })
    expect(screen.getByRole('table', { name: 'Secure Values' }))
      .toHaveAttribute('data-slot', 'table')
    expect(screen.getByText('Greenhouse password')).toBeInTheDocument()
    expect(screen.getByText('••••••••')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('correct horse battery staple')).not.toBeInTheDocument()
  })

  it('shows profile save progress, success, and errors', async () => {
    const profileApi = createProfileApi()

    renderProfileSettings(profileApi)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    let resolveUpdate: (value: Awaited<ReturnType<typeof profileApi.update>>) => void = () => undefined
    vi.mocked(profileApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
    )

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Kenny Lin' } })
    const profileBasics = screen.getByRole('region', { name: 'Profile Basics' })
    fireEvent.click(within(profileBasics).getByRole('button', { name: 'Save profile basics' }))

    expect(within(profileBasics).getByRole('button', { name: 'Saving...' })).toBeDisabled()

    resolveUpdate({
      ...await profileApi.get(),
      fullName: 'Kenny Lin',
    })

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()

    vi.mocked(profileApi.update).mockRejectedValueOnce(new Error('Disk is full'))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Kenny Error' } })
    fireEvent.click(within(profileBasics).getByRole('button', { name: 'Save profile basics' }))

    expect(within(profileBasics).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(await screen.findByText('Profile update failed')).toBeInTheDocument()
    expect(
      screen.getByText('Could not save profile. An unexpected error occurred.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Disk is full/)).not.toBeInTheDocument()
  })

  it('provides a visible save action for profile basics', async () => {
    const profileApi = createProfileApi()

    renderProfileSettings(profileApi)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    const profileBasics = screen.getByRole('region', { name: 'Profile Basics' })

    fireEvent.change(within(profileBasics).getByLabelText('Full name'), {
      target: { value: 'Kenny Lin' },
    })
    fireEvent.click(within(profileBasics).getByRole('button', { name: 'Save profile basics' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: 'Kenny Lin' }),
      )
    })
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
  })

  it('shows work authorization save feedback as a toast', async () => {
    const profileApi = createProfileApi()

    renderProfileSettings(profileApi)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    const workAuthorization = screen.getByRole('region', { name: 'Work Authorization' })
    let resolveUpdate: (value: Awaited<ReturnType<typeof profileApi.update>>) => void = () => undefined
    vi.mocked(profileApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
    )

    fireEvent.change(within(workAuthorization).getByLabelText('Work authorization'), {
      target: { value: 'Authorized to work in the US.' },
    })
    fireEvent.click(within(workAuthorization).getByRole('button', { name: 'Save work authorization' }))

    expect(within(workAuthorization).getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(within(workAuthorization).queryByRole('status')).not.toBeInTheDocument()

    resolveUpdate({
      ...await profileApi.get(),
      workAuthorization: 'Authorized to work in the US.',
    })

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
    expect(within(workAuthorization).getByRole('button', { name: 'Save work authorization' })).toBeEnabled()
  })

  it('lets users cancel profile add modals without saving drafts', async () => {
    const profileApi = createProfileApi()

    renderProfileSettings(profileApi)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    const educationDialog = await screen.findByRole('dialog', { name: 'Add education' })
    fireEvent.change(within(educationDialog).getByLabelText('School name'), {
      target: { value: 'Draft U' },
    })
    fireEvent.click(within(educationDialog).getByRole('button', { name: 'Cancel education' }))

    expect(screen.queryByLabelText('School name')).not.toBeInTheDocument()
    expect(screen.getByText('No education records yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add education' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add answer' }))
    const answerDialog = await screen.findByRole('dialog', { name: 'Add answer' })
    fireEvent.change(within(answerDialog).getByLabelText('Answer name'), {
      target: { value: 'Draft answer' },
    })
    fireEvent.click(within(answerDialog).getByRole('button', { name: 'Cancel answer' }))

    expect(screen.queryByLabelText('Answer name')).not.toBeInTheDocument()
    expect(screen.getByText('No reusable answers yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add answer' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add secure value' }))
    const secretDialog = await screen.findByRole('dialog', { name: 'Add secure value' })
    fireEvent.change(within(secretDialog).getByLabelText('Secure value name'), {
      target: { value: 'Draft secret' },
    })
    fireEvent.click(within(secretDialog).getByRole('button', { name: 'Cancel secure value' }))

    expect(screen.queryByLabelText('Secure value name')).not.toBeInTheDocument()
    expect(screen.getByText('No secure values yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add secure value' })).toBeInTheDocument()
    expect(profileApi.update).not.toHaveBeenCalled()
    expect(profileApi.secrets.upsert).not.toHaveBeenCalled()
  })

  it('lets users edit profile education, answers, and secure values from modals', async () => {
    const profileApi = createProfileApi()
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

    renderProfileSettings(profileApi)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit education University of Colorado Boulder' }))
    const educationDialog = await screen.findByRole('dialog', { name: 'Edit education' })
    fireEvent.change(within(educationDialog).getByLabelText('Major'), {
      target: { value: 'Computer Science and Applied Math' },
    })
    fireEvent.click(within(educationDialog).getByRole('button', { name: 'Save education' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          education: [
            expect.objectContaining({
              major: 'Computer Science and Applied Math',
              school: 'University of Colorado Boulder',
            }),
          ],
        }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit answer Referral source' }))
    const answerDialog = await screen.findByRole('dialog', { name: 'Edit answer' })
    fireEvent.change(within(answerDialog).getByLabelText('Answer to use'), {
      target: { value: 'Company careers page' },
    })
    fireEvent.click(within(answerDialog).getByRole('button', { name: 'Save answer' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answers: [
            expect.objectContaining({
              answer: 'Company careers page',
              label: 'Referral source',
            }),
          ],
        }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit secure value Greenhouse password' }))
    const secretDialog = await screen.findByRole('dialog', { name: 'Edit secure value' })
    fireEvent.change(within(secretDialog).getByLabelText('Secure value name'), {
      target: { value: 'Greenhouse login password' },
    })
    fireEvent.change(within(secretDialog).getByLabelText('Secure value'), {
      target: { value: 'new secure value' },
    })
    fireEvent.click(within(secretDialog).getByRole('button', { name: 'Save secure value' }))

    await waitFor(() => {
      expect(profileApi.secrets.upsert).toHaveBeenLastCalledWith({
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse login password',
        value: 'new secure value',
      })
    })
  })

  it('keeps work authorization controls in uniform settings rows', async () => {
    renderProfileSettings(createProfileApi())
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()

    const workAuthorization = screen.getByRole('region', { name: 'Work Authorization' })
    const rowContainer = workAuthorization.querySelector(':scope > div')
    expect(rowContainer).not.toBeNull()
    const rows = Array.from(rowContainer?.children ?? []).filter(
      (row) =>
        row.matches('[data-slot="field"]') ||
        row.querySelector('[role="radiogroup"]') !== null,
    )
    const expectedRowClasses = [
      'grid',
      'gap-2',
      'px-4',
      'py-3',
      'text-sm',
      'text-foreground',
      'md:grid-cols-[180px_1fr]',
      'md:items-center',
    ]

    expect(rows).toHaveLength(8)
    for (const row of rows) {
      expect(row).toHaveClass(...expectedRowClasses)
    }
    expect(workAuthorization.querySelector('fieldset')).not.toBeInTheDocument()
    expect(within(workAuthorization).getByRole('radiogroup', { name: 'Willing to relocate' })).toBeInTheDocument()
    expect(within(workAuthorization).getByRole('radiogroup', { name: 'Willing to travel' })).toBeInTheDocument()
  })

  it('persists cleared voluntary self-ID selections as null', async () => {
    const profileApi = createProfileApi()
    const initial = await profileApi.get()
    profileApi.get = vi.fn(async () => ({
      ...initial,
      disabilityStatus: 'No' as const,
      gender: 'Man' as const,
      hispanicLatino: 'No' as const,
      raceEthnicity: 'Asian' as const,
      veteranStatus: 'Not a protected veteran' as const,
    }))
    renderProfileSettings(profileApi)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    for (const label of [
      'Race/ethnicity',
      'Gender',
      'Disability status',
      'Veteran status',
      'Hispanic/Latino',
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save voluntary self-ID' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith({
        disabilityStatus: null,
        gender: null,
        hispanicLatino: null,
        raceEthnicity: null,
        veteranStatus: null,
      })
    })
  })

  it('sends explicit canonical clears from profile basics without erasing arrays', async () => {
    const profileApi = createProfileApi()
    const initial = await profileApi.get()
    const existingAnswer = {
      answer: 'Referral',
      category: null,
      includeInAgentContext: true,
      key: 'source',
      label: 'Source',
      questionPattern: 'How did you hear?',
    }
    profileApi.get = vi.fn(async () => ({
      ...initial,
      answers: [existingAnswer],
      fullName: 'Ada Example',
      gender: 'Woman' as const,
      preferredName: 'Ada',
      willingToRelocate: null,
      willingToTravel: null,
    }))
    renderProfileSettings(profileApi)
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Gender'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile basics' }))

    await waitFor(() => {
      expect(profileApi.update).toHaveBeenCalledWith(expect.objectContaining({
        answers: [existingAnswer],
        education: initial.education,
        fullName: null,
        gender: null,
        preferredName: null,
        willingToRelocate: null,
        willingToTravel: null,
      }))
    })
  })
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

    renderProfileSettings(profileApi)
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

    renderProfileSettings(profileApi)
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
        new Promise<void>((_, reject) => {
          rejectDelete = reject
        }),
    )

    renderProfileSettings(profileApi)
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
          answers: patch.answers?.map(normalizeProfileAnswerInput) ?? current.answers,
          education: patch.education?.map(normalizeProfileEducationInput) ?? current.education,
        }
      })

    renderProfileSettings(profileApi)
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
          answers: patch.answers?.map(normalizeProfileAnswerInput) ?? current.answers,
          education: patch.education?.map(normalizeProfileEducationInput) ?? current.education,
        }
      })

    renderProfileSettings(profileApi)
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
