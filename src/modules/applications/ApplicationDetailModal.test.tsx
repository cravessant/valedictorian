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

  it('renders verification receipt attempt steps as receipt blocks', () => {
    const attempts = createAttemptResult([
      {
        ...createAttemptResult().items[0],
        steps: [
          ...createAttemptResult().items[0].steps,
          {
            id: 'step-3',
            attemptId: 'attempt-1',
            applicationId: 'application-1',
            sequence: 3,
            type: 'verification_receipt',
            message: 'Final review verification passed.',
            payloadJson: JSON.stringify({
              version: 1,
              scope: 'final_review',
              status: 'passed',
              verified: ['resume attachment', 'contact info'],
              unresolved: [],
              evidence: 'Final review page showed the attached resume and contact info.',
            }),
            actor: 'agent:codex',
            createdAt: '2026-06-04T16:03:00.000Z',
          },
          {
            id: 'step-4',
            attemptId: 'attempt-1',
            applicationId: 'application-1',
            sequence: 4,
            type: 'verification_receipt',
            message: 'Final review verification failed.',
            payloadJson: JSON.stringify({
              version: 1,
              scope: 'final_review',
              status: 'failed',
              verified: ['resume attachment'],
              unresolved: ['Fall availability dates', 'onsite availability'],
              evidence: 'Submit was paused because the availability fields were unanswered.',
            }),
            actor: 'agent:codex',
            createdAt: '2026-06-04T16:04:00.000Z',
          },
        ],
      },
    ])

    renderDetailModal({ attempts: attempts.items })

    const dialog = screen.getByRole('dialog', { name: 'Application detail' })
    expect(within(dialog).getByText('Uploaded tailored resume.')).toBeInTheDocument()
    expect(within(dialog).getByText('Final review verification passed.')).toBeInTheDocument()
    expect(within(dialog).getByText('Final review verification failed.')).toBeInTheDocument()
    expect(within(dialog).getByText('Passed')).toBeInTheDocument()
    expect(within(dialog).getByText('Failed')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Final review page showed the attached resume and contact info.'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('Submit was paused because the availability fields were unanswered.'),
    ).toBeInTheDocument()
    expect(within(dialog).getAllByText('resume attachment')).toHaveLength(2)
    expect(within(dialog).getByText('contact info')).toBeInTheDocument()
    expect(within(dialog).getByText('Fall availability dates')).toBeInTheDocument()
    expect(within(dialog).getByText('onsite availability')).toBeInTheDocument()
  })

  it('renders empty application detail sections', () => {
    renderDetailModal({
      attempts: [],
      events: [],
      links: [],
    })

    const dialog = screen.getByRole('dialog', { name: 'Application detail' })
    expect(within(dialog).getByText('No links recorded.')).toBeInTheDocument()
    expect(within(dialog).getByText('No events recorded.')).toBeInTheDocument()
    expect(within(dialog).getByText('No attempts recorded.')).toBeInTheDocument()
  })
})
