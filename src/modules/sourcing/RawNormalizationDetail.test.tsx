import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InvalidPersistedRawDetailHttpError,
  ValedictorianHttpError,
  invalidPersistedRawDetailErrorBody,
  type RawSourceProjectionResult,
  type RawSourceRecord,
  type RawSourceRecordSummary,
} from 'sparxie'
import { RawNormalizationDetail } from './RawNormalizationDetail'
import {
  createNeedsEnrichmentNormalization,
  createPassedNormalization,
} from './raw-normalization.test-fixtures'

afterEach(cleanup)

describe('RawNormalizationDetail', () => {
  it('distinguishes invalid persisted detail without exposing contract internals', async () => {
    const contractError = new InvalidPersistedRawDetailHttpError(
      invalidPersistedRawDetailErrorBody,
      500,
    )
    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(),
          get: vi.fn(async () => { throw contractError }),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        onClose={() => undefined}
        summary={{ id: 'invalid-record' } as RawSourceRecordSummary}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Raw record detail is invalid and cannot be displayed.')
    expect(alert).not.toHaveTextContent('capture lineage')
  })

  it('does not classify an untyped matching code as invalid persisted detail', async () => {
    const malformedIntegrityError = new ValedictorianHttpError({
      status: 500,
      body: {
        code: invalidPersistedRawDetailErrorBody.code,
        message: 'Internal capture lineage validation failed',
      },
      message: 'Request failed',
    })
    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(),
          get: vi.fn(async () => { throw malformedIntegrityError }),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        onClose={() => undefined}
        summary={{ id: 'malformed-integrity-record' } as RawSourceRecordSummary}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Raw record detail could not be loaded.')
    expect(alert).not.toHaveTextContent('invalid and cannot be displayed')
    expect(alert).not.toHaveTextContent('capture lineage')
  })

  it('shows an unrelated HTTP 400 as a generic load failure', async () => {
    const badRequest = new ValedictorianHttpError({
      status: 400,
      body: { code: 'invalid_request', message: 'Private parser detail' },
      message: 'Private parser detail',
    })
    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(),
          get: vi.fn(async () => { throw badRequest }),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        onClose={() => undefined}
        summary={{ id: 'bad-request-record' } as RawSourceRecordSummary}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Raw record detail could not be loaded.')
    expect(alert).not.toHaveTextContent('Private parser detail')
    expect(alert).not.toHaveTextContent('invalid and cannot be displayed')
    expect(alert).not.toHaveTextContent('backend could not be reached')
  })

  it('distinguishes an unavailable backend without exposing transport detail', async () => {
    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(),
          get: vi.fn(async () => { throw new TypeError('fetch failed at private origin') }),
          getNormalization: vi.fn(),
          getProjection: vi.fn(),
        }}
        onClose={() => undefined}
        summary={{ id: 'unavailable-record' } as RawSourceRecordSummary}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Raw record detail is unavailable because the backend could not be reached.',
    )
    expect(alert).not.toHaveTextContent('private origin')
  })

  it('redacts sensitive ordinary strings from facts, evidence, metadata, lineage, and labels', async () => {
    const record = {
      id: 'raw-record-safe',
      latestRevision: {
        id: 'token=private-value', revision: 1,
        adapter: { id: 'Authorization: Bearer private-value', version: '1.0.0' },
        payload: {
          title: 'Platform Engineer',
          safeField: 'Safe fact',
          safeJobUrl: 'https://jobs.example.test/platform?department=engineering',
          safeProse: 'Apply through the ordinary employer job page.',
          note: 'Cookie: session=private-value',
          'X-API-Key': 'x-api-key-value',
          privateKey: 'private-key-value',
          'javascript:alert(1)': 'unsafe-field-value',
          signedUrl: 'https://jobs.example.test/platform?X-Amz-Signature=signed-url-secret',
          jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlLXZhbHVlIn0.c2lnbmF0dXJlLXZhbHVl',
          AWS_ACCESS_KEY_ID: 'aws-key-value',
          requestSignature: 'signature-field-value',
          requestSig: 'compound-sig-payload-value',
        },
        evidence: [
          { kind: 'provider', label: 'Safe evidence', value: 'Public source' },
          { kind: 'provider', label: 'Request note', value: 'password=private-value' },
          { kind: 'provider', label: 'X-API-Key', value: 'x-api-key-evidence' },
          { kind: 'privateKey', label: 'Provider detail', value: 'private-key-evidence' },
          { kind: 'provider', label: 'javascript:alert(1)', value: 'unsafe-label-value' },
          { kind: 'provider', label: 'xAmzCredential', value: 'signed-evidence-value' },
          { kind: 'provider', label: 'awsSig', value: 'compound-sig-evidence-value' },
        ],
      },
      occurrences: [{
        id: 'access_token=private-value', rawRevisionId: 'password=private-value',
        receivedAt: '2026-07-10T12:00:00.000Z',
        capture: { connectorRunId: 'Cookie: private-value' },
      }],
    } as RawSourceRecord
    const summary = {
      id: 'raw-record-safe', normalizationStatus: 'raw_only',
    } as RawSourceRecordSummary
    const getNormalization = vi.fn(async () => {
      throw new Error('private normalization read detail')
    })

    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(), get: vi.fn(async () => record), getNormalization,
          getProjection: vi.fn(async () => ({
            rawRecordId: 'raw-record-safe', rawRevisionId: 'token=private-value',
            status: 'not_eligible', normalizationStatus: null,
            canonicalCandidateId: null, gateStatus: null,
            updatedAt: '2026-07-10T12:00:04.000Z',
          })),
        }}
        onClose={() => undefined}
        summary={summary}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Raw record raw-record-safe' })
    expect(dialog).toHaveTextContent('Platform Engineer')
    expect(dialog).toHaveTextContent('Safe fact')
    expect(dialog).toHaveTextContent('Safe evidence')
    expect(dialog).toHaveTextContent('Public source')
    expect(dialog).toHaveTextContent('https://jobs.example.test/platform?department=engineering')
    expect(dialog).toHaveTextContent('Apply through the ordinary employer job page.')
    expect(dialog).not.toHaveTextContent('private-value')
    expect(dialog).not.toHaveTextContent('X-API-Key')
    expect(dialog).not.toHaveTextContent('x-api-key-value')
    expect(dialog).not.toHaveTextContent('privateKey')
    expect(dialog).not.toHaveTextContent('private-key-value')
    expect(dialog).not.toHaveTextContent('javascript:alert(1)')
    expect(dialog).not.toHaveTextContent('unsafe-field-value')
    expect(dialog).not.toHaveTextContent('unsafe-label-value')
    expect(dialog).not.toHaveTextContent('signed-url-secret')
    expect(dialog).not.toHaveTextContent('eyJhbGciOiJIUzI1NiJ9')
    expect(dialog).not.toHaveTextContent('AWS_ACCESS_KEY_ID')
    expect(dialog).not.toHaveTextContent('aws-key-value')
    expect(dialog).not.toHaveTextContent('requestSignature')
    expect(dialog).not.toHaveTextContent('signature-field-value')
    expect(dialog).not.toHaveTextContent('xAmzCredential')
    expect(dialog).not.toHaveTextContent('signed-evidence-value')
    expect(dialog).not.toHaveTextContent('compound-sig-payload-value')
    expect(dialog).not.toHaveTextContent('compound-sig-evidence-value')
    expect(dialog).not.toHaveTextContent('private normalization read detail')
    expect(dialog).toHaveTextContent('Sensitive detail omitted')
    expect(dialog).toHaveTextContent('No normalization or projection recorded for this revision')
    expect(getNormalization).toHaveBeenCalledWith('raw-record-safe')
  })

  it('loads exact-revision projection truth and renders the canonical candidate fields', async () => {
    const candidateId = '2f0cb73b-a522-4a83-a46a-5e4048ed3010'
    const findingId = 'dd463b92-d71b-4200-8c7f-8295f8ad783b'
    const base = createPassedNormalization(createNeedsEnrichmentNormalization())
    const normalization = {
      ...base,
      canonicalCandidate: {
        ...base.canonicalCandidate!,
        id: candidateId,
        location: { raw: 'Boston, MA', city: 'Boston', region: 'MA', country: 'US' },
        compensation: {
          minimum: 120_000, maximum: 160_000, currency: 'USD', interval: 'year' as const,
          raw: '$120,000–$160,000 per year',
        },
        postedAt: { value: '2026-07-09', precision: 'date' as const, raw: 'July 9, 2026' },
        sourceUrl: 'https://www.linkedin.com/jobs/view/123?signal=strong',
        destination: {
          class: 'employer_or_ats' as const,
          url: 'https://jobs.example.test/platform?design=platform',
        },
      },
    }
    const record = {
      id: 'raw-record-1',
      latestRevision: {
        id: 'raw-revision-1', revision: 1,
        adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
        payload: { title: 'Platform Engineer' }, evidence: [],
      },
      occurrences: [],
    } as RawSourceRecord
    const projection = {
      rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
      status: 'projected', normalizationStatus: 'completed', gateStatus: 'passed',
      canonicalCandidateId: candidateId, projectedAt: '2026-07-10T12:00:04.000Z',
      updatedAt: '2026-07-10T12:00:04.000Z',
      finding: { id: findingId, mergeStatus: 'duplicate', mergedApplicationId: 'application-1' },
    } satisfies RawSourceProjectionResult
    const getProjection = vi.fn(async () => projection)
    const getNormalization = vi.fn(async () => normalization)
    const onOpenFinding = vi.fn()

    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(), get: vi.fn(async () => record),
          getNormalization, getProjection,
        }}
        onClose={() => undefined}
        onOpenFinding={onOpenFinding}
        summary={{ id: 'raw-record-1', normalizationStatus: 'raw_only' } as RawSourceRecordSummary}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Raw record raw-record-1' })
    await screen.findByText(`Candidate ${candidateId}`)
    expect(getNormalization).toHaveBeenCalledWith('raw-record-1')
    expect(getProjection).toHaveBeenCalledWith('raw-revision-1')
    expect(dialog).toHaveTextContent('Example Co')
    expect(dialog).toHaveTextContent('Platform Engineer')
    expect(dialog).toHaveTextContent('Full time')
    expect(dialog).toHaveTextContent('Mid level')
    expect(dialog).toHaveTextContent('Remote')
    expect(dialog).toHaveTextContent('Boston, MA, US')
    expect(dialog).toHaveTextContent('USD 120,000–160,000 per year')
    expect(dialog).toHaveTextContent('Source entity source-entity-1')
    expect(dialog).toHaveTextContent('Projection receipt for revision raw-revision-1')
    expect(dialog).toHaveTextContent('Duplicate')
    expect(dialog).toHaveTextContent('Merged application application-1')
    expect(dialog).toHaveTextContent(`Projected to finding ${findingId}`)
    fireEvent.click(screen.getByRole('button', { name: `Open finding ${findingId}` }))
    expect(onOpenFinding).toHaveBeenCalledWith(findingId)
    expect(screen.getByRole('link', { name: 'Open canonical destination' }))
      .toHaveAttribute('href', 'https://jobs.example.test/platform?design=platform')
    expect(screen.getByRole('link', { name: 'Open source listing' }))
      .toHaveAttribute('href', 'https://www.linkedin.com/jobs/view/123?signal=strong')
  })

  it('does not combine normalization from another raw revision with the projection receipt', async () => {
    const base = createPassedNormalization(createNeedsEnrichmentNormalization())
    const normalization = {
      ...base,
      rawRevisionId: 'requestSig=private-stale-revision',
      canonicalCandidate: {
        ...base.canonicalCandidate!,
        rawRevisionId: 'requestSig=private-stale-revision',
        companyName: 'Stale Company',
      },
    }
    const record = {
      id: 'raw-record-1',
      latestRevision: {
        id: 'raw-revision-1', revision: 1,
        adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
        payload: { title: 'Current capture' }, evidence: [],
      },
      occurrences: [],
    } as RawSourceRecord
    const projection = {
      rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
      status: 'projected', normalizationStatus: 'completed', gateStatus: 'passed',
      canonicalCandidateId: 'candidate-1', projectedAt: '2026-07-10T12:00:04.000Z',
      updatedAt: '2026-07-10T12:00:04.000Z',
      finding: { id: 'finding-current', mergeStatus: 'new', mergedApplicationId: null },
    } satisfies RawSourceProjectionResult

    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(), get: vi.fn(async () => record),
          getNormalization: vi.fn(async () => normalization),
          getProjection: vi.fn(async () => projection),
        }}
        onClose={() => undefined}
        summary={{ id: 'raw-record-1', normalizationStatus: 'completed' } as RawSourceRecordSummary}
      />,
    )

    const conflict = await screen.findByRole('alert', {
      name: 'Raw normalization detail conflict',
    })
    expect(conflict).toHaveTextContent('returned normalization does not match the fetched raw revision')
    expect(document.body).not.toHaveTextContent('Stale Company')
    expect(document.body).not.toHaveTextContent('finding-current')
    expect(document.body).not.toHaveTextContent('private-stale-revision')
  })

  it('does not combine candidate fields with a projection receipt for another candidate', async () => {
    const normalization = createPassedNormalization(createNeedsEnrichmentNormalization())
    const record = {
      id: 'raw-record-1',
      latestRevision: {
        id: 'raw-revision-1', revision: 1,
        adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
        payload: { title: 'Current capture' }, evidence: [],
      },
      occurrences: [],
    } as RawSourceRecord
    const projection = {
      rawRecordId: 'raw-record-1', rawRevisionId: 'raw-revision-1',
      status: 'projected', normalizationStatus: 'completed', gateStatus: 'passed',
      canonicalCandidateId: 'requestSig=private-projection-candidate',
      projectedAt: '2026-07-10T12:00:04.000Z', updatedAt: '2026-07-10T12:00:04.000Z',
      finding: { id: 'finding-other-candidate', mergeStatus: 'new', mergedApplicationId: null },
    } satisfies RawSourceProjectionResult

    render(
      <RawNormalizationDetail
        api={{
          list: vi.fn(), get: vi.fn(async () => record),
          getNormalization: vi.fn(async () => normalization),
          getProjection: vi.fn(async () => projection),
        }}
        onClose={() => undefined}
        summary={{ id: 'raw-record-1', normalizationStatus: 'completed' } as RawSourceRecordSummary}
      />,
    )

    const conflict = await screen.findByRole('alert', {
      name: 'Raw normalization detail conflict',
    })
    expect(conflict).toHaveTextContent('normalization and projection candidate identities conflict')
    expect(document.body).not.toHaveTextContent('Example Co')
    expect(document.body).not.toHaveTextContent('finding-other-candidate')
    expect(document.body).not.toHaveTextContent('private-projection-candidate')
  })

  it('ignores a late exact-revision projection after selection changes', async () => {
    let resolveStale!: (projection: RawSourceProjectionResult) => void
    const staleProjection = new Promise<RawSourceProjectionResult>((resolve) => {
      resolveStale = resolve
    })
    const base = createPassedNormalization(createNeedsEnrichmentNormalization())
    const normalizationFor = (id: string, companyName: string) => ({
      ...base, rawRecordId: id, rawRevisionId: `revision-${id}`,
      canonicalCandidate: {
        ...base.canonicalCandidate!, id: `candidate-${id}`, rawRecordId: id,
        rawRevisionId: `revision-${id}`, companyName,
      },
    })
    const recordFor = (id: string) => ({
      id,
      latestRevision: {
        id: `revision-${id}`, revision: 1,
        adapter: { id: 'jobright', kind: 'connector', version: '1.0.0' },
        payload: { title: id }, evidence: [],
      },
      occurrences: [],
    } as RawSourceRecord)
    const currentProjection = {
      rawRecordId: 'current', rawRevisionId: 'revision-current',
      status: 'projected', normalizationStatus: 'completed', gateStatus: 'passed',
      canonicalCandidateId: 'candidate-current', projectedAt: '2026-07-10T12:00:04.000Z',
      updatedAt: '2026-07-10T12:00:04.000Z',
      finding: { id: 'finding-current', mergeStatus: 'new', mergedApplicationId: null },
    } satisfies RawSourceProjectionResult
    const api = {
      list: vi.fn(),
      get: vi.fn(async (id: string) => recordFor(id)),
      getNormalization: vi.fn(async (id: string) => normalizationFor(
        id,
        id === 'stale' ? 'Stale Company' : 'Current Company',
      )),
      getProjection: vi.fn((revisionId: string) => revisionId === 'revision-stale'
        ? staleProjection
        : Promise.resolve(currentProjection)),
    }
    const summary = (id: string) => ({
      id, normalizationStatus: 'completed',
    } as RawSourceRecordSummary)
    const { rerender } = render(
      <RawNormalizationDetail api={api} onClose={() => undefined} summary={summary('stale')} />,
    )
    await waitFor(() => expect(api.getProjection).toHaveBeenCalledWith('revision-stale'))

    rerender(
      <RawNormalizationDetail api={api} onClose={() => undefined} summary={summary('current')} />,
    )
    expect(await screen.findByText('Current Company')).toBeInTheDocument()
    await act(async () => {
      resolveStale({
        ...currentProjection,
        rawRecordId: 'stale', rawRevisionId: 'revision-stale',
        canonicalCandidateId: 'candidate-stale',
        finding: { id: 'finding-stale', mergeStatus: 'duplicate', mergedApplicationId: null },
      })
      await staleProjection
    })

    expect(screen.getByText('Current Company')).toBeInTheDocument()
    expect(screen.getByText('Projected to finding finding-current')).toBeInTheDocument()
    expect(screen.queryByText('Stale Company')).not.toBeInTheDocument()
    expect(screen.queryByText('Projected to finding finding-stale')).not.toBeInTheDocument()
  })
})
