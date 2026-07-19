import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import App from './App'
import {
  createActionQueueItem,
  createActionQueueResult,
  createApplication,
  createApplicationDetail,
  createListResult,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
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
  delete (window as Window & { actionQueue?: unknown }).actionQueue
})

describe('error presentation action owners', () => {
  it('keeps Opportunity rows visible and uses one destructive toast when promote fails', async () => {
    const promoteSourcingFinding = vi.fn(async () => {
      throw new Error('secret promote stack /tmp/db.sqlite')
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        promoteSourcingFinding={promoteSourcingFinding}
        settingsApi={createSettingsApi()}
        sourcingLoader={() =>
          Promise.resolve(createSourcingResult([createSourcingFinding()]))
        }
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    const table = await screen.findByRole('table', { name: 'Opportunities' })
    expect(within(table).getByText('Delta Labs')).toBeInTheDocument()

    fireEvent.click(within(table).getByRole('button', { name: 'Promote Delta Labs' }))

    await waitFor(() => {
      expect(promoteSourcingFinding).toHaveBeenCalledWith({ findingId: 'finding-1' })
    })

    expect(await screen.findByText('Opportunity could not be promoted.')).toBeInTheDocument()
    expect(screen.queryByText('secret promote stack /tmp/db.sqlite')).not.toBeInTheDocument()
    expect(screen.queryByText('Load failed')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Opportunities' })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Opportunities' })).getByText('Delta Labs'))
      .toBeInTheDocument()
  })

  it('keeps overlapping Opportunity promote pending ownership per finding', async () => {
    const findingA = createSourcingFinding({
      id: 'finding-a',
      companyName: 'Alpha Labs',
    })
    const findingB = createSourcingFinding({
      id: 'finding-b',
      companyName: 'Beta Labs',
    })
    const pendingA = deferred<ReturnType<typeof createSourcingFinding>>()
    const pendingB = deferred<ReturnType<typeof createSourcingFinding>>()
    const promoteSourcingFinding = vi.fn((input: { findingId: string }) => {
      if (input.findingId === 'finding-a') return pendingA.promise
      return pendingB.promise
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        promoteSourcingFinding={promoteSourcingFinding}
        settingsApi={createSettingsApi()}
        sourcingLoader={() => Promise.resolve(createSourcingResult([findingA, findingB]))}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    const table = await screen.findByRole('table', { name: 'Opportunities' })

    fireEvent.click(within(table).getByRole('button', { name: 'Promote Alpha Labs' }))
    await waitFor(() => expect(promoteSourcingFinding).toHaveBeenCalledWith({ findingId: 'finding-a' }))
    expect(within(table).getByRole('button', { name: 'Promote Alpha Labs' })).toBeDisabled()

    fireEvent.click(within(table).getByRole('button', { name: 'Promote Beta Labs' }))
    await waitFor(() => expect(promoteSourcingFinding).toHaveBeenCalledWith({ findingId: 'finding-b' }))
    expect(within(table).getByRole('button', { name: 'Promote Beta Labs' })).toBeDisabled()

    fireEvent.click(within(table).getByRole('button', { name: 'Promote Beta Labs' }))
    expect(promoteSourcingFinding).toHaveBeenCalledTimes(2)

    await act(async () => {
      pendingA.reject(new Error('alpha promote failed'))
      await pendingA.promise.catch(() => undefined)
    })
    await waitFor(() => {
      expect(within(table).getByRole('button', { name: 'Promote Alpha Labs' })).toBeEnabled()
    })
    expect(within(table).getByRole('button', { name: 'Promote Beta Labs' })).toBeDisabled()

    await act(async () => {
      pendingB.resolve(createSourcingFinding({
        id: 'finding-b',
        companyName: 'Beta Labs',
        mergeStatus: 'merged',
        mergedApplicationId: 'application-b',
      }))
      await pendingB.promise
    })
    await waitFor(() => {
      expect(within(table).queryByRole('button', { name: 'Promote Beta Labs' })).not.toBeInTheDocument()
    })
  })

  it('ignores a deferred promote success after promoteSourcingFinding is replaced', async () => {
    const finding = createSourcingFinding({
      id: 'finding-a',
      companyName: 'Alpha Labs',
    })
    const pending = deferred<ReturnType<typeof createSourcingFinding>>()
    const promoteA = vi.fn(() => pending.promise)
    const promoteB = vi.fn(async () => createSourcingFinding({
      id: 'finding-b-only',
      companyName: 'Beta Only',
      mergeStatus: 'merged',
      mergedApplicationId: 'application-b',
    }))
    const applicationLoader = vi.fn(async () => createListResult([createApplication()]))
    const settingsApi = createSettingsApi()

    const { rerender } = render(
      <App
        applicationLoader={applicationLoader}
        promoteSourcingFinding={promoteA}
        settingsApi={settingsApi}
        sourcingLoader={() => Promise.resolve(createSourcingResult([finding]))}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    const table = await screen.findByRole('table', { name: 'Opportunities' })
    fireEvent.click(within(table).getByRole('button', { name: 'Promote Alpha Labs' }))
    await waitFor(() => expect(promoteA).toHaveBeenCalledTimes(1))
    expect(within(table).getByRole('button', { name: 'Promote Alpha Labs' })).toBeDisabled()

    // Resolve as close to the replacement commit as Testing Library allows —
    // before waiting for the effect that clears pending button state — so a
    // render-time API-target handoff race would still apply stale settlement.
    await act(async () => {
      rerender(
        <App
          applicationLoader={applicationLoader}
          promoteSourcingFinding={promoteB}
          settingsApi={settingsApi}
          sourcingLoader={() => Promise.resolve(createSourcingResult([finding]))}
        />,
      )
      pending.resolve(createSourcingFinding({
        id: 'finding-a',
        companyName: 'Stale Alpha',
        mergeStatus: 'merged',
        mergedApplicationId: 'application-stale',
      }))
      await pending.promise
    })

    // Same guarded then-branch owns row patch + application/action-queue reload.
    expect(within(table).getByText('Alpha Labs')).toBeInTheDocument()
    expect(screen.queryByText('Stale Alpha')).not.toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Promote Alpha Labs' })).toBeInTheDocument()
    expect(promoteB).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(within(table).getByRole('button', { name: 'Promote Alpha Labs' })).toBeEnabled()
    })
  })

  it('does not toast a deferred promote rejection after unmount', async () => {
    const pending = deferred<never>()
    const promoteSourcingFinding = vi.fn(() => pending.promise)
    const { rerender } = render(
      withPersistentToaster(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          promoteSourcingFinding={promoteSourcingFinding}
          settingsApi={createSettingsApi()}
          sourcingLoader={() => Promise.resolve(createSourcingResult([
            createSourcingFinding({ id: 'finding-a', companyName: 'Alpha Labs' }),
          ]))}
        />,
      ),
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Promote Alpha Labs' }))
    await waitFor(() => expect(promoteSourcingFinding).toHaveBeenCalledTimes(1))

    // Keep a Toaster mounted while removing App so a leaked toast remains visible.
    rerender(withPersistentToaster(null))
    await act(async () => {
      pending.reject(new Error('stale promote dump /secret'))
      await pending.promise.catch(() => undefined)
    })
    expect(screen.queryByText('Opportunity could not be promoted.')).not.toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('keeps Action Queue rows visible and uses one destructive toast when detail lookup fails', async () => {
    const actionQueueLoader = vi.fn(async () =>
      createActionQueueResult([
        createActionQueueItem({
          applicationId: 'application-1',
          companyName: 'Delta Labs',
          roleTitle: 'Software Engineering Intern',
        }),
      ]),
    )
    const applicationDetailLoader = vi.fn(async () => {
      throw new Error('detail sql dump leaked')
    })

    render(
      <App
        actionQueueLoader={actionQueueLoader}
        applicationDetailLoader={applicationDetailLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    const table = await screen.findByRole('table', { name: 'Action Queue' })
    expect(within(table).getByText('Delta Labs')).toBeInTheDocument()

    fireEvent.click(within(table).getByRole('button', { name: 'Edit Delta Labs' }))

    await waitFor(() => {
      expect(applicationDetailLoader).toHaveBeenCalled()
    })

    expect(await screen.findByText('Application detail could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByText('detail sql dump leaked')).not.toBeInTheDocument()
    expect(screen.queryByText('Load failed')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Action Queue' })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Action Queue' })).getByText('Delta Labs'))
      .toBeInTheDocument()
  })

  it('ignores a late Action Queue detail A after B is requested', async () => {
    const itemA = createActionQueueItem({
      id: 'application-a',
      companyName: 'Alpha Co',
      roleTitle: 'Alpha Role',
    })
    const itemB = createActionQueueItem({
      id: 'application-b',
      companyName: 'Beta Co',
      roleTitle: 'Beta Role',
    })
    const pendingA = deferred<ReturnType<typeof createApplicationDetail>>()
    const pendingB = deferred<ReturnType<typeof createApplicationDetail>>()
    const applicationDetailLoader = vi.fn((applicationId: string) => {
      if (applicationId === 'application-a') return pendingA.promise
      return pendingB.promise
    })

    render(
      <App
        actionQueueLoader={vi.fn(async () => createActionQueueResult([itemA, itemB]))}
        applicationDetailLoader={applicationDetailLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    const table = await screen.findByRole('table', { name: 'Action Queue' })
    fireEvent.click(within(table).getByRole('button', { name: 'Edit Alpha Co' }))
    await waitFor(() => expect(applicationDetailLoader).toHaveBeenCalledWith('application-a'))
    fireEvent.click(within(table).getByRole('button', { name: 'Edit Beta Co' }))
    await waitFor(() => expect(applicationDetailLoader).toHaveBeenCalledWith('application-b'))

    await act(async () => {
      pendingB.resolve(createApplicationDetail({
        id: 'application-b',
        companyName: 'Beta Co',
        roleTitle: 'Beta Role',
      }))
      await pendingB.promise
    })
    expect(await screen.findByDisplayValue('Beta Co')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    await act(async () => {
      pendingA.resolve(createApplicationDetail({
        id: 'application-a',
        companyName: 'Alpha Co',
        roleTitle: 'Alpha Role',
      }))
      await pendingA.promise
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Alpha Co')).not.toBeInTheDocument()
  })

  it('ignores a deferred Action Queue detail settlement after applicationDetailLoader is replaced', async () => {
    const item = createActionQueueItem({
      id: 'application-a',
      companyName: 'Alpha Co',
      roleTitle: 'Alpha Role',
    })
    const pendingA = deferred<ReturnType<typeof createApplicationDetail>>()
    const loaderA = vi.fn(() => pendingA.promise)
    const loaderB = vi.fn(async () => createApplicationDetail({
      id: 'application-b-only',
      companyName: 'Beta Only',
      roleTitle: 'Beta Role',
    }))

    const { rerender } = render(
      <App
        actionQueueLoader={vi.fn(async () => createActionQueueResult([item]))}
        applicationDetailLoader={loaderA}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha Co' }))
    await waitFor(() => expect(loaderA).toHaveBeenCalledWith('application-a'))

    rerender(
      <App
        actionQueueLoader={vi.fn(async () => createActionQueueResult([item]))}
        applicationDetailLoader={loaderB}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await act(async () => {
      pendingA.resolve(createApplicationDetail({
        id: 'application-a',
        companyName: 'Stale Alpha',
        roleTitle: 'Stale Role',
      }))
      await pendingA.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Stale Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Application detail could not be found.')).not.toBeInTheDocument()
    expect(loaderB).not.toHaveBeenCalled()
  })

  it('does not toast a stale Action Queue detail failure after unmount', async () => {
    const pending = deferred<never>()
    const applicationDetailLoader = vi.fn(() => pending.promise)
    const { unmount } = render(
      <App
        actionQueueLoader={vi.fn(async () => createActionQueueResult([
          createActionQueueItem({ id: 'application-a', companyName: 'Alpha Co' }),
        ]))}
        applicationDetailLoader={applicationDetailLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha Co' }))
    await waitFor(() => expect(applicationDetailLoader).toHaveBeenCalled())

    unmount()
    await act(async () => {
      pending.reject(new Error('stale detail dump /secret'))
      await pending.promise.catch(() => undefined)
    })
    expect(screen.queryByText('Application detail could not be loaded.')).not.toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })
})

function withPersistentToaster(children: ReactNode) {
  return (
    <>
      <Toaster />
      {children}
    </>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
