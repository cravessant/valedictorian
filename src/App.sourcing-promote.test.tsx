import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourcingFindingsListInput } from 'sparxie'
import App from './App'
import {
  createApplication,
  createApplicationDetail,
  createAttemptResult,
  createListResult,
  createSettingsApi,
  createSourcingFinding,
  createSourcingResult,
  selectComboboxOption,
  stubCmdkEnvironment,
} from './App.test-helpers'

beforeEach(() => {
  stubCmdkEnvironment()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
})

describe('App sourcing promote after filter query changes', () => {
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

    const table = await screen.findByRole('table', { name: 'Opportunities' })

    expect(screen.getByRole('heading', { name: 'Opportunities' })).toBeInTheDocument()
    expect(within(table).getByText('Delta Labs')).toBeInTheDocument()
    expect(within(table).getAllByText('Fall 2026').length).toBeGreaterThan(0)
    expect(within(table).getByText('Software Engineering Intern')).toBeInTheDocument()
    expect(within(table).getAllByText('LinkedIn')).toHaveLength(2)
    expect(within(table).queryByText('run-1')).not.toBeInTheDocument()
    expect(within(table).getByText('new')).toBeInTheDocument()
    expect(within(table).getByText('Ready to review')).toBeInTheDocument()
    expect(within(table).getAllByText('7/10')).toHaveLength(2)
    expect(within(table).queryByText('application-versant-platform')).not.toBeInTheDocument()
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

    expect(sourceFilter).toHaveTextContent('Any source')
    fireEvent.click(sourceFilter)
    expect(screen.getByRole('option', { name: 'Any source' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'LinkedIn' })).toBeInTheDocument()
    fireEvent.keyDown(sourceFilter, { key: 'Escape' })

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

    selectComboboxOption('Source', 'LinkedIn')

    await waitFor(() => {
      expect(queries.at(-1)).toMatchObject({
        limit: 50,
        mergeStatus: 'new',
        offset: 0,
        sourceId: 'source-linkedin',
      })
    })
    expect(screen.getByRole('combobox', { name: 'Source' })).toHaveTextContent('LinkedIn')

    const currentTable = await screen.findByRole('table', { name: 'Opportunities' })
    fireEvent.click(within(currentTable).getByRole('button', { name: 'Promote Delta Labs' }))

    await waitFor(() => {
      expect(promoteFinding).toHaveBeenCalledWith({ findingId: 'finding-1' })
    })

    fireEvent.click(within(currentTable).getByRole('button', { name: 'Open app Versant Media' }))

    await waitFor(() => {
      expect(detailQueries).toContain('application-versant-platform')
      expect(attemptQueries).toContain('application-versant-platform')
    })
    const dialog = await screen.findByRole('dialog', { name: 'Application detail' })

    expect(within(dialog).getByText('Versant Media')).toBeInTheDocument()
    expect(within(dialog).getByText('Academic Year Internships: Platform Engineering')).toBeInTheDocument()
  })
})
