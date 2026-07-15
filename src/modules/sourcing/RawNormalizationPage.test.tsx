import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RawSourceRecordSummary } from 'sparxie'
import { RawNormalizationPage } from './RawNormalizationPage'

afterEach(cleanup)

describe('RawNormalizationPage connector-run inspection', () => {
  it('delegates exact any-occurrence connector-run lineage to one list request', async () => {
    const item = {
      id: 'raw-from-older-run',
      latestConnectorRunId: 'newer-run',
      adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
      reportedOrigin: null,
      providerRecordId: null,
      roleTitle: 'Older run record',
      companyName: null,
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 2,
      revisionCount: 1,
      normalizationStatus: 'raw_only',
      gateStatus: null,
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary
    const list = vi.fn(async () => ({ items: [item], nextCursor: null }))
    const get = vi.fn()

    render(
      <RawNormalizationPage
        api={{ list, get, getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
        runFilter={{ connectorInstanceId: 'jobright-default', connectorRunId: 'older-run' }}
      />,
    )

    expect(await screen.findByText('Older run record')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      connectorInstanceId: 'jobright-default',
      connectorRunId: 'older-run',
    }))
    expect(get).not.toHaveBeenCalled()
  })

  it('announces its deterministic loading state accessibly', () => {
    render(
      <RawNormalizationPage
        api={{
          list: vi.fn(() => new Promise(() => undefined)),
          get: vi.fn(),
          getNormalization: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    expect(screen.getByRole('status', { name: 'Loading Capture lineages' }))
      .toHaveTextContent('Loading Capture lineages')
  })

  it('hides stale actions during query changes and ignores an older response that finishes last', async () => {
    const staleRequest = deferredListResult()
    const currentRequest = deferredListResult()
    const summary = (id: string) => ({
      id, adapter: { id: 'jobright' }, reportedOrigin: null,
      providerRecordId: null, roleTitle: id, companyName: null,
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1, revisionCount: 1, normalizationStatus: 'raw_only',
      gateStatus: null, canonicalCandidateId: null, projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary)
    const list = vi.fn((query: { adapterId?: string }) => {
      if (query.adapterId === 'first-filter') return staleRequest.promise
      if (query.adapterId === 'second-filter') return currentRequest.promise
      return Promise.resolve({ items: [summary('old-row')], nextCursor: null })
    })

    render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn() }}
        contentColumnClass=""
      />,
    )

    expect(await screen.findByRole('button', { name: 'Inspect Capture lineage' }))
      .toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Source adapter' }), {
      target: { value: 'first-filter' },
    })
    expect(screen.getByRole('status', { name: 'Loading Capture lineages' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inspect Capture lineage' }))
      .not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Source adapter' }), {
      target: { value: 'second-filter' },
    })
    await act(async () => {
      currentRequest.resolve({ items: [summary('current-row')], nextCursor: null })
      await currentRequest.promise
    })
    expect(await screen.findByRole('button', { name: 'Inspect Capture lineage' }))
      .toBeInTheDocument()

    await act(async () => {
      staleRequest.resolve({ items: [summary('stale-row')], nextCursor: null })
      await staleRequest.promise
    })
    expect(screen.getByRole('button', { name: 'Inspect Capture lineage' }))
      .toBeInTheDocument()
    expect(screen.queryByText('stale-row')).not.toBeInTheDocument()
  })

  it('redacts sensitive ordinary strings from table content and accessible row labels', async () => {
    const item = {
      id: 'see https://user:private-value@jobs.example.test/platform',
      adapter: { id: 'note secret=private-value' },
      reportedOrigin: { name: 'open javascript:private-value' },
      roleTitle: 'Apply at https://jobs.example.test/platform today',
      companyName: 'credential=private-value',
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1, revisionCount: 1, normalizationStatus: 'completed',
      gateStatus: 'passed', canonicalCandidateId: 'auth=private-value',
      projectionStatus: 'projected',
      findingId: 'https://jobs.example.test/platform#secret=private-value',
    } as RawSourceRecordSummary

    render(
      <RawNormalizationPage
        api={{
          list: vi.fn(async () => ({ items: [item], nextCursor: null })),
          get: vi.fn(), getNormalization: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    const table = await screen.findByRole('table', { name: 'Capture-to-Job normalization' })
    expect(table).toHaveTextContent('Apply at https://jobs.example.test/platform today')
    expect(table).not.toHaveTextContent('private-value')
    expect(screen.getByRole('button', { name: 'Inspect Capture lineage' }))
      .toBeInTheDocument()
  })

  it('shows concise source labels without provider identity in the table', async () => {
    const common = {
      adapter: { id: 'jobright' }, roleTitle: null, companyName: null,
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1, revisionCount: 1, normalizationStatus: 'raw_only',
      gateStatus: null, canonicalCandidateId: null, projectionStatus: 'not_eligible',
      findingId: null,
    }
    const items = [
      {
        ...common, id: 'raw-safe', providerRecordId: 'provider-job-123',
        reportedOrigin: { name: 'Jobright', providerId: 'jobright-provider' },
      },
      {
        ...common, id: 'raw-sparse', providerRecordId: null,
        reportedOrigin: { name: 'Manual import', providerId: null },
      },
      {
        ...common, id: 'raw-hostile', providerRecordId: 'credentialId=private-value',
        reportedOrigin: { name: 'Jobright', providerId: 'clientSecret=private-value' },
      },
      {
        ...common, id: 'raw-unknown', providerRecordId: null, reportedOrigin: null,
      },
    ] as RawSourceRecordSummary[]

    render(
      <RawNormalizationPage
        api={{
          list: vi.fn(async () => ({ items, nextCursor: null })),
          get: vi.fn(), getNormalization: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    const table = await screen.findByRole('table', { name: 'Capture-to-Job normalization' })
    expect(table).toHaveTextContent('Jobright')
    expect(table).toHaveTextContent('Manual import')
    expect(table).toHaveTextContent('Unknown source')
    expect(table).not.toHaveTextContent('provider-job-123')
    expect(table).not.toHaveTextContent('jobright-provider')
    expect(table).not.toHaveTextContent('private-value')
  })

  it('hides technical capture ownership behind a concise source label', async () => {
    const item = {
      id: 'raw-jobright-linkedin',
      adapter: { id: 'jobright', kind: 'connector', version: '0.11.0' },
      connectorInstanceId: 'jobright-default', latestConnectorRunId: 'run-1',
      reportedOrigin: { kind: 'job_board', name: 'LinkedIn', providerId: 'linkedin' },
      providerRecordId: 'linkedin-job-123', roleTitle: null, companyName: null,
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1, revisionCount: 1, normalizationStatus: 'raw_only',
      gateStatus: null, canonicalCandidateId: null, projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary

    render(
      <RawNormalizationPage
        api={{
          list: vi.fn(async () => ({ items: [item], nextCursor: null })),
          get: vi.fn(), getNormalization: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    const table = await screen.findByRole('table', { name: 'Capture-to-Job normalization' })
    const row = within(table).getAllByRole('row')[1]
    expect(row).toHaveTextContent('LinkedIn')
    expect(row).not.toHaveTextContent('jobright')
    expect(row).not.toHaveTextContent('0.11.0')
    expect(row).not.toHaveTextContent('jobright-default')
    expect(row).not.toHaveTextContent('linkedin-job-123')
    expect(row).not.toHaveTextContent('linkedin')
  })

  it('renders eight logical data cells with an explicit accessible inspect action', async () => {
    const item = {
      id: 'raw-semantic', adapter: { id: 'jobright' }, reportedOrigin: null,
      providerRecordId: null, roleTitle: null, companyName: null,
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1, revisionCount: 1, normalizationStatus: 'raw_only',
      gateStatus: null, canonicalCandidateId: null, projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary

    render(
      <RawNormalizationPage
        api={{
          list: vi.fn(async () => ({ items: [item], nextCursor: null })),
          get: vi.fn(), getNormalization: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    const table = await screen.findByRole('table', { name: 'Capture-to-Job normalization' })
    const dataRow = within(table).getAllByRole('row')[1]
    expect(within(dataRow).getAllByRole('cell')).toHaveLength(8)
    const inspect = within(dataRow).getByRole('button', { name: 'Inspect Capture lineage' })
    expect(inspect).toHaveAccessibleName('Inspect Capture lineage')
  })
})

function deferredListResult() {
  let resolve!: (result: {
    items: RawSourceRecordSummary[]
    nextCursor: string | null
  }) => void
  const promise = new Promise<{
    items: RawSourceRecordSummary[]
    nextCursor: string | null
  }>((promiseResolve) => { resolve = promiseResolve })
  return { promise, resolve }
}
