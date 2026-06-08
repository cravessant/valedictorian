import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { ApplicationListQuery } from './modules/applications/application.types'
import type { QueueListQuery } from './modules/queue/queue.repository'
import type { SourcingFindingsListInput } from 'sparxie'
import {
  createApplication,
  createApplicationDetail,
  createAttemptResult,
  createEventsResult,
  createLinksResult,
  createListResult,
  createQueueItem,
  createQueueResult,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
} from './App.test-helpers'

afterEach(() => {
  cleanup()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
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
    expect(within(table).getByText('needs_user_info')).toBeInTheDocument()
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
        term: 'Fall 2026 internship',
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
    fireEvent.change(within(dialog).getByLabelText('Application note'), {
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
    expect(within(dialog).getAllByText('needs_user_info')).toHaveLength(2)
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
    expect(within(dialog).getByText('passed')).toBeInTheDocument()
    expect(within(dialog).getByText('failed')).toBeInTheDocument()
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

  it('opens the same application detail modal from a queue row', async () => {
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
        queueLoader={() => Promise.resolve(createQueueResult([createQueueItem()]))}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
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

  it('renders queue rows from the configured loader', async () => {
    const queueQueries: QueueListQuery[] = []

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        queueLoader={(query) => {
          queueQueries.push(query)
          return Promise.resolve(createQueueResult([createQueueItem()]))
        }}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))

    const table = await screen.findByRole('table', { name: 'Queue' })

    expect(screen.getByRole('heading', { name: 'Queue' })).toBeInTheDocument()
    expect(within(table).getByText('Versant Media')).toBeInTheDocument()
    expect(within(table).getByText('Academic Year Internships: Platform Engineering')).toBeInTheDocument()
    expect(within(table).getByText('apply_now')).toBeInTheDocument()
    expect(within(table).getByText('Queued score 6 meets policy cutoff 6.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply now 1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Apply now 1' }))

    await waitFor(() => {
      expect(queueQueries.at(-1)).toMatchObject({
        bucket: 'apply_now',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('lets users edit the underlying application from a queue row and reloads queue', async () => {
    const queueItem = createQueueItem()
    const queueLoader = vi
      .fn()
      .mockResolvedValueOnce(createQueueResult([queueItem]))
      .mockResolvedValueOnce(
        createQueueResult([
          createQueueItem({ roleTitle: 'Backend Platform Engineering Intern' }),
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
        primaryLink: queueItem.primaryLink,
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
        queueLoader={queueLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    await screen.findByRole('table', { name: 'Queue' })

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
        term: 'Academic Year internship',
        workMode: 'remote',
      })
      expect(queueLoader).toHaveBeenCalledTimes(2)
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

  it('lets users add and edit sourcing findings from modals', async () => {
    const createFinding = vi.fn(async () => createSourcingFinding({ id: 'finding-new' }))
    const updateFinding = vi.fn(async () =>
      createSourcingFinding({ fitNotes: 'Below current sourcing cutoff.', mergeStatus: 'below_cutoff' }),
    )
    const sourcingLoader = vi.fn(async () => createSourcingResult([createSourcingFinding()]))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        createSourcingFinding={createFinding}
        sourcingLoader={sourcingLoader}
        settingsApi={createSettingsApi()}
        updateSourcingFinding={updateFinding}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    await screen.findByRole('table', { name: 'Sourcing findings' })

    fireEvent.click(screen.getByRole('button', { name: 'Add finding' }))
    const addDialog = await screen.findByRole('dialog', { name: 'Add sourcing finding' })
    fireEvent.change(within(addDialog).getByLabelText('Workflow run'), {
      target: { value: 'run-human' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Company'), {
      target: { value: 'Human Labs' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Role'), {
      target: { value: 'Frontend Engineering Intern' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Source URL'), {
      target: { value: 'https://linkedin.com/jobs/view/human-labs' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Priority score'), {
      target: { value: '7' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Priority band'), {
      target: { value: 'high' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Fit notes'), {
      target: { value: 'Strong frontend internship fit.' },
    })
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Save finding' }))

    await waitFor(() => {
      expect(createFinding).toHaveBeenCalledWith({
        companyName: 'Human Labs',
        fitNotes: 'Strong frontend internship fit.',
        priorityBand: 'high',
        priorityScore: 7,
        roleKind: 'internship',
        roleTitle: 'Frontend Engineering Intern',
        sourceName: 'Manual',
        sourceUrl: 'https://linkedin.com/jobs/view/human-labs',
        workflowRunId: 'run-human',
        workMode: 'remote',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit finding Delta Labs' }))
    const editDialog = await screen.findByRole('dialog', { name: 'Edit sourcing finding' })
    expect(within(editDialog).queryByLabelText('Merge status')).not.toBeInTheDocument()
    fireEvent.change(within(editDialog).getByLabelText('Official URL'), {
      target: { value: 'https://jobs.example.com/delta-updated' },
    })
    fireEvent.change(within(editDialog).getByLabelText('Source URL'), {
      target: { value: 'https://linkedin.com/jobs/view/delta-updated' },
    })
    fireEvent.change(within(editDialog).getByLabelText('Priority score'), {
      target: { value: '4' },
    })
    fireEvent.change(within(editDialog).getByLabelText('Priority band'), {
      target: { value: 'skip' },
    })
    fireEvent.change(within(editDialog).getByLabelText('Fit notes'), {
      target: { value: 'Below current sourcing cutoff.' },
    })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save finding' }))

    await waitFor(() => {
      const updatePayload = updateFinding.mock.calls[0][0]

      expect(updatePayload).toMatchObject({
        fitNotes: 'Below current sourcing cutoff.',
        findingId: 'finding-1',
        officialUrl: 'https://jobs.example.com/delta-updated',
        priorityBand: 'skip',
        priorityScore: 4,
        sourceUrl: 'https://linkedin.com/jobs/view/delta-updated',
      })
      expect(updatePayload).not.toHaveProperty('mergeStatus')
      expect(sourcingLoader).toHaveBeenCalledTimes(3)
    })
  })

  it('uses an explicit decision dialog for manual sourcing dispositions', async () => {
    const decideFinding = vi.fn(async () =>
      createSourcingFinding({
        mergeStatus: 'not_fit',
        mergeNotes: 'Requires a non-student schedule.',
      }),
    )
    const sourcingLoader = vi.fn(async () => createSourcingResult([createSourcingFinding()]))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        decideSourcingFinding={decideFinding}
        sourcingLoader={sourcingLoader}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    await screen.findByRole('table', { name: 'Sourcing findings' })

    fireEvent.click(screen.getByRole('button', { name: 'Set disposition Delta Labs' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set sourcing disposition' })
    fireEvent.change(within(dialog).getByLabelText('Disposition'), {
      target: { value: 'not_fit' },
    })
    fireEvent.change(within(dialog).getByLabelText('Disposition notes'), {
      target: { value: 'Requires a non-student schedule.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save disposition' }))

    await waitFor(() => {
      expect(decideFinding).toHaveBeenCalledWith({
        findingId: 'finding-1',
        mergeNotes: 'Requires a non-student schedule.',
        mergeStatus: 'not_fit',
      })
      expect(sourcingLoader).toHaveBeenCalledTimes(2)
    })
  })

  it('separates promoted and blocked sourcing findings in review', async () => {
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        sourcingLoader={() =>
          Promise.resolve(
            createSourcingResult([
              createSourcingFinding({
                id: 'finding-merged',
                companyName: 'Merged Co',
                mergeStatus: 'merged',
                mergedApplicationId: 'application-merged',
                mergedApplicationCompanyName: 'Merged Co',
                mergedApplicationRoleTitle: 'Software Engineering Intern',
                mergeNotes: 'Merged into application queue.',
              }),
              createSourcingFinding({
                id: 'finding-blocked',
                companyName: 'Blocked Co',
                officialUrl: null,
                sourceUrl: null,
                mergeStatus: 'blocked',
                blocker: 'Missing official URL.',
                mergeNotes: 'Missing official URL.',
              }),
            ]),
          )
        }
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))

    const table = await screen.findByRole('table', { name: 'Sourcing findings' })

    expect(within(table).getByText('Promoted')).toBeInTheDocument()
    expect(within(table).getByText('In application queue')).toBeInTheDocument()
    expect(within(table).getByText('Blocked')).toBeInTheDocument()
    expect(within(table).getByText('Needs source data before promotion')).toBeInTheDocument()
  })

  it('keeps the current table visible while refreshed rows are loading', async () => {
    let loadCount = 0

    render(
      <App
        applicationLoader={() => {
          loadCount += 1

          return loadCount === 1
            ? Promise.resolve(createListResult([createApplication()]))
            : new Promise(() => undefined)
        }}
      />,
    )

    expect(await screen.findByText('Astranis Space Technologies')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'backend' } })

    await waitFor(() => {
      expect(loadCount).toBe(2)
    })

    expect(
      screen.queryByRole('status', { name: 'Applications loading' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByText('Astranis Space Technologies')).toBeInTheDocument()
  })

  it('reloads rows with expanded human filter controls', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'needs_user_info' },
    })
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'company_asc' } })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        status: 'needs_user_info',
        sort: 'company_asc',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('passes created and updated date ranges from the toolbar', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    fireEvent.change(screen.getByLabelText('Created from'), {
      target: { value: '2026-06-01' },
    })
    fireEvent.change(screen.getByLabelText('Created to'), {
      target: { value: '2026-06-02' },
    })
    fireEvent.change(screen.getByLabelText('Updated from'), {
      target: { value: '2026-06-03' },
    })
    fireEvent.change(screen.getByLabelText('Updated to'), {
      target: { value: '2026-06-04' },
    })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        createdFrom: '2026-06-01T00:00:00.000Z',
        createdTo: '2026-06-02T23:59:59.999Z',
        updatedFrom: '2026-06-03T00:00:00.000Z',
        updatedTo: '2026-06-04T23:59:59.999Z',
      })
    })
  })

  it('places reset in a separate expanded filter action row', async () => {
    render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))} />)

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))

    const actions = screen.getByRole('group', { name: 'Filter actions' })

    expect(
      within(actions).getByRole('button', { name: 'Reset filters' }),
    ).toBeInTheDocument()
  })

  it('clears filters with reset', async () => {
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

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'astranis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'needs_user_info' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))

    await waitFor(() => {
      expect(queries.at(-1)).toEqual({
        limit: 50,
        offset: 0,
        sort: 'priority_desc',
      })
    })
  })

  it('pages through application results', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve({
            ...createListResult([createApplication()]),
            total: 80,
            offset: query.offset ?? 0,
            hasMore: (query.offset ?? 0) + 50 < 80,
          })
        }}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({ offset: 50, limit: 50 })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({ offset: 0, limit: 50 })
    })
  })

  it('reloads rows when sortable table headers are clicked', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Sort by company' }))

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        sort: 'company_asc',
        limit: 50,
        offset: 0,
      })
    })
  })

  it('hides optional columns from the table without reloading rows', async () => {
    const queries: ApplicationListQuery[] = []

    render(
      <App
        applicationLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createListResult([createApplication()]))
        }}
      />,
    )

    const table = await screen.findByRole('table', { name: 'Applications' })
    const initialQueryCount = queries.length

    expect(within(table).getByText('LinkedIn')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source column' }))

    expect(within(table).queryByText('LinkedIn')).not.toBeInTheDocument()
    expect(queries).toHaveLength(initialQueryCount)
  })

  it('tracks selected rows locally', async () => {
    render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))} />)

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByText('0 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Astranis Space Technologies' }))

    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('virtualizes rows inside the current page and reveals later rows on scroll', async () => {
    const applications = Array.from({ length: 80 }, (_, index) =>
      createApplication({
        id: `application-${index}`,
        companyName: `Company ${index}`,
        roleTitle: `Role ${index}`,
        primaryLink: null,
      }),
    )

    render(<App applicationLoader={() => Promise.resolve(createListResult(applications))} />)

    const viewport = await screen.findByRole('region', {
      name: 'Applications table viewport',
    })
    const table = screen.getByRole('table', { name: 'Applications' })

    expect(within(table).getByText('Company 0')).toBeInTheDocument()
    expect(within(table).queryByText('Company 40')).not.toBeInTheDocument()

    fireEvent.scroll(viewport, {
      target: {
        scrollTop: 40 * 54,
      },
    })

    await waitFor(() => {
      expect(within(table).getByText('Company 40')).toBeInTheDocument()
    })
  })

  it('lets the applications table viewport fill the available page height', async () => {
    const applications = Array.from({ length: 80 }, (_, index) =>
      createApplication({
        id: `application-${index}`,
        companyName: `Company ${index}`,
        roleTitle: `Role ${index}`,
        primaryLink: null,
      }),
    )

    render(<App applicationLoader={() => Promise.resolve(createListResult(applications))} />)

    const viewport = await screen.findByRole('region', {
      name: 'Applications table viewport',
    })
    const tableCard = viewport.parentElement
    const pageSection = tableCard?.parentElement
    const main = viewport.closest('main')

    expect(main).toHaveClass('flex', 'h-[calc(100vh-3rem)]')
    expect(main).not.toHaveClass('min-h-[calc(100vh-3rem)]')
    expect(pageSection).toHaveClass('flex-1', 'min-h-0')
    expect(tableCard).toHaveClass('flex-1', 'min-h-0')
    expect(viewport).toHaveClass('flex-1', 'min-h-0')
    expect(viewport).not.toHaveClass('max-h-[420px]')
  })
})
