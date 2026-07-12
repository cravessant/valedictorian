import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

const receipt = {
  rawRecordId: 'raw-1',
  sourceEntityId: null,
  revision: {
    id: 'revision-1', rawRecordId: 'raw-1', revision: 1, contentHash: 'hash-1', reused: false,
    createdAt: '2026-07-12T12:00:00.000Z',
  },
  occurrence: {
    id: 'occurrence-1', rawRecordId: 'raw-1', rawRevisionId: 'revision-1',
    observedAt: '2026-07-12T12:00:00.000Z', receivedAt: '2026-07-12T12:00:01.000Z',
  },
}

describe('raw sourcing intake', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ingests a sparse URL observation with CLI adapter provenance', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts: [receipt] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      rawRecordId: 'raw-1', rawRevisionId: 'revision-1', canonicalSchemaVersion: '1',
      attempts: [], fieldOutcomes: [], updatedAt: '2026-07-12T12:00:01.000Z',
      status: 'pending', gate: null, canonicalCandidate: null,
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      rawRecordId: 'raw-1', rawRevisionId: 'revision-1', updatedAt: '2026-07-12T12:00:01.000Z',
      status: 'not_eligible', normalizationStatus: 'pending', canonicalCandidateId: null,
      gateStatus: null,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'sourcing', 'ingest', '--workspace', 'workspace-1', '--url', 'https://jobs.example.com/1',
      '--observed-at', '2026-07-12T12:00:00.000Z', '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ receipts: [{
      submitted: { adapter: { id: 'valedictorian-cli', kind: 'cli' }, reportedOrigin: null },
      intake: { rawRecordId: 'raw-1', revision: { id: 'revision-1' }, occurrence: { id: 'occurrence-1' } },
      normalization: { matchesRevision: true, result: { status: 'pending' } },
      projection: { result: { status: 'not_eligible' } },
    }] })
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/raw-records/batch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ records: [{
        adapter: { id: 'valedictorian-cli', kind: 'cli', version: '0.1.0-alpha.13' },
        observedAt: '2026-07-12T12:00:00.000Z', payload: { url: 'https://jobs.example.com/1' },
      }] }) }),
    )
  })

  it('keeps reported origin distinct and rejects adapter spoofing before atomic capture', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    const invalid = await runCli([
      'sourcing', 'ingest', '--workspace', 'workspace-1', '--batch-json', JSON.stringify([{
        adapter: { id: 'spoofed', kind: 'connector', version: '9' },
        observedAt: '2026-07-12T12:00:00.000Z', payload: { url: 'https://example.com/1' },
      }]), '--json',
    ])
    expect(invalid.exitCode).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts: [receipt] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      rawRecordId: 'raw-1', rawRevisionId: 'revision-1', canonicalSchemaVersion: '1', attempts: [],
      fieldOutcomes: [], updatedAt: '2026-07-12T12:00:01.000Z', status: 'blocked', gate: null,
      canonicalCandidate: null,
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      rawRecordId: 'raw-1', rawRevisionId: 'revision-1', updatedAt: '2026-07-12T12:00:01.000Z',
      status: 'not_eligible', normalizationStatus: 'blocked', canonicalCandidateId: null, gateStatus: null,
    }))
    const valid = await runCli([
      'sourcing', 'ingest', '--workspace', 'workspace-1', '--url', 'https://jobright.ai/jobs/1',
      '--observed-at', '2026-07-12T12:00:00.000Z', '--origin-kind', 'job_board',
      '--origin-name', 'Jobright', '--origin-provider-id', 'jr-1', '--json',
    ])
    expect(valid.exitCode).toBe(0)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ records: [{
      adapter: { id: 'valedictorian-cli', kind: 'cli' },
      reportedOrigin: { kind: 'job_board', name: 'Jobright', providerId: 'jr-1' },
      payload: { url: 'https://jobright.ai/jobs/1' },
    }] })
    expect(JSON.parse(valid.stdout).receipts[0].normalization.result.status).toBe('blocked')
  })

  it('keeps a Jobright intermediary sparse and pending for server-side resolution', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts: [receipt] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ rawRecordId: 'raw-1', rawRevisionId: 'revision-1', canonicalSchemaVersion: '1', attempts: [], fieldOutcomes: [], updatedAt: '2026-07-12T12:00:01.000Z', status: 'pending', gate: null, canonicalCandidate: null }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ rawRecordId: 'raw-1', rawRevisionId: 'revision-1', updatedAt: '2026-07-12T12:00:01.000Z', status: 'not_eligible', normalizationStatus: 'pending', canonicalCandidateId: null, gateStatus: null }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await runCli(['sourcing', 'ingest', '--workspace', 'workspace-1', '--url', 'https://jobright.ai/jobs/2', '--observed-at', '2026-07-12T12:00:00.000Z', '--json'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ records: [{ adapter: { id: 'valedictorian-cli', kind: 'cli', version: '0.1.0-alpha.13' }, observedAt: '2026-07-12T12:00:00.000Z', payload: { url: 'https://jobright.ai/jobs/2' } }] })
    expect(JSON.parse(result.stdout).receipts[0].normalization.result.status).toBe('pending')
  })

  it('reports duplicate, changed, mixed normalization, projection, and safe failure outcomes per receipt', async () => {
    const receipts = [
      receipt,
      { ...receipt, occurrence: { ...receipt.occurrence, id: 'occurrence-2' }, revision: { ...receipt.revision, reused: true } },
      { ...receipt, occurrence: { ...receipt.occurrence, id: 'occurrence-3', rawRevisionId: 'revision-2' }, revision: { ...receipt.revision, id: 'revision-2', revision: 2, reused: false } },
    ]
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts }))
    for (const [index, item] of receipts.entries()) {
      const rawRevisionId = index === 1 ? 'newer-revision' : item.revision.id
      fetchMock.mockResolvedValueOnce(jsonResponse({
        rawRecordId: item.rawRecordId, rawRevisionId, canonicalSchemaVersion: '1', attempts: [],
        fieldOutcomes: [], updatedAt: '2026-07-12T12:00:01.000Z', status: index === 2 ? 'completed' : 'pending',
        gate: index === 2 ? { status: 'passed', policyVersion: '1', requiredFields: [], missingFields: [], conflictingFields: [], candidate: { id: 'candidate-2', sourceEntityId: 'entity-2', rawRecordId: 'raw-1', rawRevisionId: 'revision-2', schemaVersion: '1' }, evaluatedAt: '2026-07-12T12:00:01.000Z' } : null,
        canonicalCandidate: index === 2 ? { ...canonicalCandidate(), rawRecordId: 'raw-1' } : null,
      }))
      fetchMock.mockResolvedValueOnce(jsonResponse(index === 2 ? {
        rawRecordId: 'raw-1', rawRevisionId: 'revision-2', updatedAt: '2026-07-12T12:00:01.000Z',
        status: 'failed', normalizationStatus: 'completed', gateStatus: 'passed', canonicalCandidateId: 'candidate-2',
        failedAt: '2026-07-12T12:00:02.000Z', failure: { code: 'persistence_failed', retryable: true },
      } : {
        rawRecordId: item.rawRecordId, rawRevisionId: item.revision.id, updatedAt: '2026-07-12T12:00:01.000Z',
        status: 'not_eligible', normalizationStatus: 'pending', canonicalCandidateId: null, gateStatus: null,
      }))
    }
    vi.stubGlobal('fetch', fetchMock)
    const batch = receipts.map((_, index) => ({ observedAt: '2026-07-12T12:00:00.000Z', payload: { url: `https://example.com/${index}` } }))
    const result = await runCli(['sourcing', 'ingest', '--workspace', 'workspace-1', '--batch-json', JSON.stringify(batch), '--json'])
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.receipts.map((item: { intake: { revision: { reused: boolean } } }) => item.intake.revision.reused)).toEqual([false, true, false])
    expect(output.receipts[1].normalization).toMatchObject({ matchesRevision: false, requestedRawRevisionId: 'revision-1', result: { rawRevisionId: 'newer-revision' } })
    expect(output.receipts[2].projection.result).toMatchObject({ status: 'failed', failure: { code: 'persistence_failed', retryable: true } })
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })

  it.each(['new', 'blocked', 'not_fit', 'duplicate'])('reports a projected finding with %s merge status', async (mergeStatus) => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts: [receipt] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      rawRecordId: 'raw-1', rawRevisionId: 'revision-1', canonicalSchemaVersion: '1', attempts: [], fieldOutcomes: [],
      updatedAt: '2026-07-12T12:00:01.000Z', status: 'completed',
      gate: { status: 'passed', policyVersion: '1', requiredFields: [], missingFields: [], conflictingFields: [], candidate: { id: 'candidate-2', sourceEntityId: 'entity-2', rawRecordId: 'raw-1', rawRevisionId: 'revision-1', schemaVersion: '1' }, evaluatedAt: '2026-07-12T12:00:01.000Z' },
      canonicalCandidate: { ...canonicalCandidate(), rawRecordId: 'raw-1', rawRevisionId: 'revision-1' },
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      rawRecordId: 'raw-1', rawRevisionId: 'revision-1', updatedAt: '2026-07-12T12:00:02.000Z', status: 'projected',
      normalizationStatus: 'completed', gateStatus: 'passed', canonicalCandidateId: 'candidate-2', projectedAt: '2026-07-12T12:00:02.000Z',
      finding: { id: 'finding-stable', mergeStatus, mergedApplicationId: null },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await runCli(['sourcing', 'ingest', '--workspace', 'workspace-1', '--url', 'https://example.com/1', '--observed-at', '2026-07-12T12:00:00.000Z', '--json'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).records[0].payload).toEqual({ url: 'https://example.com/1' })
    expect(JSON.parse(result.stdout).receipts[0].projection.result).toMatchObject({ status: 'projected', finding: { id: 'finding-stable', mergeStatus } })
  })

  it('preserves receipts and continues both inspections after safe lookup failures', async () => {
    const second = { ...receipt, rawRecordId: 'raw-2', revision: { ...receipt.revision, id: 'revision-2', rawRecordId: 'raw-2' }, occurrence: { ...receipt.occurrence, id: 'occurrence-2', rawRecordId: 'raw-2', rawRevisionId: 'revision-2' } }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts: [receipt, second] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ secret: 'never echo this body' }, { status: 503 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ malformed: 'projection secret' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ rawRecordId: 'raw-2', rawRevisionId: 'revision-2', canonicalSchemaVersion: '1', attempts: [], fieldOutcomes: [], updatedAt: '2026-07-12T12:00:01.000Z', status: 'in_progress', gate: null, canonicalCandidate: null }))
    fetchMock.mockRejectedValueOnce(new Error('private transport details'))
    vi.stubGlobal('fetch', fetchMock)
    const batch = [1, 2].map((id) => ({ observedAt: '2026-07-12T12:00:00.000Z', payload: { url: `https://example.com/${id}` } }))
    const result = await runCli(['sourcing', 'ingest', '--workspace', 'workspace-1', '--batch-json', JSON.stringify(batch), '--json'])
    const output = JSON.parse(result.stdout)
    expect(result.exitCode).toBe(1)
    expect(output).toMatchObject({ inspectionFailureCount: 3, receipts: [
      { intake: { rawRecordId: 'raw-1' }, normalization: { result: null, error: { stage: 'normalization', code: 'http_error', httpStatus: 503 } }, projection: { result: null, error: { stage: 'projection', code: 'invalid_response' } } },
      { intake: { rawRecordId: 'raw-2' }, normalization: { result: { status: 'in_progress' } }, projection: { result: null, error: { stage: 'projection', code: 'transport_error' } } },
    ] })
    expect(result.stdout).not.toMatch(/never echo|projection secret|private transport/)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('validates the complete mixed batch before workspace discovery', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await runCli(['sourcing', 'ingest', '--workspace', 'Example Workspace', '--batch-json', JSON.stringify([
      { observedAt: '2026-07-12T12:00:00.000Z', payload: { url: 'https://example.com/1' } },
      { observedAt: 'not-a-time', payload: { url: 'https://example.com/2' } },
    ]), '--json'])
    expect(result.exitCode).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates origin and URL before workspace discovery', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await runCli(['sourcing', 'ingest', '--workspace', 'Example Workspace', '--url', 'javascript:bad'])).exitCode).toBe(1)
    expect((await runCli(['sourcing', 'ingest', '--workspace', 'Example Workspace', '--url', 'https://example.com', '--origin-kind', 'provider'])).exitCode).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders provenance, intake, actual statuses, and safe inspection failure for humans', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts: [receipt] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ rawRecordId: 'raw-1', rawRevisionId: 'revision-1', canonicalSchemaVersion: '1', attempts: [], fieldOutcomes: [], updatedAt: '2026-07-12T12:00:01.000Z', status: 'blocked', gate: null, canonicalCandidate: null }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ private: 'do not print' }, { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await runCli(['sourcing', 'ingest', '--workspace', 'workspace-1', '--url', 'https://jobright.ai/1', '--observed-at', '2026-07-12T12:00:00.000Z', '--origin-kind', 'job_board', '--origin-name', 'Jobright'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('Provenance (submitted): adapter=valedictorian-cli kind=cli version=0.1.0-alpha.13 reportedOrigin=job_board:Jobright')
    expect(result.stdout).toContain('Intake: record=raw-1 revision=revision-1')
    expect(result.stdout).toContain('Normalization: status=blocked')
    expect(result.stdout).toContain('Projection inspection: failed code=http_error httpStatus=502')
    expect(result.stdout).not.toMatch(/queued|do not print/)
  })

  it.each([
    ['in_progress', null, 'not_eligible'],
    ['failed', 'failed', 'not_eligible'],
    ['completed', 'needs_enrichment', 'not_eligible'],
    ['completed', 'rejected', 'not_eligible'],
    ['completed', 'passed', 'pending'],
  ])('reports normalization %s, gate %s, and projection %s', async (status, gateStatus, projectionStatus) => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ receipts: [receipt] }))
    fetchMock.mockResolvedValueOnce(jsonResponse(normalizationFixture(status, gateStatus)))
    fetchMock.mockResolvedValueOnce(jsonResponse(projectionFixture(status, gateStatus, projectionStatus)))
    vi.stubGlobal('fetch', fetchMock)
    const result = await runCli(['sourcing', 'ingest', '--workspace', 'workspace-1', '--url', 'https://jobs.example.com/1', '--observed-at', '2026-07-12T12:00:00.000Z', '--json'])
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout).receipts[0]
    expect(output.normalization.result.status).toBe(status)
    expect(output.normalization.result.gate?.status ?? null).toBe(gateStatus)
    expect(output.projection.result.status).toBe(projectionStatus)
  })
})

