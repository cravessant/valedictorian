import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
      providerId: null,
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
      providerRecordId: null,
      providerSchema: null,
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
  it('exposes Normalization beside Findings and keeps sparse raw captures visible', async () => {
    renderApp()
    await screen.findByRole('table', { name: 'Applications' })
    const navigation = within(
      screen.getByRole('navigation', { name: 'Application views' }),
    )
    fireEvent.click(navigation.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(navigation.getByRole('button', { name: 'Normalization' }))

    expect(navigation.getByRole('button', { name: 'Findings' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Raw sourcing normalization' })
    const row = within(table).getByRole('button', { name: /raw-record-1/i }).closest('tr')!
    expect(row).toHaveTextContent('Jobright')
    expect(row).toHaveTextContent('Missing title')
    expect(row).toHaveTextContent('Missing company')
    expect(row).toHaveTextContent('Raw only')
    expect(row).toHaveTextContent('Not evaluated')
    expect(row).toHaveTextContent('Not projected')
  })

  it('queries the public list contract with connector, received, lifecycle, and projection filters', async () => {
    const rawRecordsApi = renderApp()
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))
    await screen.findByRole('table', { name: 'Raw sourcing normalization' })

    fireEvent.change(screen.getByLabelText('Source adapter'), {
      target: { value: 'jobright' },
    })
    fireEvent.change(screen.getByLabelText('Capture kind'), {
      target: { value: 'connector' },
    })
    fireEvent.change(screen.getByLabelText('Connector instance'), {
      target: { value: 'jobright-default' },
    })
    fireEvent.change(screen.getByLabelText('Received from'), {
      target: { value: '2026-07-01' },
    })
    fireEvent.change(screen.getByLabelText('Received to'), {
      target: { value: '2026-07-10' },
    })
    fireEvent.change(screen.getByLabelText('Normalization status'), {
      target: { value: 'completed' },
    })
    fireEvent.change(screen.getByLabelText('Admission gate status'), {
      target: { value: 'needs_enrichment' },
    })
    fireEvent.change(screen.getByLabelText('Projection status'), {
      target: { value: 'not_eligible' },
    })

    await waitFor(() => expect(rawRecordsApi.list).toHaveBeenLastCalledWith({
      adapterId: 'jobright',
      adapterKind: 'connector',
      connectorInstanceId: 'jobright-default',
      gateStatus: 'needs_enrichment',
      limit: 50,
      normalizationStatus: 'completed',
      projectionStatus: 'not_eligible',
      receivedFrom: '2026-07-01T00:00:00.000Z',
      receivedTo: '2026-07-10T23:59:59.999Z',
    }))
  })

  it('paginates with opaque cursors and returns to the prior page', async () => {
    const list = vi.fn(async (query?: { cursor?: string }) => query?.cursor === 'next-page'
      ? { items: [createRawSummary({ id: 'raw-record-2' })], nextCursor: null }
      : { items: [createRawSummary()], nextCursor: 'next-page' })
    renderApp({ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() })
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))
    await screen.findByRole('button', { name: /raw-record-1/i })

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('button', { name: /raw-record-2/i })).toBeInTheDocument()
    expect(list).toHaveBeenLastCalledWith({ cursor: 'next-page', limit: 50 })

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByRole('button', { name: /raw-record-1/i })).toBeInTheDocument()
    expect(list).toHaveBeenLastCalledWith({ limit: 50 })
  })

  it('announces an empty normalization result without hiding the filters', async () => {
    renderApp({
      list: vi.fn(async () => ({ items: [], nextCursor: null })),
      get: vi.fn(),
      getNormalization: vi.fn(),
      getProjection: vi.fn(),
    })
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))

    expect(await screen.findByRole('status', {
      name: 'No raw sourcing records match the current filters',
    })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Raw sourcing filters' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Raw sourcing normalization' })).not.toBeInTheDocument()
  })

  it('announces list failures and retries through the same public query', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('unsafe upstream details'))
      .mockResolvedValueOnce({ items: [createRawSummary()], nextCursor: null })
    renderApp({ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() })
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))

    const alert = await screen.findByRole('alert', { name: 'Raw sourcing records unavailable' })
    expect(alert).toHaveTextContent('Raw sourcing records could not be loaded.')
    expect(alert).not.toHaveTextContent('unsafe upstream details')
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: /raw-record-1/i })).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows truthful latest-revision facts and occurrence lineage without sensitive or unsafe values', async () => {
    const get = vi.fn(async () => createRawRecord())
    const getNormalization = vi.fn()
    renderApp({
      list: vi.fn(async () => ({ items: [createRawSummary()], nextCursor: null })),
      get,
      getNormalization,
      getProjection: vi.fn(async () => createNotEligibleProjection()),
    })
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))
    fireEvent.click(await screen.findByRole('button', { name: /raw-record-1/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Raw record raw-record-1' })
    expect(within(dialog).getByRole('heading', { name: 'Latest revision facts' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Platform Engineer')
    expect(dialog).toHaveTextContent('Example Co')
    expect(dialog).toHaveTextContent('Missing location')
    expect(dialog).toHaveTextContent('Missing description')
    expect(dialog).toHaveTextContent('https://jobs.example.test/platform')
    expect(within(dialog).getByRole('table', { name: 'Occurrence and revision lineage' }))
      .toHaveTextContent('occurrence-1')
    expect(dialog).toHaveTextContent('raw-revision-1')
    expect(dialog).toHaveTextContent('connector-run-1')
    expect(dialog).not.toHaveTextContent(/credential|password|authorization|cookie/i)
    expect(dialog).not.toHaveTextContent('never-render-this')
    expect(dialog).not.toHaveTextContent('javascript:')
    expect(get).toHaveBeenCalledWith('raw-record-1')
    expect(getNormalization).toHaveBeenCalledWith('raw-record-1')
  })

  it('explains resolver provenance, conflicts, abstentions, and the exact admission reason', async () => {
    const summary = createRawSummary({
      normalizationStatus: 'completed',
      normalizationUpdatedAt: '2026-07-10T12:00:03.000Z',
      normalizationRawRevisionId: 'raw-revision-1',
      gateStatus: 'needs_enrichment',
      projectionStatus: 'not_eligible',
    })
    const getNormalization = vi.fn(async () => createNeedsEnrichmentNormalization())
    renderApp({
      list: vi.fn(async () => ({ items: [summary], nextCursor: null })),
      get: vi.fn(async () => createRawRecord()),
      getNormalization,
      getProjection: vi.fn(async () => createNotEligibleProjection({
        normalizationStatus: 'completed', gateStatus: 'needs_enrichment',
      })),
    })
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))
    fireEvent.click(await screen.findByRole('button', { name: /raw-record-1/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Raw record raw-record-1' })
    const outcomes = within(dialog).getByRole('region', { name: 'Normalization resolver outcomes' })
    expect(outcomes).toHaveTextContent('jobright.raw@2.1.0')
    expect(outcomes).toHaveTextContent('Role title')
    expect(outcomes).toHaveTextContent('Resolved')
    expect(outcomes).toHaveTextContent('Destination URL')
    expect(outcomes).toHaveTextContent('Conflict')
    expect(outcomes).toHaveTextContent('Provider supplied competing destinations.')
    expect(outcomes).toHaveTextContent('Compensation')
    expect(outcomes).toHaveTextContent('Abstained')

    const gate = within(dialog).getByRole('region', { name: 'Sourcing admission gate' })
    expect(gate).toHaveTextContent('Needs enrichment')
    expect(gate).toHaveTextContent('Company is missing and destination conflicts.')
    expect(gate).toHaveTextContent('Missing: Company name')
    expect(gate).toHaveTextContent('Conflicting: Destination URL')
    expect(gate).toHaveTextContent('normalization-gate@1')
    expect(dialog).toHaveTextContent('No canonical candidate')
    expect(dialog).toHaveTextContent('Not eligible for projection')
    expect(getNormalization).toHaveBeenCalledWith('raw-record-1')
  })

  it('keeps normalization, gate, candidate, and finding projection as separate lifecycle columns', async () => {
    const projected = createRawSummary({
      id: 'raw-projected',
      normalizationStatus: 'completed', normalizationUpdatedAt: '2026-07-10T12:00:03.000Z',
      normalizationRawRevisionId: 'raw-revision-1', gateStatus: 'passed',
      canonicalCandidateId: 'candidate-1', projectionStatus: 'projected', findingId: 'finding-1',
    })
    const rejected = createRawSummary({
      id: 'raw-rejected',
      normalizationStatus: 'completed', normalizationUpdatedAt: '2026-07-10T12:00:03.000Z',
      normalizationRawRevisionId: 'raw-revision-1', gateStatus: 'rejected',
      canonicalCandidateId: null, projectionStatus: 'not_eligible', findingId: null,
    })
    renderApp({
      list: vi.fn(async () => ({ items: [projected, rejected], nextCursor: null })),
      get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn(),
    })
    await screen.findByRole('table', { name: 'Applications' })
    fireEvent.click(screen.getByRole('button', { name: 'Sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalization' }))

    const table = await screen.findByRole('table', { name: 'Raw sourcing normalization' })
    expect(within(table).getByRole('columnheader', { name: 'Canonical candidate' }))
      .toBeInTheDocument()
    const projectedRow = within(table).getByRole('button', { name: /raw-projected/i })
      .closest('tr')!
    expect(projectedRow).toHaveTextContent('Completed')
    expect(projectedRow).toHaveTextContent('Passed')
    expect(projectedRow).toHaveTextContent('candidate-1')
    expect(projectedRow).toHaveTextContent('finding-1')
    const rejectedRow = within(table).getByRole('button', { name: /raw-rejected/i })
      .closest('tr')!
    expect(rejectedRow).toHaveTextContent('Rejected')
    expect(rejectedRow).toHaveTextContent('No candidate')
    expect(rejectedRow).toHaveTextContent('Not projected')
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

    expect(await screen.findByRole('button', { name: /raw-from-run/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /raw-from-other-run/i })).not.toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: /raw-record-1/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Raw record raw-record-1' })
    const destination = within(dialog).getByRole('link', { name: 'Open canonical destination' })
    expect(destination).toHaveAttribute('href', 'https://jobs.example.test/platform')
    expect(dialog).not.toHaveTextContent('javascript:')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open finding finding-51' }))

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-view', 'sourcing')
    expect(screen.queryByRole('dialog', { name: 'Raw record raw-record-1' })).not.toBeInTheDocument()
    const focusedRow = await screen.findByRole('row', {
      name: 'Focused sourcing finding finding-51',
    })
    expect(focusedRow).toHaveTextContent('Located Target Co')
    expect(focusedRow).toHaveFocus()
  })
})
