import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { ScoreRecord } from 'sparxie'

import {
  createApplicationDetail,
  createAttemptResult,
  createEventsResult,
  createLinksResult,
} from '../../App.test-helpers'
import { ApplicationDetailModal } from './ApplicationDetailModal'

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDetailModal(
  overrides: Partial<ComponentProps<typeof ApplicationDetailModal>> = {},
) {
  const onClose = vi.fn()
  const onCreateLink = vi.fn(async () => createLinksResult().items[0])
  const onRecordScore = vi.fn(
    async (): Promise<ScoreRecord> => ({
      id: 'score-1',
      applicationId: 'application-1',
      score: 9,
      band: 'high',
      rationale: 'Excellent platform fit.',
      roleRelevance: 9,
      careerSignal: 9,
      cityWorkMode: 9,
      compensationLogistics: 9,
      penalties: [],
      rubricVersion: 'human-modal-v1',
      createdAt: '2026-06-04T16:00:00.000Z',
    }),
  )

  render(
    <div data-testid="detail-host">
      <ApplicationDetailModal
        application={createApplicationDetail()}
        attempts={createAttemptResult().items}
        attemptsError={null}
        detailError={null}
        events={createEventsResult().items}
        eventsError={null}
        isAttemptsLoading={false}
        isDetailLoading={false}
        isEventsLoading={false}
        isLinksLoading={false}
        links={createLinksResult().items}
        linksError={null}
        onClose={onClose}
        onCreateLink={onCreateLink}
        onRecordScore={onRecordScore}
        {...overrides}
      />
    </div>,
  )

  return { onClose, onCreateLink, onRecordScore }
}

describe('ApplicationDetailModal', () => {
  it('portals the detail dialog and opens nested link/score dialogs over it', async () => {
    const { onCreateLink, onRecordScore } = renderDetailModal()

    const detailDialog = await screen.findByRole('dialog', { name: 'Application detail' })
    expect(detailDialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(document.body.contains(detailDialog)).toBe(true)
    expect(
      document.querySelector('[data-testid="detail-host"]')?.contains(detailDialog),
    ).toBe(false)

    fireEvent.click(within(detailDialog).getByRole('button', { name: 'Add link' }))
    const linkDialog = await screen.findByRole('dialog', { name: 'Add application link' })
    expect(linkDialog).toHaveAttribute('data-slot', 'dialog-content')

    fireEvent.change(within(linkDialog).getByLabelText('Link label'), {
      target: { value: 'source' },
    })
    fireEvent.change(within(linkDialog).getByLabelText('Link URL'), {
      target: { value: 'https://linkedin.com/jobs/new' },
    })
    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Save link' }))

    await waitFor(() => {
      expect(onCreateLink).toHaveBeenCalledWith({
        applicationId: 'application-1',
        kind: 'source',
        label: 'source',
        url: 'https://linkedin.com/jobs/new',
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add application link' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('dialog', { name: 'Application detail' })).toBeInTheDocument()

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Application detail' })).getByRole(
        'button',
        { name: 'Record score' },
      ),
    )
    const scoreDialog = await screen.findByRole('dialog', { name: 'Record application score' })
    fireEvent.change(within(scoreDialog).getByLabelText('Score'), { target: { value: '9' } })
    fireEvent.change(within(scoreDialog).getByLabelText('Rationale'), {
      target: { value: 'Excellent platform fit.' },
    })
    fireEvent.click(within(scoreDialog).getByRole('button', { name: 'Save score' }))

    await waitFor(() => {
      expect(onRecordScore).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'application-1',
          score: 9,
          rationale: 'Excellent platform fit.',
        }),
      )
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Record application score' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByRole('dialog', { name: 'Application detail' })).toBeInTheDocument()
  })
})
