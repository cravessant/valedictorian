import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  createApplication,
  createListResult,
  createSettingsApi,
  createWorkspaceApi,
  createWorkspaceSummary,
  openSettingsPage,
} from '../App.test-helpers'
import { clearDestructiveToastDedupe } from '@/components/ui/use-toast'

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

async function openDataSettings(workspaceApi = createWorkspaceApi()) {
  render(
    <App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      settingsApi={createSettingsApi()}
      workspaceApi={workspaceApi}
    />,
  )
  await openSettingsPage()
  fireEvent.click(screen.getByRole('button', { name: 'Data' }))
  expect(await screen.findByRole('heading', { name: 'Data' })).toBeInTheDocument()
  return workspaceApi
}

function latestErrorAction(): { label?: string; onClick?: () => void } | undefined {
  const options = sonnerToast.error.mock.calls.at(-1)?.[1] as
    | { action?: { label?: string; onClick?: () => void } }
    | undefined
  return options?.action
}

describe('Data settings workspace action ownership', () => {
  it('owns choose-workspace rejection with sanitized toast, retry, and no unhandled rejection', async () => {
    const canary = 'choose dump /Users/secret/workspace'
    const workspaceApi = createWorkspaceApi()
    vi.mocked(workspaceApi.chooseFolder)
      .mockRejectedValueOnce(new Error(canary))
      .mockResolvedValueOnce(createWorkspaceSummary({
        id: 'workspace-retry',
        name: 'Retry Workspace',
        rootPath: '/Users/keni/Job Search Retry',
      }))

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      await openDataSettings(workspaceApi)
      fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }))

      await waitFor(() => {
        expect(sonnerToast.error).toHaveBeenCalledTimes(1)
      })
      expect(sonnerToast.error).toHaveBeenCalledWith(
        'Action failed',
        expect.objectContaining({
          description: expect.stringMatching(/workspace|could not|failed/i),
          action: expect.objectContaining({ label: 'Retry' }),
        }),
      )
      expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/Users/secret')
      expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain(canary)
      expect(unhandled).toHaveLength(0)

      latestErrorAction()?.onClick?.()
      await waitFor(() => {
        expect(workspaceApi.chooseFolder).toHaveBeenCalledTimes(2)
      })
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('does not toast a stale workspace-folder failure after unmount', async () => {
    let rejectChoose!: (reason?: unknown) => void
    const pending = new Promise<never>((_resolve, reject) => {
      rejectChoose = reject
    })
    const workspaceApi = createWorkspaceApi()
    vi.mocked(workspaceApi.chooseFolder).mockReturnValueOnce(pending)

    const { unmount } = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        workspaceApi={workspaceApi}
      />,
    )
    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(await screen.findByRole('heading', { name: 'Data' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }))
    await waitFor(() => expect(workspaceApi.chooseFolder).toHaveBeenCalledTimes(1))

    unmount()
    await act(async () => {
      rejectChoose(new Error('stale choose dump /secret'))
      await pending.catch(() => undefined)
    })
    expect(sonnerToast.error).not.toHaveBeenCalled()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('routes a captured Choose workspace Retry through the current workspaceApi after replacement', async () => {
    const oldApi = createWorkspaceApi()
    const newApi = createWorkspaceApi(createWorkspaceSummary({
      id: 'workspace-new',
      name: 'New Workspace',
      rootPath: '/Users/keni/Job Search New',
    }))
    vi.mocked(oldApi.chooseFolder).mockRejectedValueOnce(
      new Error('old choose dump /Users/secret/old'),
    )
    vi.mocked(newApi.chooseFolder).mockResolvedValueOnce(createWorkspaceSummary({
      id: 'workspace-retry-current',
      name: 'Current Retry Workspace',
      rootPath: '/Users/keni/Job Search Current',
    }))

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      const { rerender } = render(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          settingsApi={createSettingsApi()}
          workspaceApi={oldApi}
        />,
      )
      await openSettingsPage()
      fireEvent.click(screen.getByRole('button', { name: 'Data' }))
      expect(await screen.findByRole('heading', { name: 'Data' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }))
      await waitFor(() => expect(sonnerToast.error).toHaveBeenCalledTimes(1))
      const retry = latestErrorAction()?.onClick
      expect(retry).toEqual(expect.any(Function))

      rerender(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          settingsApi={createSettingsApi()}
          workspaceApi={newApi}
        />,
      )
      await waitFor(() => {
        expect(screen.getByDisplayValue('/Users/keni/Job Search New')).toBeInTheDocument()
      })

      await act(async () => {
        retry?.()
      })
      await waitFor(() => {
        expect(newApi.chooseFolder).toHaveBeenCalledTimes(1)
      })
      expect(oldApi.chooseFolder).toHaveBeenCalledTimes(1)
      expect(unhandled).toHaveLength(0)
      expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/Users/secret/old')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('does not invoke any workspaceApi from a captured Retry after unmount', async () => {
    const workspaceApi = createWorkspaceApi()
    vi.mocked(workspaceApi.chooseFolder).mockRejectedValueOnce(
      new Error('unmount retry dump /secret'),
    )

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      const { unmount } = render(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          settingsApi={createSettingsApi()}
          workspaceApi={workspaceApi}
        />,
      )
      await openSettingsPage()
      fireEvent.click(screen.getByRole('button', { name: 'Data' }))
      expect(await screen.findByRole('heading', { name: 'Data' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }))
      await waitFor(() => expect(sonnerToast.error).toHaveBeenCalledTimes(1))
      const retry = latestErrorAction()?.onClick
      expect(retry).toEqual(expect.any(Function))

      unmount()
      await act(async () => {
        retry?.()
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(workspaceApi.chooseFolder).toHaveBeenCalledTimes(1)
      expect(unhandled).toHaveLength(0)
      expect(sonnerToast.error).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('owns reveal-workspace rejection with sanitized toast, retry, and no unhandled rejection', async () => {
    const canary = 'reveal dump /var/folders/secret'
    const workspaceApi = createWorkspaceApi()
    vi.mocked(workspaceApi.revealCurrent)
      .mockRejectedValueOnce(new Error(canary))
      .mockResolvedValueOnce(undefined)

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      await openDataSettings(workspaceApi)
      fireEvent.click(screen.getByRole('button', { name: 'Reveal workspace' }))

      await waitFor(() => {
        expect(sonnerToast.error).toHaveBeenCalledTimes(1)
      })
      expect(sonnerToast.error).toHaveBeenCalledWith(
        'Action failed',
        expect.objectContaining({
          description: expect.stringMatching(/workspace|could not|failed|reveal/i),
          action: expect.objectContaining({ label: 'Retry' }),
        }),
      )
      expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain('/var/folders')
      expect(JSON.stringify(sonnerToast.error.mock.calls)).not.toContain(canary)
      expect(unhandled).toHaveLength(0)

      latestErrorAction()?.onClick?.()
      await waitFor(() => {
        expect(workspaceApi.revealCurrent).toHaveBeenCalledTimes(2)
      })
      expect(unhandled).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
