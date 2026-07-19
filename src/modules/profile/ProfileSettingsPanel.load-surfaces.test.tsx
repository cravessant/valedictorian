import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ValedictorianHttpError,
  ValedictorianTransportError,
  defaultUserProfile,
  valedictorianFailureKindMessages,
} from 'sparxie'
import { ProfileSettingsPanel } from './ProfileSettingsPanel'
import { createProfileApi } from '../../App.test-helpers'

const sonnerToast = vi.hoisted(() => {
  const toastFn = vi.fn(() => 'toast-default')
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(() => 'toast-error'),
    success: vi.fn(() => 'toast-success'),
  })
})

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonnerToast,
}))

afterEach(cleanup)

beforeEach(() => {
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.success.mockClear()
  sonnerToast.dismiss.mockClear()
})

function expectSingleFocusedFormFailureInDialog(dialog: HTMLElement, canary: RegExp) {
  const alerts = within(dialog).getAllByRole('alert')
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toHaveAttribute('data-slot', 'form-failure')
  expect(alerts[0]).not.toHaveTextContent(canary)
  expect(document.activeElement).toBe(alerts[0])
  expect(document.querySelectorAll('[data-slot="form-failure"]')).toHaveLength(1)
  expect(sonnerToast.error).not.toHaveBeenCalled()
  expect(screen.queryByText(canary)).not.toBeInTheDocument()
}

describe('ProfileSettingsPanel load surface selection', () => {
  it('renders AuthenticationFailure with Retry for typed authentication load failures', async () => {
    const profileApi = createProfileApi()
    vi.mocked(profileApi.get)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'profile auth dump /secret',
        status: 401,
      }))
      .mockResolvedValueOnce({
        ...defaultUserProfile,
        fullName: 'Ada Lovelace',
      })
    vi.mocked(profileApi.identity.status).mockResolvedValue(true)
    vi.mocked(profileApi.secrets.list).mockResolvedValue([])

    render(<ProfileSettingsPanel profileApi={profileApi} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'authentication-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.authentication)
    expect(alert).not.toHaveTextContent('/secret')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByDisplayValue('Ada Lovelace')).toBeInTheDocument()
    await waitFor(() => expect(profileApi.get).toHaveBeenCalledTimes(2))
  })

  it('renders GlobalFailureAlert with Retry for typed transport unavailability', async () => {
    const profileApi = createProfileApi()
    vi.mocked(profileApi.get)
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/profile/secret'),
      }))
      .mockResolvedValueOnce({
        ...defaultUserProfile,
        fullName: 'Ada Lovelace',
      })
    vi.mocked(profileApi.identity.status).mockResolvedValue(true)
    vi.mocked(profileApi.secrets.list).mockResolvedValue([])

    render(<ProfileSettingsPanel profileApi={profileApi} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'global-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
    expect(alert).not.toHaveTextContent('ECONNREFUSED')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByDisplayValue('Ada Lovelace')).toBeInTheDocument()
    await waitFor(() => expect(profileApi.get).toHaveBeenCalledTimes(2))
  })
})

