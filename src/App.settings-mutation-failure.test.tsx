import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import type { AppSettings } from './settings/app-settings'

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

  it('keeps API token FormFailureAlert when an unrelated ordinary edit starts before the token rejects', async () => {
    const settingsApi = createSettingsApi({
      apiTokenConfigured: false,
      localApiHost: '127.0.0.1',
    })
    let rejectToken!: (reason?: unknown) => void
    const tokenUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectToken = reject
    })
    vi.mocked(settingsApi.update)
      .mockImplementationOnce(() => tokenUpdate)
      .mockResolvedValueOnce({
        ...(await settingsApi.get()),
        localApiHost: '10.0.0.1',
      })

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
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('Local API host'), {
      target: { value: '10.0.0.1' },
    })
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.getByLabelText('Local API host')).toHaveValue('10.0.0.1')
    })

    rejectToken(new ValedictorianHttpError({
      body: null,
      kind: 'unavailable',
      message: 'token dump /secret',
      status: 503,
    }))

    const tokenError = await screen.findByTestId('api-token-error')
    const alert = within(tokenError).getByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'form-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(alert).not.toHaveTextContent('draft-token-value')
    expect(input).toHaveValue('draft-token-value')
    expect(screen.getByLabelText('Local API host')).toHaveValue('10.0.0.1')
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })

  it('ignores an older rejected settlement so it cannot overwrite a newer successful edit', async () => {
    const settingsApi = createSettingsApi({
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    })
    let current = await settingsApi.get()
    let rejectFirst!: (reason?: unknown) => void
    const firstUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectFirst = reject
    })

    vi.mocked(settingsApi.update)
      .mockImplementationOnce(() => firstUpdate)
      .mockImplementationOnce(async (patch) => {
        current = {
          ...current,
          ...patch,
          theme: patch.theme ?? current.theme,
        }
        return current
      })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))

    fireEvent.click(screen.getByRole('radio', { name: 'Catppuccin Latte' }))
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('radio', { name: 'Graphite' }))
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Graphite' })).toBeChecked()
    })

    rejectFirst(new Error('stale theme dump /secret'))

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Graphite' })).toBeChecked()
    })
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.queryByText('/secret')).not.toBeInTheDocument()
  })

  it('rolls new-target theme rejection back to baseline after an old-target settlement', async () => {
    const oldSettingsApi = createSettingsApi({
      showAdvancedFilters: false,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    })
    const newSettingsApi = createSettingsApi({
      showAdvancedFilters: false,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    })
    let resolveOld!: (value: AppSettings) => void
    let resolveFilters!: (value: AppSettings) => void
    let rejectNewTheme!: (reason?: unknown) => void
    const oldUpdate = new Promise<AppSettings>((resolve) => {
      resolveOld = resolve
    })
    const newThemeUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectNewTheme = reject
    })
    const filtersUpdate = new Promise<AppSettings>((resolve) => {
      resolveFilters = resolve
    })
    vi.mocked(oldSettingsApi.update).mockImplementationOnce(() => oldUpdate)
    vi.mocked(newSettingsApi.update)
      .mockImplementationOnce(() => newThemeUpdate)
      .mockImplementationOnce(() => filtersUpdate)

    const { rerender } = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={oldSettingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getByRole('radio', { name: 'Catppuccin Blur Mocha' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'Catppuccin Latte' }))
    await waitFor(() => expect(oldSettingsApi.update).toHaveBeenCalledTimes(1))

    rerender(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={newSettingsApi}
      />,
    )
    await waitFor(() => {
      expect(newSettingsApi.get).toHaveBeenCalled()
      expect(screen.getByRole('radio', { name: 'Catppuccin Blur Mocha' })).toBeChecked()
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Graphite' }))
    await waitFor(() => expect(newSettingsApi.update).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Graphite' })).toBeChecked()
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Show advanced filters' }))
    await waitFor(() => expect(newSettingsApi.update).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('radio', { name: 'Graphite' })).toBeChecked()

    resolveOld({
      ...(await oldSettingsApi.get()),
      theme: { presetId: 'catppuccin-latte', overrides: {} },
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    resolveFilters({
      ...(await newSettingsApi.get()),
      showAdvancedFilters: true,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByRole('switch', { name: 'Show advanced filters' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Graphite' })).toBeChecked()

    rejectNewTheme(new ValedictorianHttpError({
      body: null,
      kind: 'unavailable',
      message: 'replacement theme dump /secret',
      status: 503,
    }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

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
    expect(screen.getByRole('radio', { name: 'Graphite' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Show advanced filters' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('ignores deferred rejection after unmount and still owns one toast on the next mount', async () => {
    const firstSettingsApi = createSettingsApi({
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    })
    let rejectFirst!: (reason?: unknown) => void
    const firstUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectFirst = reject
    })
    vi.mocked(firstSettingsApi.update).mockImplementationOnce(() => firstUpdate)

    const firstRender = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={firstSettingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Catppuccin Latte' }))
    await waitFor(() => expect(firstSettingsApi.update).toHaveBeenCalledTimes(1))

    firstRender.unmount()

    rejectFirst(new ValedictorianHttpError({
      body: null,
      kind: 'unavailable',
      message: 'unmounted theme dump /secret',
      status: 503,
    }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/secret')

    const secondSettingsApi = createSettingsApi({
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    })
    vi.mocked(secondSettingsApi.update).mockRejectedValueOnce(
      new ValedictorianHttpError({
        body: null,
        kind: 'unavailable',
        message: 'remount theme dump /secret',
        status: 503,
      }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={secondSettingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getByRole('radio', { name: 'Catppuccin Blur Mocha' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Graphite' }))

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
