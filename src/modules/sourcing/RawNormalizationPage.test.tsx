import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RawSourceRecordSummary } from 'sparxie'
import {
  ValedictorianHttpError,
  ValedictorianProtocolError,
  ValedictorianTransportError,
  valedictorianFailureKindMessages,
} from 'sparxie'
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

  it('shows scoped request failure for initial list rejection, not domain empty/not-started', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'upstream dump /secret/raw' }))
      .mockResolvedValueOnce({
        items: [{
          id: 'raw-1',
          latestConnectorRunId: 'run-1',
          adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
          reportedOrigin: null,
          providerRecordId: null,
          roleTitle: 'Recovered role',
          companyName: 'Recovered Co',
          firstObservedAt: '2026-07-10T12:00:00.000Z',
          lastObservedAt: '2026-07-10T12:00:00.000Z',
          occurrenceCount: 1,
          revisionCount: 1,
          normalizationStatus: 'raw_only',
          gateStatus: null,
          canonicalCandidateId: null,
          projectionStatus: 'not_eligible',
          findingId: null,
        } as RawSourceRecordSummary],
        nextCursor: null,
      })

    render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).toHaveTextContent('Capture lineages could not be loaded.')
    expect(alert).not.toHaveTextContent('/secret/raw')
    expect(screen.queryByRole('status', {
      name: 'No Capture lineages match the current filters',
    })).not.toBeInTheDocument()
    expect(screen.queryByText(/not started/i)).not.toBeInTheDocument()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered role')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('settles an initial AbortError to empty non-error UI without a truthy load failure', async () => {
    const list = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
      />,
    )

    expect(await screen.findByRole('status', {
      name: 'No Capture lineages match the current filters',
    })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading Capture lineages' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('retains stale rows when a later list refresh/rejection fails', async () => {
    const item = {
      id: 'raw-stale',
      latestConnectorRunId: 'run-1',
      adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
      reportedOrigin: null,
      providerRecordId: null,
      roleTitle: 'Stale title',
      companyName: 'Stale Co',
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1,
      revisionCount: 1,
      normalizationStatus: 'raw_only',
      gateStatus: null,
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [item], nextCursor: null })
      .mockRejectedValueOnce(new ValedictorianProtocolError({ message: 'refresh dump' }))

    const { rerender } = render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
      />,
    )
    expect(await screen.findByText('Stale title')).toBeInTheDocument()

    const failingApi = {
      list: vi.fn(async () => { throw new ValedictorianProtocolError({ message: 'refresh dump /secret' }) }),
      get: vi.fn(),
      getNormalization: vi.fn(),
      getProjection: vi.fn(),
    }
    rerender(
      <RawNormalizationPage api={failingApi} contentColumnClass="" />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.getByText('Stale title')).toBeInTheDocument()
    expect(screen.queryByRole('status', {
      name: 'No Capture lineages match the current filters',
    })).not.toBeInTheDocument()
  })

  it('renders AuthenticationFailure with Retry for typed authentication list failures', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'raw list auth dump /secret',
        status: 401,
      }))
      .mockResolvedValueOnce({
        items: [{
          id: 'raw-1',
          adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
          reportedOrigin: null,
          providerRecordId: null,
          roleTitle: 'Recovered title',
          companyName: null,
          firstObservedAt: '2026-07-10T12:00:00.000Z',
          lastObservedAt: '2026-07-10T12:00:00.000Z',
          occurrenceCount: 1,
          revisionCount: 1,
          normalizationStatus: 'raw_only',
          gateStatus: null,
          canonicalCandidateId: null,
          projectionStatus: 'not_eligible',
          findingId: null,
        } as RawSourceRecordSummary],
        nextCursor: null,
      })

    render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'authentication-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.authentication)
    expect(alert).not.toHaveTextContent('/secret')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered title')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('renders GlobalFailureAlert with Retry for typed transport list failures', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/raw/secret'),
      }))
      .mockResolvedValueOnce({
        items: [{
          id: 'raw-1',
          adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
          reportedOrigin: null,
          providerRecordId: null,
          roleTitle: 'Recovered title',
          companyName: null,
          firstObservedAt: '2026-07-10T12:00:00.000Z',
          lastObservedAt: '2026-07-10T12:00:00.000Z',
          occurrenceCount: 1,
          revisionCount: 1,
          normalizationStatus: 'raw_only',
          gateStatus: null,
          canonicalCandidateId: null,
          projectionStatus: 'not_eligible',
          findingId: null,
        } as RawSourceRecordSummary],
        nextCursor: null,
      })

    render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'global-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
    expect(alert).not.toHaveTextContent('ECONNREFUSED')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered title')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('clears prior-page rows and selected detail on pagination change, and keeps them cleared after rejection', async () => {
    const pageOne = {
      id: 'page-one-row',
      latestConnectorRunId: 'run-1',
      adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
      reportedOrigin: null,
      providerRecordId: null,
      roleTitle: 'Page one title',
      companyName: 'Page One Co',
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1,
      revisionCount: 1,
      normalizationStatus: 'raw_only',
      gateStatus: null,
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary
    const pendingPageTwo = deferredListResult()
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [pageOne], nextCursor: 'cursor-page-2' })
      .mockImplementationOnce(() => pendingPageTwo.promise)

    render(
      <RawNormalizationPage
        api={{
          list,
          get: vi.fn(() => new Promise(() => undefined)),
          getNormalization: vi.fn(() => new Promise(() => undefined)),
          getProjection: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    expect(await screen.findByText('Page one title')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Capture lineage' }))
    expect(await screen.findByRole('dialog', {
      name: 'Capture lineage page-one-row',
    })).toBeInTheDocument()
    expect(screen.getByText('Loading Capture lineage detail...')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next page', hidden: true }))

    expect(screen.queryByText('Page one title')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', {
      name: 'Capture lineage page-one-row',
    })).not.toBeInTheDocument()
    expect(screen.queryByText('Loading Capture lineage detail...')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading Capture lineages' }))
      .toBeInTheDocument()

    pendingPageTwo.reject(new Error('page two dump /secret'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'scoped-load-failure')
    expect(alert).not.toHaveTextContent('/secret')
    expect(screen.queryByText('Page one title')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', {
      name: 'Capture lineage page-one-row',
    })).not.toBeInTheDocument()
    expect(screen.queryByText('Loading Capture lineage detail...')).not.toBeInTheDocument()
  })

  it('keeps the stale table mounted during same-query Retry pending, then shows one failure owner', async () => {
    const item = {
      id: 'raw-pending',
      latestConnectorRunId: 'run-1',
      adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
      reportedOrigin: null,
      providerRecordId: null,
      roleTitle: 'Pending stale title',
      companyName: 'Pending Co',
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1,
      revisionCount: 1,
      normalizationStatus: 'raw_only',
      gateStatus: null,
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary
    const pendingRetry = deferredListResult()
    const refreshList = vi.fn()
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/raw-list/secret'),
      }))
      .mockImplementationOnce(() => pendingRetry.promise)

    const { rerender } = render(
      <RawNormalizationPage
        api={{
          list: vi.fn(async () => ({ items: [item], nextCursor: null })),
          get: vi.fn(),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )
    expect(await screen.findByText('Pending stale title')).toBeInTheDocument()

    rerender(
      <RawNormalizationPage
        api={{
          list: refreshList,
          get: vi.fn(),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    const firstAlert = await screen.findByRole('alert')
    expect(firstAlert).toHaveAttribute('data-slot', 'global-failure')
    expect(screen.getByText('Pending stale title')).toBeInTheDocument()

    fireEvent.click(within(firstAlert).getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('Pending stale title')).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByRole('status', {
      name: 'No Capture lineages match the current filters',
    })).not.toBeInTheDocument()

    pendingRetry.reject(new ValedictorianTransportError({
      cause: new Error('ECONNREFUSED /var/raw-list/secret'),
    }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'global-failure')
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByText('Pending stale title')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
    expect(screen.getByRole('alert')).not.toHaveTextContent('ECONNREFUSED')
  })

  it('queries the public list contract with connector, received, lifecycle, and projection filters', async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
      />,
    )

    await screen.findByRole('status', {
      name: 'No Capture lineages match the current filters',
    })

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
    fireEvent.change(screen.getByLabelText('Job normalization status'), {
      target: { value: 'completed' },
    })
    fireEvent.change(screen.getByLabelText('Opportunity admission status'), {
      target: { value: 'needs_enrichment' },
    })
    fireEvent.change(screen.getByLabelText('Opportunity projection status'), {
      target: { value: 'not_eligible' },
    })

    await waitFor(() => expect(list).toHaveBeenLastCalledWith({
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
    const summary = (id: string) => ({
      id,
      adapter: { id: 'jobright' },
      reportedOrigin: { name: 'Jobright', providerId: null },
      providerRecordId: null,
      roleTitle: null,
      companyName: null,
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1,
      revisionCount: 1,
      normalizationStatus: 'raw_only',
      gateStatus: null,
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary)
    const list = vi.fn(async (query?: { cursor?: string }) => query?.cursor === 'next-page'
      ? { items: [summary('raw-record-2')], nextCursor: null }
      : { items: [summary('raw-record-1')], nextCursor: 'next-page' })

    render(
      <RawNormalizationPage
        api={{ list, get: vi.fn(), getNormalization: vi.fn(), getProjection: vi.fn() }}
        contentColumnClass=""
      />,
    )

    expect(await screen.findByRole('button', { name: 'Inspect Capture lineage' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('button', { name: 'Inspect Capture lineage' })).toBeInTheDocument()
    expect(list).toHaveBeenLastCalledWith({ cursor: 'next-page', limit: 50 })

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByRole('button', { name: 'Inspect Capture lineage' })).toBeInTheDocument()
    expect(list).toHaveBeenLastCalledWith({ limit: 50 })
  })

  it('announces an empty normalization result without hiding the filters', async () => {
    render(
      <RawNormalizationPage
        api={{
          list: vi.fn(async () => ({ items: [], nextCursor: null })),
          get: vi.fn(),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    expect(await screen.findByRole('status', {
      name: 'No Capture lineages match the current filters',
    })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Capture normalization filters' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Capture-to-Job normalization' })).not.toBeInTheDocument()
  })

  it('keeps normalization, gate, candidate, and finding projection as separate lifecycle columns', async () => {
    const candidateId = '2f0cb73b-a522-4a83-a46a-5e4048ed3010'
    const findingId = 'dd463b92-d71b-4200-8c7f-8295f8ad783b'
    const projected = {
      id: 'raw-projected',
      adapter: { id: 'jobright' },
      reportedOrigin: { name: 'Jobright', providerId: null },
      providerRecordId: null,
      roleTitle: null,
      companyName: null,
      firstObservedAt: '2026-07-10T12:00:00.000Z',
      lastObservedAt: '2026-07-10T12:00:00.000Z',
      occurrenceCount: 1,
      revisionCount: 1,
      normalizationStatus: 'completed',
      normalizationUpdatedAt: '2026-07-10T12:00:03.000Z',
      normalizationRawRevisionId: 'raw-revision-1',
      gateStatus: 'passed',
      canonicalCandidateId: candidateId,
      projectionStatus: 'projected',
      findingId,
    } as RawSourceRecordSummary
    const rejected = {
      ...projected,
      id: 'raw-rejected',
      gateStatus: 'rejected',
      canonicalCandidateId: null,
      projectionStatus: 'not_eligible',
      findingId: null,
    } as RawSourceRecordSummary

    render(
      <RawNormalizationPage
        api={{
          list: vi.fn(async () => ({ items: [projected, rejected], nextCursor: null })),
          get: vi.fn(),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        contentColumnClass=""
      />,
    )

    const table = await screen.findByRole('table', { name: 'Capture-to-Job normalization' })
    expect(within(table).getByRole('columnheader', { name: 'Job fact version' }))
      .toBeInTheDocument()
    const projectedRow = within(table).getByText('Projected').closest('tr')!
    expect(projectedRow).toHaveTextContent('Completed')
    expect(projectedRow).toHaveTextContent('Passed')
    expect(projectedRow).toHaveTextContent('Job facts persisted')
    expect(projectedRow).toHaveTextContent('Projected')
    const rejectedRow = within(table).getByText('Rejected').closest('tr')!
    expect(rejectedRow).toHaveTextContent('Rejected')
    expect(rejectedRow).toHaveTextContent('No Job facts')
    expect(rejectedRow).toHaveTextContent('Not projected')
    expect(table).not.toHaveTextContent(candidateId)
    expect(table).not.toHaveTextContent(findingId)
    expect(table).not.toContainHTML(candidateId)
    expect(table).not.toContainHTML(findingId)
  })
})

function deferredListResult() {
  let resolve!: (result: {
    items: RawSourceRecordSummary[]
    nextCursor: string | null
  }) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<{
    items: RawSourceRecordSummary[]
    nextCursor: string | null
  }>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
