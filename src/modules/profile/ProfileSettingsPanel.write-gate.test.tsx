import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultUserProfile, ValedictorianHttpError } from 'sparxie'
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

function deferredUpdate() {
  let resolve!: (value: typeof defaultUserProfile) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<typeof defaultUserProfile>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ProfileSettingsPanel global write gate', () => {
  it('blocks a second profile write while the first is pending', async () => {
    const pending = deferredUpdate()
    const profileApi = createProfileApi()
    vi.mocked(profileApi.get).mockResolvedValue({
      ...defaultUserProfile,
      fullName: 'Ada',
    })
    vi.mocked(profileApi.identity.status).mockResolvedValue(true)
    vi.mocked(profileApi.secrets.list).mockResolvedValue([])
    vi.mocked(profileApi.update).mockReturnValueOnce(pending.promise)

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile basics' }))

    await waitFor(() => expect(profileApi.update).toHaveBeenCalledTimes(1))
    const savingButtons = screen.getAllByRole('button', { name: 'Saving...' })
    expect(savingButtons.length).toBeGreaterThanOrEqual(1)
    for (const button of savingButtons) {
      expect(button).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'Save date of birth' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save voluntary self-ID' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Save date of birth' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save voluntary self-ID' }))
    expect(profileApi.update).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve({
        ...defaultUserProfile,
        fullName: 'Ada Lovelace',
      })
      await pending.promise
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save profile basics' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: 'Save date of birth' })).toBeEnabled()
  })

  it('keeps the first modal failure owned and focused until that operation retries or cancels', async () => {
    const canary = /CANARY_EDU_OVERLAP \/secret\/edu/
    const profileApi = createProfileApi()
    vi.mocked(profileApi.get).mockResolvedValue(defaultUserProfile)
    vi.mocked(profileApi.identity.status).mockResolvedValue(true)
    vi.mocked(profileApi.secrets.list).mockResolvedValue([])
    vi.mocked(profileApi.update).mockRejectedValueOnce(new ValedictorianHttpError({
      body: null,
      kind: 'unavailable',
      message: 'CANARY_EDU_OVERLAP /secret/edu',
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
      target: { value: 'Draft U' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save education' }))

    const openDialog = await screen.findByRole('dialog', { name: 'Add education' })
    await waitFor(() => {
      const alerts = within(openDialog).getAllByRole('alert')
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveAttribute('data-slot', 'form-failure')
      expect(alerts[0]).not.toHaveTextContent(canary)
      expect(document.activeElement).toBe(alerts[0])
    })

    const backgroundProfileSave = screen.getByRole('button', {
      hidden: true,
      name: 'Save profile basics',
    })
    const backgroundDobSave = screen.getByRole('button', {
      hidden: true,
      name: 'Save date of birth',
    })
    expect(backgroundProfileSave).toBeDisabled()
    expect(backgroundDobSave).toBeDisabled()
    fireEvent.click(backgroundProfileSave)
    expect(profileApi.update).toHaveBeenCalledTimes(1)
    expect(sonnerToast.success).not.toHaveBeenCalled()
    expect(sonnerToast.error).not.toHaveBeenCalled()

    const ownedAlert = within(openDialog).getByRole('alert')
    expect(ownedAlert).toHaveAttribute('data-slot', 'form-failure')
    expect(document.activeElement).toBe(ownedAlert)

    fireEvent.click(within(openDialog).getByRole('button', { name: 'Cancel education' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add education' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Save profile basics' })).toBeEnabled()
  })

  it('clears owned removal error on cancel so unrelated profile writes can start', async () => {
    const education = {
      classStanding: null,
      degree: null,
      educationType: 'College',
      graduationDate: null,
      id: 'draft_u',
      major: 'CS',
      notes: null,
      satScore: null,
      school: 'Draft U',
      transcriptPath: null,
    }
    const profileApi = createProfileApi()
    vi.mocked(profileApi.get).mockResolvedValue({
      ...defaultUserProfile,
      education: [education],
      fullName: 'Ada',
    })
    vi.mocked(profileApi.identity.status).mockResolvedValue(true)
    vi.mocked(profileApi.secrets.list).mockResolvedValue([])
    vi.mocked(profileApi.update)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'CANARY_REMOVE_EDU /secret/edu',
        status: 503,
      }))
      .mockResolvedValue({
        ...defaultUserProfile,
        education: [education],
        fullName: 'Ada Lovelace',
      })

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByText('Draft U')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove education Draft U' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove education Draft U?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove education' }))

    const ownedAlert = await within(dialog).findByRole('alert')
    expect(ownedAlert).toHaveAttribute('data-slot', 'form-failure')
    expect(ownedAlert).toHaveTextContent(/Could not remove education/)
    expect(dialog).toBeInTheDocument()

    const gatedProfileSave = screen.getByRole('button', {
      hidden: true,
      name: 'Save profile basics',
    })
    expect(gatedProfileSave).toBeDisabled()
    fireEvent.click(gatedProfileSave)
    expect(profileApi.update).toHaveBeenCalledTimes(1)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Remove education Draft U?' }),
      ).not.toBeInTheDocument()
    })

    const profileSave = screen.getByRole('button', { name: 'Save profile basics' })
    expect(profileSave).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(profileSave)

    await waitFor(() => expect(profileApi.update).toHaveBeenCalledTimes(2))
    expect(vi.mocked(profileApi.update).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ fullName: 'Ada Lovelace' }),
    )
  })

  it('ignores a deferred profile save settlement after profileApi switches', async () => {
    const pending = deferredUpdate()
    const oldApi = createProfileApi()
    const newApi = createProfileApi()
    vi.mocked(oldApi.get).mockResolvedValue({
      ...defaultUserProfile,
      fullName: 'Old Target',
    })
    vi.mocked(newApi.get).mockResolvedValue({
      ...defaultUserProfile,
      fullName: 'New Target',
    })
    vi.mocked(oldApi.update).mockReturnValueOnce(pending.promise)

    const { rerender } = render(<ProfileSettingsPanel profileApi={oldApi} />)
    expect(await screen.findByDisplayValue('Old Target')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Stale Save' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile basics' }))
    await waitFor(() => expect(oldApi.update).toHaveBeenCalledTimes(1))

    rerender(<ProfileSettingsPanel profileApi={newApi} />)
    expect(await screen.findByDisplayValue('New Target')).toBeInTheDocument()

    await act(async () => {
      pending.resolve({
        ...defaultUserProfile,
        fullName: 'Stale Save Applied',
      })
      await pending.promise
    })

    expect(sonnerToast.success).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('New Target')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Stale Save Applied')).not.toBeInTheDocument()
  })
})
