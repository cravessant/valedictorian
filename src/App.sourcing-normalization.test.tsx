import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RawSourceProjectionResult,
  RawSourceRecord,
  RawSourceRecordSummary,
} from 'sparxie'
import {
  createNeedsEnrichmentNormalization,
  createPassedNormalization,
} from './modules/sourcing/raw-normalization.test-fixtures'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createSettingsApi,
  createSourcingFinding,
} from './App.test-helpers'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function createRawSummary(
  overrides: Partial<RawSourceRecordSummary> = {},
): RawSourceRecordSummary {
  return {
    id: 'raw-record-1',
    sourceEntityId: null,
    adapter: { id: 'jobright', kind: 'connector', version: '0.11.0' },
    connectorInstanceId: 'jobright-default',
    latestConnectorRunId: 'connector-run-1',
    reportedOrigin: { kind: 'job_board', name: 'Jobright', providerId: null },
    providerRecordId: null,
    companyName: null,
    roleTitle: null,
    createdAt: '2026-07-10T12:00:00.000Z',
    firstObservedAt: '2026-07-10T11:30:00.000Z',
    lastObservedAt: '2026-07-10T11:45:00.000Z',
    firstReceivedAt: '2026-07-10T12:00:00.000Z',
    lastReceivedAt: '2026-07-10T12:05:00.000Z',
    occurrenceCount: 2,
    revisionCount: 1,
    latestRevision: {
      id: 'raw-revision-1',
      revision: 1,
      observedAt: '2026-07-10T11:45:00.000Z',
      createdAt: '2026-07-10T12:00:00.000Z',
    },
    normalizationStatus: 'raw_only',
    normalizationUpdatedAt: null,
    normalizationRawRevisionId: null,
    gateStatus: null,
    canonicalCandidateId: null,
    projectionStatus: 'not_eligible',
    findingId: null,
    ...overrides,
  } as RawSourceRecordSummary
}
function createRawRecord(): RawSourceRecord {
  return {
    id: 'raw-record-1',
    sourceEntityId: null,
    adapter: { id: 'jobright', kind: 'connector', version: '0.11.0' },
    reportedOrigin: {
      kind: 'job_board',
      name: 'Jobright',
      providerId: 'jobright-provider',
      url: 'javascript:alert(document.cookie)',
    },
    createdAt: '2026-07-10T12:00:00.000Z',
    latestRevision: {
      id: 'raw-revision-1',
      rawRecordId: 'raw-record-1',
      revision: 1,
      contentHash: 'sha256:safe-hash',
      adapter: { id: 'jobright', kind: 'connector', version: '0.11.0' },
      reportedOrigin: null,
      observedAt: '2026-07-10T11:45:00.000Z',
      providerRecordId: 'provider-job-123',
      providerSchema: 'jobright-visitor-list@1',
      payload: {
        title: 'Platform Engineer',
        company: 'Example Co',
        location: null,
        description: null,
        applicationUrl: 'https://jobs.example.test/platform',
        unsafeUrl: 'javascript:alert(1)',
        credentials: { password: 'never-render-this' },
        Authorization: 'Bearer never-render-this',
        cookie: 'session=never-render-this',
      },
      evidence: [
        { kind: 'provider', label: 'Listing title', value: 'Platform Engineer' },
        { kind: 'request', label: 'Cookie', value: 'session=never-render-this' },
      ],
      createdAt: '2026-07-10T12:00:00.000Z',
    },
    occurrences: [
      {
        id: 'occurrence-1',
        rawRecordId: 'raw-record-1',
        rawRevisionId: 'raw-revision-1',
        capture: {
          connectorInstanceId: 'jobright-default',
          connectorRunId: 'connector-run-1',
          executionScopeId: 'scope-1',
        },
        observedAt: '2026-07-10T11:45:00.000Z',
        receivedAt: '2026-07-10T12:00:00.000Z',
      },
    ],
  }
}
function createNotEligibleProjection(overrides: Partial<RawSourceProjectionResult> = {}) {
  return {
    rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
    status: 'not_eligible', normalizationStatus: null, canonicalCandidateId: null,
    gateStatus: null, updatedAt: '2026-07-10T12:00:04.000Z',
    ...overrides,
  } as RawSourceProjectionResult
}
function createProjectedProjection(findingId: string): RawSourceProjectionResult {
  return {
    rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
    status: 'projected', normalizationStatus: 'completed', gateStatus: 'passed',
    canonicalCandidateId: 'candidate-1', projectedAt: '2026-07-10T12:00:04.000Z',
    updatedAt: '2026-07-10T12:00:04.000Z',
    finding: { id: findingId, mergeStatus: 'new', mergedApplicationId: null },
  }
}
function renderApp(rawRecordsApi = {
  list: vi.fn(async () => ({ items: [createRawSummary()], nextCursor: null })),
  get: vi.fn(),
  getNormalization: vi.fn(),
  getProjection: vi.fn(async () => createNotEligibleProjection()),
}) {
  render(
    <App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      rawRecordsApi={rawRecordsApi}
      settingsApi={createSettingsApi()}
    />,
  )
  return rawRecordsApi
}
describe('sourcing normalization inspection', () => {
  it('exposes Normalization beside Opportunities and keeps sparse Captures visible', async () => {
    renderApp()
    await screen.findByRole('table', { name: 'Applications' })
    const navigation = within(
      screen.getByRole('navigation', { name: 'Application views' }),
    )
    fireEvent.click(navigation.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(navigation.getByRole('button', { name: 'Normalization' }))

    expect(navigation.getByRole('button', { name: 'Opportunities' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Capture-to-Job normalization' })
    const row = within(table).getByRole('button', { name: 'Inspect Capture lineage' }).closest('tr')!
    expect(row).toHaveTextContent('Jobright')
    expect(row).toHaveTextContent('Missing title')
    expect(row).toHaveTextContent('Missing company')
    expect(row).toHaveTextContent('Raw only')
    expect(row).toHaveTextContent('Not evaluated')
    expect(row).toHaveTextContent('Not projected')
  })

  it('requests exact raw rows for an aggregate connector run', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-default', connectorId: 'jobright', connectorVersion: '0.11.0',
      displayName: 'Jobright', enabled: true,
    })
    const run = await connectorsApi.runs.trigger({ connectorInstanceId: 'jobright-default' })
    vi.mocked(connectorsApi.runs.list).mockResolvedValue({
      items: [run], total: 1, limit: 20, offset: 0, hasMore: false,
    })
    const rawList = vi.fn(async () => ({
      items: [createRawSummary({ id: 'raw-from-run', latestConnectorRunId: 'newer-run' })],
      nextCursor: null,
    }))
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        rawRecordsApi={{
          list: rawList,
          get: vi.fn(async () => ({
            ...createRawRecord(),
            occurrences: [{
              ...createRawRecord().occurrences[0],
              capture: {
                ...createRawRecord().occurrences[0].capture!,
                connectorRunId: 'other-run',
              },
            }],
          })),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        settingsApi={createSettingsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Applications' })
    const navigation = within(screen.getByRole('navigation', { name: 'Application views' }))
    fireEvent.click(navigation.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(navigation.getByRole('button', { name: 'Runs' }))

    const runArticle = await screen.findByRole('article')
    fireEvent.click(within(runArticle).getByRole('button', {
      name: `Inspect normalization rows from ${run.id}`,
    }))

    expect(await screen.findByRole('button', { name: 'Inspect Capture lineage' })).toBeInTheDocument()
    expect(screen.queryByText('raw-from-other-run')).not.toBeInTheDocument()
    expect(rawList).toHaveBeenCalledOnce()
    expect(rawList).toHaveBeenCalledWith({
      connectorInstanceId: 'jobright-default', connectorRunId: run.id, limit: 50,
    })
    expect(screen.getByRole('status', { name: `Filtered to connector run ${run.id}` }))
      .toBeInTheDocument()
  })

  it('links a passed candidate safely and opens its projected sourcing finding', async () => {
    const targetFinding = createSourcingFinding({
      id: 'finding-51', companyName: 'Located Target Co',
    })
    const sourcingLoader = vi.fn(async (query?: { offset?: number; limit?: number }) => query?.offset === 50
      ? { items: [targetFinding], total: 51, limit: 50, offset: 50, hasMore: false }
      : {
          items: [createSourcingFinding({ id: 'finding-other', companyName: 'Other Co' })],
          total: 51, limit: 50, offset: 0, hasMore: true,
        })
    const summary = createRawSummary({
      normalizationStatus: 'completed', normalizationUpdatedAt: '2026-07-10T12:00:03.000Z',
      normalizationRawRevisionId: 'raw-revision-1', gateStatus: 'passed',
      canonicalCandidateId: 'candidate-1', projectionStatus: 'projected', findingId: 'finding-51',
    })
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        sourcingLoader={sourcingLoader}
        rawRecordsApi={{
          list: vi.fn(async () => ({ items: [summary], nextCursor: null })),
          get: vi.fn(async () => createRawRecord()),
          getNormalization: vi.fn(async () => createPassedNormalization(createNeedsEnrichmentNormalization())),
          getProjection: vi.fn(async () => createProjectedProjection('finding-51')),
        }}
        settingsApi={createSettingsApi()}
      />,
    )
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Capture lineage' }))

    const dialog = await screen.findByRole('dialog', { name: 'Capture lineage raw-record-1' })
    const destination = within(dialog).getByRole('link', { name: 'Open canonical destination' })
    expect(destination).toHaveAttribute('href', 'https://jobs.example.test/platform')
    expect(dialog).not.toHaveTextContent('javascript:')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Opportunity finding-51' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'sourcing')
    expect(screen.queryByRole('dialog', { name: 'Capture lineage raw-record-1' })).not.toBeInTheDocument()
    const focusedRow = await screen.findByRole('row', {
      name: 'Focused Opportunity finding-51',
    })
    expect(focusedRow).toHaveTextContent('Located Target Co')
    expect(focusedRow).toHaveFocus()
  })
})