describe('ProfileSettingsPanel modal save FormFailureAlert ownership', () => {
  it('keeps education modal open with FormFailureAlert owner after rejected save', async () => {
    const canary = /CANARY_EDU_DUMP \/secret\/edu/
    const profileApi = createProfileApi()
    vi.mocked(profileApi.update)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'CANARY_EDU_DUMP /secret/edu',
        status: 503,
      }))
      .mockResolvedValueOnce({
        ...defaultUserProfile,
        education: [{
          classStanding: null,
          degree: 'BS',
          educationType: 'College',
          graduationDate: null,
          id: 'edu-1',
          major: null,
          notes: null,
          satScore: null,
          school: 'Draft U',
          transcriptPath: null,
        }],
      })

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByRole('heading', { name: 'Education' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add education' })
    fireEvent.change(within(dialog).getByLabelText('Education type'), {
      target: { value: 'College' },
    })
    fireEvent.change(within(dialog).getByLabelText('School name'), {
      target: { value: 'Draft U' },
    })
    fireEvent.change(within(dialog).getByLabelText('Degree'), {
      target: { value: 'BS' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save education' }))

    const openDialog = await screen.findByRole('dialog', { name: 'Add education' })
    expect(within(openDialog).getByLabelText('School name')).toHaveValue('Draft U')
    expect(within(openDialog).getByLabelText('Degree')).toHaveValue('BS')
    await waitFor(() => {
      expectSingleFocusedFormFailureInDialog(openDialog, canary)
    })

    fireEvent.click(within(openDialog).getByRole('button', { name: 'Save education' }))
    await waitFor(() => expect(profileApi.update).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add education' })).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Draft U')).toBeInTheDocument()
  })

  it('keeps answer modal open with FormFailureAlert owner after rejected save', async () => {
    const canary = /CANARY_ANSWER_DUMP \/secret\/answer/
    const profileApi = createProfileApi()
    vi.mocked(profileApi.update)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'CANARY_ANSWER_DUMP /secret/answer',
        status: 503,
      }))
      .mockResolvedValueOnce({
        ...defaultUserProfile,
        answers: [{
          answer: 'LinkedIn',
          category: null,
          includeInAgentContext: true,
          key: 'referral_source',
          label: 'Referral source',
          questionPattern: 'How did you hear?',
        }],
      })

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByRole('heading', { name: 'Reusable Application Answers' }))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add answer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add answer' })
    fireEvent.change(within(dialog).getByLabelText('Answer name'), {
      target: { value: 'Referral source' },
    })
    fireEvent.change(within(dialog).getByLabelText('Question hint'), {
      target: { value: 'How did you hear?' },
    })
    fireEvent.change(within(dialog).getByLabelText('Answer to use'), {
      target: { value: 'LinkedIn' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save answer' }))

    const openDialog = await screen.findByRole('dialog', { name: 'Add answer' })
    expect(within(openDialog).getByLabelText('Answer name')).toHaveValue('Referral source')
    expect(within(openDialog).getByLabelText('Answer to use')).toHaveValue('LinkedIn')
    await waitFor(() => {
      expectSingleFocusedFormFailureInDialog(openDialog, canary)
    })

    fireEvent.click(within(openDialog).getByRole('button', { name: 'Save answer' }))
    await waitFor(() => expect(profileApi.update).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add answer' })).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Referral source')).toBeInTheDocument()
  })

  it('keeps secure-value modal open with FormFailureAlert owner after rejected save', async () => {
    const canary = /CANARY_SECRET_DUMP \/secret\/vault/
    const profileApi = createProfileApi()
    vi.mocked(profileApi.secrets.upsert)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'CANARY_SECRET_DUMP /secret/vault',
        status: 503,
      }))
      .mockResolvedValueOnce({
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse password',
        updatedAt: '2026-06-06T12:00:00.000Z',
      })
    vi.mocked(profileApi.secrets.list).mockResolvedValue([
      {
        key: 'greenhouse_password',
        kind: 'password',
        label: 'Greenhouse password',
        updatedAt: '2026-06-06T12:00:00.000Z',
      },
    ])

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByRole('heading', { name: 'Secure Values' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add secure value' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add secure value' })
    fireEvent.change(within(dialog).getByLabelText('Secure value name'), {
      target: { value: 'Greenhouse password' },
    })
    fireEvent.change(within(dialog).getByLabelText('Secure value key'), {
      target: { value: 'greenhouse_password' },
    })
    fireEvent.change(within(dialog).getByLabelText('Secure value'), {
      target: { value: 'draft-secret-value' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save secure value' }))

    const openDialog = await screen.findByRole('dialog', { name: 'Add secure value' })
    expect(within(openDialog).getByLabelText('Secure value name')).toHaveValue('Greenhouse password')
    expect(within(openDialog).getByLabelText('Secure value')).toHaveValue('draft-secret-value')
    await waitFor(() => {
      expectSingleFocusedFormFailureInDialog(openDialog, canary)
    })

    fireEvent.click(within(openDialog).getByRole('button', { name: 'Save secure value' }))
    await waitFor(() => expect(profileApi.secrets.upsert).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add secure value' })).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Greenhouse password')).toBeInTheDocument()
  })

  it('clears education FormFailureAlert after cancel and does not restore it on reopen', async () => {
    const profileApi = createProfileApi()
    vi.mocked(profileApi.update).mockRejectedValueOnce(new ValedictorianHttpError({
      body: null,
      kind: 'unavailable',
      message: 'CANARY_EDU_STALE /secret/edu',
      status: 503,
    }))

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByRole('heading', { name: 'Education' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add education' })
    fireEvent.change(within(dialog).getByLabelText('Education type'), {
      target: { value: 'College' },
    })
    fireEvent.change(within(dialog).getByLabelText('School name'), {
      target: { value: 'Stale U' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save education' }))

    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog', { name: 'Add education' }))
          .getByRole('alert'),
      ).toHaveAttribute('data-slot', 'form-failure')
    })

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add education' }))
        .getByRole('button', { name: 'Cancel education' }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add education' })).not.toBeInTheDocument()
    })
    expect(document.querySelector('[data-slot="form-failure"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    const reopened = await screen.findByRole('dialog', { name: 'Add education' })
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="form-failure"]')).toBeNull()
  })
})
