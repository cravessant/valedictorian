import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ValedictorianHttpError,
  valedictorianFailureKindMessages,
} from 'sparxie'
import App from './App'
import {
  createApplication,
  createListResult,
  createSettingsApi,
  openSettingsPage,
} from './App.test-helpers'
import { clearDestructiveToastDedupe } from './components/ui/use-toast'

const sonnerToast = vi.hoisted(() => {
  let nextId = 0
  const toastFn = vi.fn(() => `toast-default-${nextId++}`)
  return Object.assign(toastFn, {
    dismiss: vi.fn(),
    error: vi.fn(() => `toast-error-${nextId++}`),
    success: vi.fn(() => `toast-success-${nextId++}`),
    resetIds() {
      nextId = 0
    },
  })
})

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: sonnerToast,
}))

afterEach(cleanup)

beforeEach(() => {
  clearDestructiveToastDedupe()
  sonnerToast.resetIds()
  sonnerToast.mockClear()
  sonnerToast.error.mockClear()
  sonnerToast.dismiss.mockClear()
  sonnerToast.success.mockClear()
})

describe('ordinary settings mutation failure ownership', () => {
  it('owns appearance theme rejection with one toast and restores the prior theme', async () => {
    const settingsApi = createSettingsApi({
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    })
    vi.mocked(settingsApi.update).mockRejectedValueOnce(
      new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'theme dump /secret',
        status: 503,
      }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getByRole('radio', { name: 'Catppuccin Blur Mocha' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'Catppuccin Latte' }))

    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    })
    expect(sonnerToast.error).toHaveBeenCalledWith(
      'Action failed',
      expect.objectContaining({
        description: valedictorianFailureKindMessages.unavailable,
      }),
    )
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Catppuccin Blur Mocha' })).toBeChecked()
    })
  })

  it('owns general advanced-filters rejection with one toast and restores the prior toggle', async () => {
    const settingsApi = createSettingsApi({ showAdvancedFilters: false })
    vi.mocked(settingsApi.update).mockRejectedValueOnce(
      new Error('filters dump /secret'),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    const toggle = screen.getByRole('switch', { name: 'Show advanced filters' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    })
    expect(sonnerToast.error.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        description: 'Settings could not be saved.',
      }),
    )
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    })
  })

  it('owns developer show-debug rejection with one toast and restores the prior toggle', async () => {
    const settingsApi = createSettingsApi({ showDebugData: false })
    vi.mocked(settingsApi.update).mockRejectedValueOnce(
      new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'debug dump /secret',
        status: 503,
      }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Developer settings' }))
    const toggle = screen.getByRole('switch', { name: 'Show debug data' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    })
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')
  })

  it('owns sidebar collapse rejection with one toast and restores the prior collapsed state', async () => {
    const settingsApi = createSettingsApi({ sidebarCollapsed: false })
    vi.mocked(settingsApi.update).mockRejectedValueOnce(
      new Error('sidebar dump /secret'),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    })
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    })
  })

  it('keeps API token FormFailureAlert ownership without a duplicate settings toast', async () => {
    const settingsApi = createSettingsApi({ apiTokenConfigured: false })
    vi.mocked(settingsApi.update).mockRejectedValueOnce(
      new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'token dump /secret',
        status: 503,
      }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Configuration' }))
    const input = screen.getByLabelText('API token')
    fireEvent.change(input, { target: { value: 'draft-token-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(input).toHaveValue('draft-token-value')
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })

  it('owns chrome runtime-mode rejection with one toast and restores the prior mode', async () => {
    const settingsApi = createSettingsApi({ runtimeMode: 'local-desktop' })
    vi.mocked(settingsApi.update).mockRejectedValueOnce(
      new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'runtime dump /secret',
        status: 503,
      }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Use remote backend' }))

    await waitFor(() => {
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    })
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')
    await waitFor(() => {
      expect(
        within(dialog).getByRole('switch', { name: 'Use remote backend' }),
      ).toHaveAttribute('aria-checked', 'false')
    })
  })
})
