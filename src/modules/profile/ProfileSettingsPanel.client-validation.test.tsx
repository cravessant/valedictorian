import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultUserProfile } from 'sparxie'
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

describe('ProfileSettingsPanel client validation ownership', () => {
  it('owns default-empty education Save without throwing or calling the profile API', async () => {
    const profileApi = createProfileApi()
    vi.mocked(profileApi.get).mockResolvedValue(defaultUserProfile)
    vi.mocked(profileApi.identity.status).mockResolvedValue(true)
    vi.mocked(profileApi.secrets.list).mockResolvedValue([])

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByRole('heading', { name: 'Education' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add education' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add education' })

    expect(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save education' }))
    }).not.toThrow()

    const openDialog = await screen.findByRole('dialog', { name: 'Add education' })
    await waitFor(() => {
      const failure = within(openDialog).getByRole('alert')
      expect(failure).toHaveAttribute('data-slot', 'form-failure')
      expect(document.activeElement).toBe(failure)
    })
    expect(profileApi.update).not.toHaveBeenCalled()
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add education' })).toBeInTheDocument()
  })

  it('owns default-empty answer Save without throwing or calling the profile API', async () => {
    const profileApi = createProfileApi()
    vi.mocked(profileApi.get).mockResolvedValue(defaultUserProfile)
    vi.mocked(profileApi.identity.status).mockResolvedValue(true)
    vi.mocked(profileApi.secrets.list).mockResolvedValue([])

    render(<ProfileSettingsPanel profileApi={profileApi} />)
    expect(await screen.findByRole('heading', { name: 'Reusable Application Answers' }))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add answer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add answer' })

    expect(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save answer' }))
    }).not.toThrow()

    const openDialog = await screen.findByRole('dialog', { name: 'Add answer' })
    await waitFor(() => {
      const failure = within(openDialog).getByRole('alert')
      expect(failure).toHaveAttribute('data-slot', 'form-failure')
      expect(document.activeElement).toBe(failure)
    })
    expect(profileApi.update).not.toHaveBeenCalled()
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add answer' })).toBeInTheDocument()
  })
})
