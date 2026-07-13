import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { ApplicationListQuery } from './modules/applications/application.types'
import type { ActionQueueListQuery } from './modules/action-queue/action-queue.repository'
import type { SourcingFindingsListInput } from 'sparxie'
import {
  createApplication,
  createApplicationDetail,
  createAttemptResult,
  createEventsResult,
  createLinksResult,
  createListResult,
  createActionQueueItem,
  createActionQueueResult,
  createConnectorStatusResult,
  createConnectorStatusView,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult
} from './App.test-helpers'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

describe('App', () => {
  it('renders an accessible loading surface while applications load', () => {
    render(<App applicationLoader={() => new Promise(() => undefined)} />)

    expect(
      screen.getByRole('status', { name: 'Applications loading' }),
    ).toHaveTextContent('Loading applications...')
  })

  it('renders application rows from the configured loader', async () => {
    const result = createListResult([createApplication()])

    render(<App applicationLoader={() => Promise.resolve(result)} />)

    expect(
      screen.queryByRole('tablist', { name: 'Application views' }),
    ).not.toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Applications' })

    expect(within(table).getByText('Astranis Space Technologies')).toBeInTheDocument()
    expect(
      within(table).getByText('Software Engineer- Backend Intern (Fall 2026)'),
    ).toBeInTheDocument()
    expect(within(table).getByText('Fall 2026 internship')).toBeInTheDocument()
    expect(within(table).getByText('Needs User Info')).toBeInTheDocument()
    expect(within(table).getByText('8/10')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'official' })).toHaveAttribute(
      'href',
      'https://jobs.example.test/remediated/f60a3102c158cd7c',
    )
    expect(screen.getByRole('link', { name: 'official' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'official' })).toHaveAttribute(
      'rel',
      'noreferrer',
    )
  })

  it('periodically refreshes visible application rows', async () => {
    vi.useFakeTimers()
    const refreshedApplication = createApplication({
      id: 'application-delta',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
    })
    const applicationLoader = vi
      .fn()
      .mockResolvedValueOnce(createListResult([createApplication()]))
      .mockResolvedValueOnce(createListResult([refreshedApplication]))

    render(
      <App
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Astranis Space Technologies')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(screen.getByText('Delta Labs')).toBeInTheDocument()
    expect(applicationLoader).toHaveBeenCalledTimes(2)
  })

  it('refreshes application rows when returning to the applications view', async () => {
    const refreshedApplication = createApplication({
      id: 'application-delta',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
    })
    const applicationLoader = vi
      .fn()
      .mockResolvedValueOnce(createListResult([createApplication()]))
      .mockResolvedValueOnce(createListResult([refreshedApplication]))

    render(
      <App
        applicationLoader={applicationLoader}
        actionQueueLoader={() => Promise.resolve(createActionQueueResult([createActionQueueItem()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    await screen.findByRole('table', { name: 'Action Queue' })
    fireEvent.click(screen.getByRole('button', { name: 'Applications' }))

    expect(await screen.findByText('Delta Labs')).toBeInTheDocument()
    expect(applicationLoader).toHaveBeenCalledTimes(2)
  })

  it('lets users add application rows from a modal and reloads the list', async () => {
    const created = createApplication({
      id: 'application-delta',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      status: 'queued',
    })
    const createApplicationRow = vi.fn(async () => created)
    const applicationLoader = vi
      .fn()
      .mockResolvedValueOnce(createListResult([createApplication()]))
      .mockResolvedValueOnce(createListResult([createApplication(), created]))

    render(
      <App
        applicationCreator={createApplicationRow}
        applicationLoader={applicationLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Add application' }))

    const dialog = await screen.findByRole('dialog', { name: 'Add application' })
    fireEvent.change(within(dialog).getByLabelText('Company'), {
      target: { value: 'Delta Labs' },
    })
    fireEvent.change(within(dialog).getByLabelText('Role'), {
      target: { value: 'Software Engineering Intern' },
    })
    fireEvent.change(within(dialog).getByLabelText('Source'), {
      target: { value: 'LinkedIn' },
    })
    fireEvent.change(within(dialog).getByLabelText('Country'), {
      target: { value: 'US' },
    })
    fireEvent.change(within(dialog).getByLabelText('Primary URL'), {
      target: { value: 'https://jobs.example.com/delta' },
    })
    fireEvent.change(within(dialog).getByLabelText('Source URL'), {
      target: { value: 'https://linkedin.com/jobs/delta' },
    })
    fireEvent.change(within(dialog).getByLabelText('Timing mode'), {
      target: { value: 'dates' },
    })
    fireEvent.change(within(dialog).getByLabelText('Start date'), {
      target: { value: '2027-05-15' },
    })
    fireEvent.change(within(dialog).getByLabelText('End date'), {
      target: { value: '2027-08-15' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save application' }))

    await waitFor(() => {
      expect(createApplicationRow).toHaveBeenCalledWith({
        companyName: 'Delta Labs',
        country: 'US',
        primaryLink: {
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/delta',
        },
        sourceLink: {
          kind: 'source',
          label: 'source',
          url: 'https://linkedin.com/jobs/delta',
        },
        roleKind: 'internship',
        roleTitle: 'Software Engineering Intern',
        sourceName: 'LinkedIn',
        timingMode: 'dates',
        startDate: '2027-05-15',
        endDate: '2027-08-15',
        status: 'queued',
        workMode: 'remote',
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add application' })).not.toBeInTheDocument()
      expect(applicationLoader).toHaveBeenCalledTimes(2)
    })
  })

  it('opens an application edit modal from a row action without opening detail', async () => {
    const updateApplication = vi.fn(async () =>
      createApplicationDetail({ roleTitle: 'Backend Platform Intern' }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationUpdater={updateApplication}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Astranis Space Technologies' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit application' })
    expect(screen.queryByRole('dialog', { name: 'Application detail' })).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Role'), {
      target: { value: 'Backend Platform Intern' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save application' }))

    await waitFor(() => {
      expect(updateApplication).toHaveBeenCalledWith({
        applicationId: 'application-1',
        country: 'US',
        hasApplied: false,
        locationRaw: 'San Francisco, CA / Onsite',
        roleKind: 'internship',
        roleTitle: 'Backend Platform Intern',
        timingMode: 'terms',
        terms: [{ season: 'fall', year: 2026 }],
        workMode: 'onsite',
      })
    })
  })

  it('lets users update application status, workflow, and notes from the edit modal', async () => {
    const updateApplication = vi.fn(async () => createApplicationDetail())
    const updateStatus = vi.fn(async () => createApplicationDetail({ status: 'ready_for_review' }))
    const updateWorkflow = vi.fn(async () => createApplicationDetail({ status: 'ready_for_review' }))
    const appendNote = vi.fn(async () =>
      createApplicationDetail({ notes: 'Recruiter replied with next steps.' }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationNoteAppender={appendNote}
        applicationStatusUpdater={updateStatus}
        applicationUpdater={updateApplication}
        applicationWorkflowUpdater={updateWorkflow}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Astranis Space Technologies' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit application' })
    fireEvent.change(within(dialog).getByLabelText('Status'), {
      target: { value: 'ready_for_review' },
    })
    fireEvent.change(within(dialog).getByLabelText('Status note'), {
      target: { value: 'Ready for human review.' },
    })
    fireEvent.change(within(dialog).getByLabelText('Manual review kind'), {
      target: { value: 'overridable' },
    })
    fireEvent.change(within(dialog).getByLabelText('Missing user info'), {
      target: { value: 'Portfolio URL' },
    })
    fireEvent.change(within(dialog).getByLabelText('Blocker reason'), {
      target: { value: 'Captcha requires user session.' },
    })
    const applicationNote = within(dialog).getByLabelText('Application note')
    expect(applicationNote).toHaveAttribute('data-slot', 'textarea')
    expect(applicationNote).toHaveClass('min-h-20', 'resize-y')
    fireEvent.change(applicationNote, {
      target: { value: 'Recruiter replied with next steps.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save application' }))

    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith({
        applicationId: 'application-1',
        notes: 'Ready for human review.',
        status: 'ready_for_review',
      })
      expect(updateWorkflow).toHaveBeenCalledWith({
        applicationId: 'application-1',
        blockerReason: 'Captcha requires user session.',
        manualReviewKind: 'overridable',
        missingUserInfo: 'Portfolio URL',
      })
      expect(appendNote).toHaveBeenCalledWith({
        applicationId: 'application-1',
        message: 'Recruiter replied with next steps.',
      })
    })
  })

  it('keeps application edit modals open when saving fails', async () => {
    render(
      <App
        applicationCreator={vi.fn(async () => {
          throw new Error('Duplicate application official URL')
        })}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Add application' }))

    const dialog = await screen.findByRole('dialog', { name: 'Add application' })
    fireEvent.change(within(dialog).getByLabelText('Company'), {
      target: { value: 'Delta Labs' },
    })
    fireEvent.change(within(dialog).getByLabelText('Role'), {
      target: { value: 'Software Engineering Intern' },
    })
    fireEvent.change(within(dialog).getByLabelText('Source'), {
      target: { value: 'LinkedIn' },
    })
    fireEvent.change(within(dialog).getByLabelText('Country'), {
      target: { value: 'US' },
    })
    fireEvent.change(within(dialog).getByLabelText('Primary URL'), {
      target: { value: 'https://jobs.example.com/delta' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save application' }))

    expect(await within(dialog).findByText('Duplicate application official URL')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Add application' })).toBeInTheDocument()
  })

  it('opens a shared application detail modal from an application row', async () => {
    const attempts = createAttemptResult()
    const detailQueries: string[] = []
    const linkQueries: string[] = []
    const eventQueries: string[] = []

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationDetailLoader={(applicationId) => {
          detailQueries.push(applicationId)
          return Promise.resolve(createApplicationDetail())
        }}
        applicationEventsLoader={(input) => {
          eventQueries.push(input.applicationId)
          return Promise.resolve(createEventsResult())
        }}
        applicationLinksLoader={(input) => {
          linkQueries.push(input.applicationId)
          return Promise.resolve(createLinksResult())
        }}
        attemptLoader={() => Promise.resolve(attempts)}
      />,
    )

    fireEvent.click(await screen.findByText('Astranis Space Technologies'))

    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })

    expect(detailQueries).toContain('application-1')
    expect(linkQueries).toContain('application-1')
    expect(eventQueries).toContain('application-1')
    expect(dialog).toHaveClass('backdrop-blur-sm')
    expect(within(dialog).getByText('Application detail')).toBeInTheDocument()
    expect(within(dialog).getByText('Software Engineer- Backend Intern (Fall 2026)')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Needs User Info')).toHaveLength(2)
    expect(within(dialog).getByText('Source context')).toBeInTheDocument()
    expect(within(dialog).getAllByText('LinkedIn').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('Links')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'source' })).toHaveAttribute(
      'href',
      'https://linkedin.com/jobs/astranis',
    )
    expect(within(dialog).getByText('Events')).toBeInTheDocument()
    expect(within(dialog).getByText('Application created from sourcing.')).toBeInTheDocument()
    expect(within(dialog).getByText('Attempts')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('link', { name: 'official' })[0]).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(within(dialog).getByText('Started SmartRecruiters application.')).toBeInTheDocument()
    expect(within(dialog).getByText('Uploaded tailored resume.')).toBeInTheDocument()
  })

  it('lets users add application links and record scores from the detail modal', async () => {
    const createLink = vi.fn(async () => ({
      id: 'link-new',
      applicationId: 'application-1',
      kind: 'source',
      label: 'source',
      url: 'https://linkedin.com/jobs/new',
      externalId: null,
      isPrimary: false,
      discoveredAt: '2026-06-04T16:00:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:00:00.000Z',
      deletedAt: null,
    }))
    const recordScore = vi.fn(async () => undefined)

    render(
      <App
        applicationLinkCreator={createLink}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationDetailLoader={() => Promise.resolve(createApplicationDetail())}
        applicationEventsLoader={() => Promise.resolve(createEventsResult())}
        applicationLinksLoader={() => Promise.resolve(createLinksResult())}
        attemptLoader={() => Promise.resolve(createAttemptResult())}
        scoreRecorder={recordScore}
      />,
    )

    fireEvent.click(await screen.findByText('Astranis Space Technologies'))
    const detailDialog = await screen.findByRole('dialog', { name: 'Application detail' })

    fireEvent.click(within(detailDialog).getByRole('button', { name: 'Add link' }))
    const linkDialog = await screen.findByRole('dialog', { name: 'Add application link' })
    fireEvent.change(within(linkDialog).getByLabelText('Link label'), {
      target: { value: 'source' },
    })
    fireEvent.change(within(linkDialog).getByLabelText('Link URL'), {
      target: { value: 'https://linkedin.com/jobs/new' },
    })
    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Save link' }))

    await waitFor(() => {
      expect(createLink).toHaveBeenCalledWith({
        applicationId: 'application-1',
        kind: 'source',
        label: 'source',
        url: 'https://linkedin.com/jobs/new',
      })
    })

    fireEvent.click(within(detailDialog).getByRole('button', { name: 'Record score' }))
    const scoreDialog = await screen.findByRole('dialog', { name: 'Record application score' })
    fireEvent.change(within(scoreDialog).getByLabelText('Score'), { target: { value: '9' } })
    fireEvent.change(within(scoreDialog).getByLabelText('Rationale'), {
      target: { value: 'Excellent platform fit.' },
    })
    fireEvent.click(within(scoreDialog).getByRole('button', { name: 'Save score' }))

    await waitFor(() => {
      expect(recordScore).toHaveBeenCalledWith({
        applicationId: 'application-1',
        band: 'high',
        careerSignal: 9,
        cityWorkMode: 9,
        compensationLogistics: 9,
        penalties: [],
        rationale: 'Excellent platform fit.',
        roleRelevance: 9,
        rubricVersion: 'human-modal-v1',
        score: 9,
      })
    })
  })

  it('renders verification receipt attempt steps as receipt blocks', async () => {
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

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationDetailLoader={() => Promise.resolve(createApplicationDetail())}
        applicationEventsLoader={() => Promise.resolve(createEventsResult())}
        applicationLinksLoader={() => Promise.resolve(createLinksResult())}
        attemptLoader={() => Promise.resolve(attempts)}
      />,
    )

    fireEvent.click(await screen.findByText('Astranis Space Technologies'))

    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })

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

  it('opens the same application detail modal from an action queue row', async () => {
    const attemptQueries: string[] = []

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationDetailLoader={(applicationId) =>
          Promise.resolve(
            createApplicationDetail({
              id: applicationId,
              companyName: 'Versant Media',
              roleTitle: 'Academic Year Internships: Platform Engineering',
            }),
          )
        }
        attemptLoader={(applicationId) => {
          attemptQueries.push(applicationId)
          return Promise.resolve(createAttemptResult())
        }}
        actionQueueLoader={() => Promise.resolve(createActionQueueResult([createActionQueueItem()]))}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    fireEvent.click(await screen.findByText('Versant Media'))

    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })

    expect(attemptQueries).toContain('application-versant-platform')
    expect(within(dialog).getByText('Academic Year Internships: Platform Engineering')).toBeInTheDocument()
    expect(within(dialog).getByText('Attempts')).toBeInTheDocument()
    expect(within(dialog).getByText('Started SmartRecruiters application.')).toBeInTheDocument()
  })

  it('renders empty application detail sections', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationLinksLoader={() => Promise.resolve(createLinksResult([]))}
        applicationEventsLoader={() => Promise.resolve(createEventsResult([]))}
        attemptLoader={() => Promise.resolve(createAttemptResult([]))}
      />,
    )

    fireEvent.click(await screen.findByText('Astranis Space Technologies'))

    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })

    expect(within(dialog).getByText('No links recorded.')).toBeInTheDocument()
    expect(within(dialog).getByText('No events recorded.')).toBeInTheDocument()
    expect(within(dialog).getByText('No attempts recorded.')).toBeInTheDocument()
  })

  it('renders the virtualized table without lifecycle warnings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))} />)

      expect(await screen.findByText('Astranis Space Technologies')).toBeInTheDocument()

      expect(
        consoleError.mock.calls.some((call) => call.join(' ').includes('flushSync was called')),
      ).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('renders application rows from the paginated preload API', async () => {
    const result = createListResult([createApplication({ primaryLink: null, notes: null })])

    ;(window as Window & { applications?: { list: () => Promise<ApplicationListResult> } })
      .applications = {
      list: () => Promise.resolve(result),
    }

    render(<App />)

    expect(await screen.findByText('Astranis Space Technologies')).toBeInTheDocument()
  })

  it('keeps advanced filters collapsed behind search by default', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'astranis' } })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        search: 'astranis',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('renders action queue rows from the configured loader', async () => {
    const actionQueueQueries: ActionQueueListQuery[] = []

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        actionQueueLoader={(query) => {
          actionQueueQueries.push(query)
          return Promise.resolve({
            ...createActionQueueResult([createActionQueueItem()]),
            total: 80,
            offset: query.offset ?? 0,
            hasMore: (query.offset ?? 0) + 50 < 80,
          })
        }}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))

    const table = await screen.findByRole('table', { name: 'Action Queue' })

    expect(screen.getByRole('heading', { name: 'Action Queue' })).toBeInTheDocument()
    expect(within(table).getByText('Versant Media')).toBeInTheDocument()
    expect(within(table).getByText('Academic Year Internships: Platform Engineering')).toBeInTheDocument()
    expect(within(table).getByText('Apply now')).toBeInTheDocument()
    expect(within(table).getByText('Queued score 6 meets policy cutoff 6.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Apply now 1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next action queue page' }))
    await waitFor(() => {
      expect(actionQueueQueries.at(-1)).toMatchObject({ offset: 50 })
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Apply now 1' }))
    await waitFor(() => {
      expect(actionQueueQueries.at(-1)).toMatchObject({
        actionBucket: 'apply_now',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('pages through action queue results in a labeled button group', async () => {
    const actionQueueQueries: ActionQueueListQuery[] = []

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        actionQueueLoader={(query) => {
          actionQueueQueries.push(query)
          return Promise.resolve({
            ...createActionQueueResult([createActionQueueItem()]),
            total: 80,
            offset: query.offset ?? 0,
            hasMore: (query.offset ?? 0) + 50 < 80,
          })
        }}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    await screen.findByRole('table', { name: 'Action Queue' })

    const pagination = screen.getByRole('group', { name: 'Action Queue pagination' })
    expect(pagination).toHaveAttribute('data-slot', 'button-group')
    expect(
      within(pagination).getByRole('button', { name: 'Previous action queue page' }),
    ).toBeDisabled()
    expect(
      within(pagination).getByRole('button', { name: 'Next action queue page' }),
    ).toBeEnabled()

    fireEvent.click(within(pagination).getByRole('button', { name: 'Next action queue page' }))

    await waitFor(() => {
      expect(actionQueueQueries.at(-1)).toMatchObject({ offset: 50, limit: 50 })
    })

    expect(
      within(pagination).getByRole('button', { name: 'Previous action queue page' }),
    ).toBeEnabled()
    expect(
      within(pagination).getByRole('button', { name: 'Next action queue page' }),
    ).toBeDisabled()

    fireEvent.click(
      within(pagination).getByRole('button', { name: 'Previous action queue page' }),
    )

    await waitFor(() => {
      expect(actionQueueQueries.at(-1)).toMatchObject({ offset: 0, limit: 50 })
    })

    expect(
      within(pagination).getByRole('button', { name: 'Previous action queue page' }),
    ).toBeDisabled()
    expect(
      within(pagination).getByRole('button', { name: 'Next action queue page' }),
    ).toBeEnabled()
  })

  it('renders connector status from the configured loader', async () => {
    const connectorStatusLoader = vi.fn(async () => createConnectorStatusResult())

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))

    const table = await screen.findByRole('table', { name: 'Connector status' })

    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeInTheDocument()
    expect(within(table).getByText('Fixture Jobs')).toBeInTheDocument()
    expect(within(table).getByText('Auth required')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Reconnect Fixture Jobs' })).toBeInTheDocument()
    expect(connectorStatusLoader).toHaveBeenCalledTimes(1)
  })

  it('runs connector status actions and reloads connector status', async () => {
    const connectorStatusLoader = vi
      .fn()
      .mockResolvedValueOnce(createConnectorStatusResult())
      .mockResolvedValueOnce(createConnectorStatusResult())
      .mockResolvedValueOnce(
        createConnectorStatusResult([
          createConnectorStatusView({
            actionLabel: null,
            actions: [],
            latestRunId: 'connector-run-skipped',
            severity: 'warning',
            status: 'skipped',
            statusLabel: 'Skipped',
            summary: 'Latest run was skipped.',
            warnings: [],
            warningCount: 0,
          }),
        ]),
      )
    const connectorStatusReconnector = vi.fn(async () => ({
      action: 'reconnect' as const,
      connectorInstanceId: 'connector-instance-fixture',
      grants: [{ id: 'fixture-session', mode: 'api_key' as const, status: 'ready' as const }],
      message: 'Connector auth is ready.',
      status: 'ready' as const,
    }))
    const connectorStatusSkipper = vi.fn(async () => ({
      action: 'skip' as const,
      connectorInstanceId: 'connector-instance-fixture',
      message: 'Connector run skipped.',
      run: {
        completedAt: '2026-07-08T17:05:00.000Z',
        connectorInstanceId: 'connector-instance-fixture',
        coverage: { start: null, end: null },
        filterSignature: 'filters:{}',
        id: 'connector-run-skipped',
        mode: 'manual',
        observationCount: 0,
        retryHints: null,
        startedAt: '2026-07-08T17:05:00.000Z',
        stats: { skipped: true },
        status: 'skipped',
        warningCount: 0,
        warnings: [],
      },
      status: 'skipped' as const,
    }))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        connectorStatusReconnector={connectorStatusReconnector}
        connectorStatusSkipper={connectorStatusSkipper}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))

    const table = await screen.findByRole('table', { name: 'Connector status' })
    fireEvent.click(within(table).getByRole('button', { name: 'Reconnect Fixture Jobs' }))

    await waitFor(() => {
      expect(connectorStatusReconnector).toHaveBeenCalledWith({
        connectorInstanceId: 'connector-instance-fixture',
      })
      expect(connectorStatusLoader).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(within(await screen.findByRole('table', { name: 'Connector status' })).getByRole(
      'button',
      { name: 'Skip this run for Fixture Jobs' },
    ))

    await waitFor(() => {
      expect(connectorStatusSkipper).toHaveBeenCalledWith({
        connectorInstanceId: 'connector-instance-fixture',
        reason: 'user_skipped_auth_required_run',
      })
      expect(connectorStatusLoader).toHaveBeenCalledTimes(3)
      expect(screen.getByText('Skipped')).toBeInTheDocument()
    })
  })

  it('keeps connector status in loading state while the loader is pending', async () => {
    let resolveConnectorStatus!: (result: ReturnType<typeof createConnectorStatusResult>) => void
    const connectorStatusLoader = vi.fn(
      () => new Promise<ReturnType<typeof createConnectorStatusResult>>((resolve) => {
        resolveConnectorStatus = resolve
      }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorStatusLoader={connectorStatusLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))

    expect(screen.getByRole('status', { name: 'Connector status loading' })).toBeInTheDocument()
    expect(screen.queryByText('Connector status is unavailable for this runtime.')).not.toBeInTheDocument()

    await act(async () => {
      resolveConnectorStatus(createConnectorStatusResult([]))
    })

    expect(await screen.findByRole('heading', { name: 'No enabled connectors' })).toBeInTheDocument()
    expect(screen.getByText('Enable a connector to monitor refresh health here.')).toBeInTheDocument()
  })

  it('lets users edit the underlying application from an action queue row and reloads action queue', async () => {
    const actionQueueItem = createActionQueueItem()
    const actionQueueLoader = vi
      .fn()
      .mockResolvedValueOnce(createActionQueueResult([actionQueueItem]))
      .mockResolvedValueOnce(
        createActionQueueResult([
          createActionQueueItem({ roleTitle: 'Backend Platform Engineering Intern' }),
        ]),
      )
    const applicationDetailLoader = vi.fn(async (applicationId: string) =>
      createApplicationDetail({
        id: applicationId,
        companyName: 'Versant Media',
        roleTitle: 'Academic Year Internships: Platform Engineering',
        sourceName: 'LinkedIn',
        status: 'queued',
        term: 'Academic Year internship',
        location: 'Universal City, CA / Remote',
        workMode: 'remote',
        primaryLink: actionQueueItem.primaryLink,
      }),
    )
    const updateApplication = vi.fn(async () =>
      createApplicationDetail({ roleTitle: 'Backend Platform Engineering Intern' }),
    )

    render(
      <App
        applicationDetailLoader={applicationDetailLoader}
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationUpdater={updateApplication}
        actionQueueLoader={actionQueueLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Action Queue' }))
    await screen.findByRole('table', { name: 'Action Queue' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit Versant Media' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit application' })

    expect(applicationDetailLoader).toHaveBeenCalledWith('application-versant-platform')
    expect(screen.queryByRole('dialog', { name: 'Application detail' })).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Role'), {
      target: { value: 'Backend Platform Engineering Intern' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save application' }))

    await waitFor(() => {
      expect(updateApplication).toHaveBeenCalledWith({
        applicationId: 'application-versant-platform',
        country: 'US',
        hasApplied: false,
        locationRaw: 'Universal City, CA / Remote',
        roleKind: 'internship',
        roleTitle: 'Backend Platform Engineering Intern',
        timingMode: 'terms',
        terms: [{ season: 'fall', year: 2026 }],
        workMode: 'remote',
      })
      expect(actionQueueLoader).toHaveBeenCalledTimes(2)
    })
  })

  it('renders sourcing findings with merge-status filtering and promote action', async () => {
    const queries: SourcingFindingsListInput[] = []
    const attemptQueries: string[] = []
    const detailQueries: string[] = []
    const promoteFinding = vi.fn(async () =>
      createSourcingFinding({ mergeStatus: 'merged', mergedApplicationId: 'application-1' }),
    )

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        applicationDetailLoader={(applicationId) => {
          detailQueries.push(applicationId)
          return Promise.resolve(
            createApplicationDetail({
              id: applicationId,
              companyName: 'Versant Media',
              roleTitle: 'Academic Year Internships: Platform Engineering',
              status: 'queued',
            }),
          )
        }}
        attemptLoader={(applicationId) => {
          attemptQueries.push(applicationId)
          return Promise.resolve(createAttemptResult())
        }}
        sourcingLoader={(query) => {
          queries.push(query)
          return Promise.resolve(
            createSourcingResult([
              createSourcingFinding(),
              createSourcingFinding({
                id: 'finding-duplicate',
                companyName: 'Versant Media',
                roleTitle: 'Academic Year Internships: Platform Engineering',
                mergeStatus: 'duplicate',
                mergedApplicationId: 'application-versant-platform',
                mergedApplicationCompanyName: 'Versant Media',
                mergedApplicationRoleTitle: 'Academic Year Internships: Platform Engineering',
                mergeNotes: 'Duplicate official URL matched an existing application.',
              }),
            ]),
          )
        }}
        promoteSourcingFinding={promoteFinding}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))

    const table = await screen.findByRole('table', { name: 'Sourcing findings' })

    expect(screen.getByRole('heading', { name: 'Sourcing' })).toBeInTheDocument()
    expect(within(table).getByText('Delta Labs')).toBeInTheDocument()
    expect(within(table).getAllByText('Fall 2026').length).toBeGreaterThan(0)
    expect(within(table).getByText('Software Engineering Intern')).toBeInTheDocument()
    expect(within(table).getAllByText('LinkedIn')).toHaveLength(2)
    expect(within(table).getAllByText('run-1')).toHaveLength(2)
    expect(within(table).getByText('new')).toBeInTheDocument()
    expect(within(table).getByText('Ready to review')).toBeInTheDocument()
    expect(within(table).getAllByText('7/10')).toHaveLength(2)
    expect(within(table).getByText('application-versant-platform')).toBeInTheDocument()
    expect(
      within(table).getByText('Versant Media - Academic Year Internships: Platform Engineering'),
    ).toBeInTheDocument()
    expect(within(table).getByText('Duplicate')).toBeInTheDocument()
    expect(within(table).getByText('Linked to existing application')).toBeInTheDocument()
    expect(
      within(table).getByRole('button', { name: 'Open app Versant Media' }),
    ).toBeInTheDocument()
    for (const officialLink of within(table).getAllByRole('link', { name: 'official' })) {
      expect(officialLink).toHaveAttribute('target', '_blank')
    }
    for (const sourceLink of within(table).getAllByRole('link', { name: 'source' })) {
      expect(sourceLink).toHaveAttribute('target', '_blank')
    }
    expect(screen.getByRole('button', { name: 'Review new' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review blocked' })).toBeInTheDocument()

    const sourceFilter = screen.getByRole('combobox', { name: 'Source' })

    expect(within(sourceFilter).getByRole('option', { name: 'Any source' })).toBeInTheDocument()
    expect(within(sourceFilter).getByRole('option', { name: 'LinkedIn' })).toHaveValue(
      'source-linkedin',
    )
    expect(sourceFilter).toHaveDisplayValue('Any source')

    fireEvent.click(screen.getByRole('button', { name: 'Review blocked' }))

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        limit: 50,
        mergeStatus: 'blocked',
        offset: 0,
      })
    })

    fireEvent.change(screen.getByLabelText('Merge status'), { target: { value: 'new' } })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        limit: 50,
        mergeStatus: 'new',
        offset: 0,
      })
    })

    fireEvent.change(sourceFilter, { target: { value: 'source-linkedin' } })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        limit: 50,
        mergeStatus: 'new',
        offset: 0,
        sourceId: 'source-linkedin',
      })
    })

    fireEvent.click(within(table).getByRole('button', { name: 'Promote Delta Labs' }))

    await waitFor(() => {
      expect(promoteFinding).toHaveBeenCalledWith({ findingId: 'finding-1' })
    })

    fireEvent.click(within(table).getByRole('button', { name: 'Open app Versant Media' }))

    await waitFor(() => {
      expect(detailQueries).toContain('application-versant-platform')
      expect(attemptQueries).toContain('application-versant-platform')
    })
    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })

    expect(within(dialog).getByText('Versant Media')).toBeInTheDocument()
    expect(within(dialog).getByText('Academic Year Internships: Platform Engineering')).toBeInTheDocument()
  })

})
