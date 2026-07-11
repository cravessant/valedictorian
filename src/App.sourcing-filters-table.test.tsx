import {
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
import type { SourcingFinding, SourcingFindingsListInput } from 'sparxie'
import {
  createApplication,
  createListResult,
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
  it('distinguishes employer, third-party, and review-only sourcing destinations', async () => {
    const queries: SourcingFindingsListInput[] = []
    const canonicalFullTime = {
      ...createSourcingFinding({ id: 'finding-canonical', companyName: 'Canonical Co' }),
      rawRevisionId: 'raw-revision-1',
      canonicalCandidateId: 'canonical-candidate-1',
      destination: {
        class: 'employer_or_ats',
        url: 'https://jobs.lever.co/canonical/role-1',
      },
      employmentType: 'full_time',
      seniority: 'internship',
      location: null,
      compensation: null,
      postedAt: { value: null, precision: 'unknown', raw: null },
    } as unknown as SourcingFinding

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        sourcingLoader={(query) => {
          queries.push(query)
          return Promise.resolve(createSourcingResult([
            createSourcingFinding({
              id: 'finding-employer',
              companyName: 'Employer Co',
              destinationClass: 'employer_or_ats',
              destinationUrl: 'https://jobs.lever.co/employer/role-1',
              intermediaryUrl: 'https://jobright.ai/jobs/info/employer-1',
              officialUrl: 'https://jobs.lever.co/employer/role-1',
              sourceUrl: 'https://jobright.ai/jobs/info/employer-1',
              usability: 'usable',
            }),
            createSourcingFinding({
              id: 'finding-third-party',
              companyName: 'Third Party Co',
              destinationClass: 'third_party_job_posting',
              destinationUrl: 'https://www.linkedin.com/jobs/view/123456',
              intermediaryUrl: 'https://jobright.ai/jobs/info/third-party-1',
              officialUrl: null,
              sourceUrl: 'https://www.linkedin.com/jobs/view/123456',
              usability: 'review_only',
              mergeStatus: 'blocked',
              policyBlocker: 'third_party_destination',
            }),
            createSourcingFinding({
              id: 'finding-review',
              companyName: 'Review Co',
              destinationClass: null,
              destinationUrl: null,
              intermediaryUrl: 'https://jobright.ai/jobs/info/review-1',
              officialUrl: null,
              sourceUrl: 'https://jobright.ai/jobs/info/review-1',
              usability: 'review_only',
              mergeStatus: 'blocked',
            }),
            canonicalFullTime,
          ]))
        }}
        settingsApi={createSettingsApi()}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    const table = await screen.findByRole('table', { name: 'Sourcing findings' })

    expect(within(table).getByText('Employer / ATS')).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'third-party' })).toBeInTheDocument()
    expect(within(table).getAllByText('Review only')).toHaveLength(2)
    expect(within(table).getByText('Full Time')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Promote Review Co' })).not.toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Promote Third Party Co' }))
      .toHaveTextContent('Approve & promote')

    fireEvent.change(screen.getByLabelText('Destination class'), {
      target: { value: 'third_party_job_posting' },
    })
    fireEvent.change(screen.getByLabelText('Usability'), { target: { value: 'usable' } })

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        destinationClass: 'third_party_job_posting',
        usability: 'usable',
      })
    })
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
    fireEvent.change(within(addDialog).getByLabelText('Role kind'), {
      target: { value: 'full_time' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Source URL'), {
      target: { value: 'https://linkedin.com/jobs/view/human-labs' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Timing mode'), {
      target: { value: 'dates' },
    })
    fireEvent.change(within(addDialog).getByLabelText('Start date'), {
      target: { value: '2027-05-15' },
    })
    fireEvent.change(within(addDialog).getByLabelText('End date'), {
      target: { value: '2027-09-01' },
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
        timingMode: 'dates',
        startDate: '2027-05-15',
        endDate: '2027-09-01',
        priorityBand: 'high',
        priorityScore: 7,
        roleKind: 'full_time',
        roleTitle: 'Frontend Engineering Intern',
        sourceName: 'Manual',
        sourceUrl: 'https://linkedin.com/jobs/view/human-labs',
        workflowRunId: 'run-human',
        workMode: 'unclear',
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
    fireEvent.change(within(editDialog).getByLabelText('Role kind'), {
      target: { value: 'new_grad' },
    })
    fireEvent.change(within(editDialog).getByLabelText('Timing mode'), {
      target: { value: 'dates' },
    })
    fireEvent.change(within(editDialog).getByLabelText('Start date'), {
      target: { value: '2027-06-01' },
    })
    fireEvent.change(within(editDialog).getByLabelText('End date'), {
      target: { value: '2027-08-15' },
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
        roleKind: 'new_grad',
        sourceUrl: 'https://linkedin.com/jobs/view/delta-updated',
        timingMode: 'dates',
        startDate: '2027-06-01',
        endDate: '2027-08-15',
      })
      expect(updatePayload).not.toHaveProperty('mergeStatus')
      expect(sourcingLoader).toHaveBeenCalledTimes(3)
    })
  })

  it('uses an explicit decision dialog for manual sourcing dispositions', async () => {
    const decideFinding = vi.fn(async () =>
      createSourcingFinding({
        dispositionReason: 'Needs sponsorship decision.',
        mergeStatus: 'blocked',
        mergeNotes: 'Requires a non-student schedule.',
        policyBlocker: 'needs_user_decision',
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
      target: { value: 'blocked' },
    })
    fireEvent.change(within(dialog).getByLabelText('Disposition reason'), {
      target: { value: 'Needs sponsorship decision.' },
    })
    fireEvent.change(within(dialog).getByLabelText('Policy blocker'), {
      target: { value: 'needs_user_decision' },
    })
    fireEvent.change(within(dialog).getByLabelText('Disposition notes'), {
      target: { value: 'Requires a non-student schedule.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save disposition' }))

    await waitFor(() => {
      expect(decideFinding).toHaveBeenCalledWith({
        dispositionReason: 'Needs sponsorship decision.',
        findingId: 'finding-1',
        mergeNotes: 'Requires a non-student schedule.',
        mergeStatus: 'blocked',
        policyBlocker: 'needs_user_decision',
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
                mergeNotes: 'Merged into applications.',
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
    expect(within(table).getByText('In applications')).toBeInTheDocument()
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

  it('keeps compact filter controls visually aligned', async () => {
    render(<App applicationLoader={() => Promise.resolve(createListResult([createApplication()]))} />)

    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByLabelText('Search')).toHaveClass('h-9', 'rounded-md')
    expect(screen.getByRole('button', { name: 'Show filters' })).toHaveClass(
      'h-9',
      'w-9',
      'rounded-md',
    )
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

    const table = await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByText('0 selected')).toBeInTheDocument()

    const pageCheckbox = within(table).getByRole('checkbox', {
      name: 'Select all applications on page',
    })
    const rowCheckbox = within(table).getByRole('checkbox', {
      name: 'Select Astranis Space Technologies',
    })

    expect(pageCheckbox).toHaveClass('mx-auto', 'block', 'h-4', 'w-4')
    expect(pageCheckbox.closest('th')).toHaveClass('px-0', 'text-center')

    fireEvent.click(rowCheckbox)

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

    expect(main).toHaveClass('flex', 'h-full', 'md:h-[calc(100vh-3rem)]')
    expect(main).not.toHaveClass('min-h-[calc(100vh-3rem)]')
    expect(pageSection).toHaveClass('flex-1', 'min-h-0')
    expect(tableCard).toHaveClass('flex-1', 'min-h-0')
    expect(viewport).toHaveClass('flex-1', 'min-h-0')
    expect(viewport).not.toHaveClass('max-h-[420px]')
  })
})