function normalizationFixture(status: string, gateStatus: string | null) {
  const gate = gateStatus === null ? null : {
    status: gateStatus, policyVersion: '1', requiredFields: [], missingFields: gateStatus === 'needs_enrichment' ? ['companyName'] : [],
    conflictingFields: [], candidate: gateStatus === 'passed' ? { id: 'candidate-2', sourceEntityId: 'entity-2', rawRecordId: 'raw-1', rawRevisionId: 'revision-1', schemaVersion: '1' } : null,
    evaluatedAt: '2026-07-12T12:00:01.000Z',
  }
  return {
    rawRecordId: 'raw-1', rawRevisionId: 'revision-1', canonicalSchemaVersion: '1', attempts: [], fieldOutcomes: [],
    updatedAt: '2026-07-12T12:00:01.000Z', status, gate,
    canonicalCandidate: gateStatus === 'passed' ? { ...canonicalCandidate(), rawRecordId: 'raw-1', rawRevisionId: 'revision-1' } : null,
  }
}

function projectionFixture(normalizationStatus: string, gateStatus: string | null, status: string) {
  if (status === 'pending') return { rawRecordId: 'raw-1', rawRevisionId: 'revision-1', updatedAt: '2026-07-12T12:00:01.000Z', status, normalizationStatus: 'completed', gateStatus: 'passed', canonicalCandidateId: 'candidate-2' }
  return { rawRecordId: 'raw-1', rawRevisionId: 'revision-1', updatedAt: '2026-07-12T12:00:01.000Z', status, normalizationStatus, gateStatus, canonicalCandidateId: null }
}

function canonicalCandidate() {
  return {
    id: 'candidate-2', sourceEntityId: 'entity-2', rawRecordId: 'raw-2', rawRevisionId: 'revision-2', schemaVersion: '1',
    canonicalIdentity: { kind: 'destination_url', value: 'https://example.com/2' }, companyName: 'Example', roleTitle: 'Engineer',
    employmentType: 'unknown', seniority: 'unknown', workMode: 'unclear', location: null, compensation: null,
    destination: { class: 'employer_or_ats', url: 'https://example.com/2' }, sourceUrl: 'https://example.com/2', providerJobId: null,
    postedAt: { value: null, precision: 'unknown', raw: null }, observedAt: '2026-07-12T12:00:00.000Z',
  }
}
