import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createApplicationDetail,
  createAttemptResult,
  createEventsResult,
  createLinksResult,
} from '../App.test-helpers'
import type { ApplicationDetailSeed } from './types'
import { useApplicationDetailSubsectionLoads } from './use-application-detail-subsection-loads'

afterEach(cleanup)

const seedA: ApplicationDetailSeed = {
  id: 'application-a',
  companyName: 'Alpha Corp',
  primaryLink: null,
  roleTitle: 'Alpha Role',
  sourceName: 'LinkedIn',
  status: 'needs_user_info',
}

const seedB: ApplicationDetailSeed = {
  id: 'application-b',
  companyName: 'Beta Corp',
  primaryLink: null,
  roleTitle: 'Beta Role',
  sourceName: 'Greenhouse',
  status: 'researching',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function Harness({
  applicationDetailLoader,
  applicationEventsLoader,
  applicationLinksLoader,
  attemptLoader,
}: {
  applicationDetailLoader: (applicationId: string) => Promise<ReturnType<typeof createApplicationDetail> | null>
  applicationEventsLoader: ReturnType<typeof vi.fn>
  applicationLinksLoader: ReturnType<typeof vi.fn>
  attemptLoader: ReturnType<typeof vi.fn>
}) {
  const state = useApplicationDetailSubsectionLoads({
    applicationDetailLoader,
    applicationEventsLoader: applicationEventsLoader as never,
    applicationLinksLoader: applicationLinksLoader as never,
    attemptLoader: attemptLoader as never,
  })

  return (
    <div>
      <button type="button" onClick={() => state.openApplicationDetail(seedA)}>
        Open A
      </button>
      <button type="button" onClick={() => state.setSelectedApplication(null)}>
        Close
      </button>
      <button type="button" onClick={() => state.openApplicationDetail(seedB)}>
        Open B
      </button>
      <pre data-testid="subsection-snapshot">
        {JSON.stringify({
          selectedId: state.selectedApplication?.id ?? null,
          detailCompany: state.applicationDetail?.companyName ?? null,
          linkLabels: state.applicationLinksResult.items.map((item) => item.label),
          eventMessages: state.applicationEventsResult.items.map((item) => item.message),
          attemptSummaries: state.attemptResult.items.map((item) => item.summary),
        })}
      </pre>
    </div>
  )
}

describe('useApplicationDetailSubsectionLoads application-id boundary', () => {
  it('clears application A subsection state after close before B settles, and does not restore A on B failure', async () => {
    const detailA = createApplicationDetail({
      id: 'application-a',
      companyName: 'Alpha Corp',
      roleTitle: 'Alpha Role',
    })
    const linksA = createLinksResult([{
      id: 'link-a',
      applicationId: 'application-a',
      kind: 'official',
      label: 'alpha-official',
      url: 'https://example.com/alpha',
      externalId: null,
      isPrimary: true,
      discoveredAt: '2026-06-04T16:00:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:00:00.000Z',
      deletedAt: null,
    }])
    const eventsA = createEventsResult([{
      id: 'event-a',
      applicationId: 'application-a',
      type: 'application_created',
      message: 'Alpha event marker',
      payloadJson: '{}',
      actor: 'agent:codex',
      createdAt: '2026-06-04T16:00:00.000Z',
    }])
    const attemptsA = createAttemptResult([{
      ...createAttemptResult().items[0]!,
      id: 'attempt-a',
      applicationId: 'application-a',
      summary: 'Alpha attempt marker',
    }])

    const pendingDetailB = deferred<ReturnType<typeof createApplicationDetail> | null>()
    const pendingLinksB = deferred<ReturnType<typeof createLinksResult>>()
    const pendingEventsB = deferred<ReturnType<typeof createEventsResult>>()
    const pendingAttemptsB = deferred<ReturnType<typeof createAttemptResult>>()

    const applicationDetailLoader = vi.fn(async (applicationId: string) => {
      if (applicationId === 'application-a') return detailA
      return pendingDetailB.promise
    })
    const applicationLinksLoader = vi.fn(async (input: { applicationId: string }) => {
      if (input.applicationId === 'application-a') return linksA
      return pendingLinksB.promise
    })
    const applicationEventsLoader = vi.fn(async (input: { applicationId: string }) => {
      if (input.applicationId === 'application-a') return eventsA
      return pendingEventsB.promise
    })
    const attemptLoader = vi.fn(async (applicationId: string) => {
      if (applicationId === 'application-a') return attemptsA
      return pendingAttemptsB.promise
    })

    render(
      <Harness
        applicationDetailLoader={applicationDetailLoader}
        applicationEventsLoader={applicationEventsLoader}
        applicationLinksLoader={applicationLinksLoader}
        attemptLoader={attemptLoader}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open A' }))
    await waitFor(() => {
      const snapshot = JSON.parse(screen.getByTestId('subsection-snapshot').textContent ?? '{}')
      expect(snapshot).toMatchObject({
        selectedId: 'application-a',
        detailCompany: 'Alpha Corp',
        linkLabels: ['alpha-official'],
        eventMessages: ['Alpha event marker'],
        attemptSummaries: ['Alpha attempt marker'],
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      const snapshot = JSON.parse(screen.getByTestId('subsection-snapshot').textContent ?? '{}')
      expect(snapshot.selectedId).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open B' }))

    const pendingSnapshot = JSON.parse(screen.getByTestId('subsection-snapshot').textContent ?? '{}')
    expect(pendingSnapshot.selectedId).toBe('application-b')
    expect(pendingSnapshot.detailCompany).toBeNull()
    expect(pendingSnapshot.linkLabels).toEqual([])
    expect(pendingSnapshot.eventMessages).toEqual([])
    expect(pendingSnapshot.attemptSummaries).toEqual([])

    pendingDetailB.reject(new Error('detail B failed'))
    pendingLinksB.reject(new Error('links B failed'))
    pendingEventsB.reject(new Error('events B failed'))
    pendingAttemptsB.reject(new Error('attempts B failed'))

    await waitFor(() => {
      expect(applicationDetailLoader).toHaveBeenCalledWith('application-b')
    })

    const failedSnapshot = JSON.parse(screen.getByTestId('subsection-snapshot').textContent ?? '{}')
    expect(failedSnapshot.selectedId).toBe('application-b')
    expect(failedSnapshot.detailCompany).toBeNull()
    expect(failedSnapshot.linkLabels).toEqual([])
    expect(failedSnapshot.eventMessages).toEqual([])
    expect(failedSnapshot.attemptSummaries).toEqual([])
  })
})
