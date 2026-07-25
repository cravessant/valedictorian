import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'
import { formatHumanOutput } from './valedictorian-cli.output'

const workspaceId = 'workspace-1'
const captureId = 'capture-1'
const companyId = 'company-1'
const jobId = '018f0f2e-7b16-7a01-8c8c-20c6a9d52301'
const actor = { id: 'user-1', type: 'user' }
const destination = { class: 'employer_or_ats', url: 'https://jobs.example.com/role' }
const jobFacts = {
  companyName: 'Delta Labs', roleTitle: 'Platform Engineer', sourceName: 'Employer site',
  roleKind: 'experienced', term: null, terms: [], timingMode: 'unknown', startDate: null,
  endDate: null, location: null, workMode: 'remote', employmentType: 'full_time',
  seniority: 'mid', compensation: null, postedAt: null, destination,
}

function json(input: unknown) {
  return JSON.stringify(input)
}

function completeInput() {
  return {
    expectedCaptureRevision: 4,
    expectedGenerationId: 'generation-1',
    idempotencyKey: 'complete-capture-1',
    actor,
    jobFacts,
    destination,
    externalIdentities: [],
    evidenceReferences: [{ captureId, captureRevision: 4, evidenceIndexes: [0] }],
    companyResolution: {
      action: 'use_local', companyId, expectedCompanyRevision: 7, restoreIfArchived: false,
    },
  }
}

function companyWrite(extra: Record<string, unknown> = {}) {
  return { actor, rationale: 'Reviewed current company data.', idempotencyKey: 'company-write-1', ...extra }
}

function pageInfo() {
  return { startCursor: 'cursor-start', endCursor: 'cursor-end', hasPreviousPage: true, hasNextPage: true }
}

function company(overrides: Record<string, unknown> = {}) {
  return {
    id: companyId, workspaceId, displayName: 'Delta Labs', aliases: [{ id: 'alias-1', value: 'Delta' }],
    websiteUrl: 'https://delta.example.com', notes: 'Hiring platform engineers.', revision: 7,
    status: 'active', mergedIntoCompanyId: null, createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z', ...overrides,
  }
}

function companySearchResult(overrides: Record<string, unknown> = {}) {
  return {
    companyId, revision: 7, displayName: 'Delta Labs', websiteUrl: 'https://delta.example.com',
    status: 'active', assignedJobCount: 3, ...overrides,
  }
}

const resolverDetails = { resolverId: 'jobright-url-resolver', resolverVersion: '1.4.0' }
const detailPath = `workspaces/${workspaceId}/capture-resolution/captures/${captureId}`
const detailUrlV1 = `https://valedictorian.test/v1/${detailPath}`
const detailUrlV2 = `https://valedictorian.test/v2/${detailPath}`

function completionDetail(overrides: Record<string, unknown> = {}) {
  return {
    captureId, captureRevision: 4, expectedGenerationId: 'generation-1',
    sourceSummary: { displayName: 'Job board', provider: 'jobright', observedAt: '2026-07-24T12:00:00.000Z' },
    provenance: [], destination: { status: 'resolved', url: destination.url },
    rawEvidence: [], exactEvidenceReferences: [], jobDefaults: {}, lastIssue: null, ...overrides,
  }
}

function destinationIssue(code: string, action: string | null, message: string, details: Record<string, unknown>) {
  return { stage: 'destination', code, action, causedBy: null, message, details }
}

describe('Capture completion and Workspace Company commands', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('publishes supported Capture resolution, Company, and Job assignment groups', async () => {
    const [capture, companies, jobs] = await Promise.all([
      runCli(['captures', 'resolution', '--help']),
      runCli(['companies', '--help']),
      runCli(['jobs', 'company', '--help']),
    ])

    expect(capture.stdout).toContain('complete')
    expect(capture.stdout).toContain('retry')
    expect(capture.stdout).toContain('replay')
    expect(companies.stdout).toContain('duplicates')
    expect(companies.stdout).toContain('search')
    expect(jobs.stdout).toContain('reassign')
  })

  it('prints bounded fresh completion detail and preserves it exactly in JSON', async () => {
    const detail = {
      captureId, captureRevision: 4, expectedGenerationId: 'generation-1',
      sourceSummary: { displayName: 'Job board', provider: 'example', observedAt: '2026-07-24T12:00:00.000Z' },
      provenance: [], destination: { status: 'resolved', url: destination.url },
      rawEvidence: [{ captureRevision: 4, evidenceIndex: 0, label: 'Posting', displayValue: destination.url }],
      exactEvidenceReferences: [
        { captureId, captureRevision: 4, evidenceIndexes: [0] },
        { captureId, captureRevision: 4, evidenceIndexes: [1, 2] },
      ],
      jobDefaults: {}, lastIssue: null,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse(detail))
    vi.stubGlobal('fetch', fetchMock)

    const human = await runCli(['captures', 'resolution', 'get', captureId, '--workspace', workspaceId])
    const structured = await runCli([
      'captures', 'resolution', 'get', captureId, '--workspace', workspaceId, '--json',
    ])

    expect(human.exitCode).toBe(0)
    expect(human.stdout).toContain(`Capture ${captureId} revision 4`)
    expect(human.stdout).toContain('Expected generation: generation-1')
    expect(human.stdout).toContain('Evidence items: 1')
    expect(human.stdout).toContain(`capture=${captureId} revision=4 indexes=0`)
    expect(human.stdout).toContain(`capture=${captureId} revision=4 indexes=1, 2`)
    expect(JSON.parse(structured.stdout)).toEqual(detail)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([detailUrlV2, detailUrlV1])
  })

  it('keeps the v1 JSON contract, including jobDefaults destination class', async () => {
    const detail = completionDetail({
      jobDefaults: { companyName: 'Delta Labs', roleTitle: 'Platform Engineer', destination },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(jsonResponse(detail)))
    vi.stubGlobal('fetch', fetchMock)

    const structured = await runCli([
      'captures', 'resolution', 'get', captureId, '--workspace', workspaceId, '--json',
    ])

    expect(structured.exitCode).toBe(0)
    expect(JSON.parse(structured.stdout)).toEqual(detail)
    expect(JSON.parse(structured.stdout).jobDefaults.destination).toEqual({
      class: 'employer_or_ats', url: destination.url,
    })
    expect(fetchMock).toHaveBeenCalledWith(detailUrlV1, expect.objectContaining({ method: 'GET' }))
  })

  it.each(['hidden', 'closed'])('reports the resolved %s provider status without an issue', async (providerStatus) => {
    const detail = completionDetail({
      destination: { status: 'resolved', url: destination.url, providerStatus },
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(jsonResponse(detail)))
    vi.stubGlobal('fetch', fetchMock)

    const human = await runCli(['captures', 'resolution', 'get', captureId, '--workspace', workspaceId])

    expect(human.exitCode).toBe(0)
    expect(human.stdout).toContain(`Destination: resolved (provider status: ${providerStatus})`)
    expect(human.stdout).toContain('Issue: none')
    expect(fetchMock).toHaveBeenCalledWith(detailUrlV2, expect.objectContaining({ method: 'GET' }))
  })

  it('explains provider-internal suppression with safe details in allowlist order', () => {
    const output = formatHumanOutput(completionDetail({
      destination: { status: 'action_required', url: null },
      lastIssue: destinationIssue(
        'destination_unsupported', 'complete_job_information',
        'The provider destination points back to Jobright and was suppressed.',
        {
          providerField: 'apply_link',
          providerEvidenceKind: 'jobright_destination_provider_internal',
          providerReason: 'provider_internal_destination',
          ...resolverDetails,
        },
      ),
    }))

    expect(output).toContain(
      'Issue: destination_unsupported - The provider destination points back to Jobright and was suppressed. (action: complete_job_information)',
    )
    expect(output).toContain([
      'Issue details:',
      '- Resolver id: jobright-url-resolver',
      '- Resolver version: 1.4.0',
      '- Provider reason: provider_internal_destination',
      '- Provider evidence kind: jobright_destination_provider_internal',
      '- Provider field: apply_link',
    ].join('\n'))
  })

  it('explains security rejection without the rejected URL, record identifiers, or credentials', () => {
    const output = formatHumanOutput(completionDetail({
      destination: { status: 'blocked', url: null },
      lastIssue: destinationIssue(
        'destination_security_rejected', null, 'The provider returned an unsafe destination URL.',
        {
          ...resolverDetails, safetyReason: 'blocked_host',
          rejectedUrl: 'https://internal.jobright.example/apply?sid=zzz999',
          providerRecordId: 'jobright-record-9911', sessionToken: 'session-zzz999',
        },
      ),
    }))

    expect(output).toContain(
      'Issue: destination_security_rejected - The provider returned an unsafe destination URL. (action: none)',
    )
    expect(output).toContain('- Safety reason: blocked_host')
    for (const secret of [
      'rejectedUrl', 'internal.jobright.example', 'zzz999',
      'providerRecordId', 'jobright-record-9911', 'sessionToken',
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  it('explains a no-candidate destination outcome with its exact recovery action', () => {
    const output = formatHumanOutput(completionDetail({
      destination: { status: 'action_required', url: null },
      lastIssue: destinationIssue(
        'destination_not_found', 'complete_job_information',
        'The provider supplied no usable destination URL.',
        {
          ...resolverDetails, providerReason: 'destination_unavailable',
          providerEvidenceKind: 'jobright_destination_missing',
        },
      ),
    }))

    expect(output).toContain('Destination: action_required')
    expect(output).toContain(
      'Issue: destination_not_found - The provider supplied no usable destination URL. (action: complete_job_information)',
    )
    expect(output).toContain('- Provider reason: destination_unavailable')
    expect(output).toContain('- Provider evidence kind: jobright_destination_missing')
    expect(output).not.toContain('Provider field')
  })

  it('renders a parser-change diagnostic and preserves the payload exactly in JSON', async () => {
    const detail = completionDetail({
      destination: { status: 'action_required', url: null },
      lastIssue: destinationIssue(
        'destination_unsupported', 'correct_capture',
        'The provider destination response schema changed.',
        { ...resolverDetails, providerReason: 'provider_schema_changed', parserChanged: true },
      ),
    })
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(jsonResponse(detail)))
    vi.stubGlobal('fetch', fetchMock)

    const human = await runCli(['captures', 'resolution', 'get', captureId, '--workspace', workspaceId])
    const structured = await runCli([
      'captures', 'resolution', 'get', captureId, '--workspace', workspaceId, '--json',
    ])

    expect(human.exitCode).toBe(0)
    expect(human.stdout).toContain(
      'Issue: destination_unsupported - The provider destination response schema changed. (action: correct_capture)',
    )
    expect(human.stdout).toContain('- Provider reason: provider_schema_changed')
    expect(human.stdout).toContain('- Parser changed: true')
    expect(structured.exitCode).toBe(0)
    expect(JSON.parse(structured.stdout)).toEqual(detail)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([detailUrlV2, detailUrlV1])
  })

  it('sends exact completion guards and renders duplicate conflicts as actionable exit 4', async () => {
    const blocked = {
      status: 'duplicate_blocked', blockerCode: 'deterministic_duplicate',
      conflictingJobs: [{
        jobId, jobFactsRevision: 3, companyId, companyRevision: 7, assignmentRevision: 2,
      }, {
        jobId: '018f0f2e-7b16-7a01-8c8c-20c6a9d52302', jobFactsRevision: 4,
        companyId: 'company-2', companyRevision: 3, assignmentRevision: 5,
      }],
      allowedDecisions: ['attach', 'merge'],
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(blocked))
      .mockResolvedValueOnce(jsonResponse(blocked))
    vi.stubGlobal('fetch', fetchMock)

    const human = await runCli([
      'captures', 'resolution', 'complete', captureId, '--workspace', workspaceId,
      '--input-json', json(completeInput()),
    ])
    const structured = await runCli([
      'captures', 'resolution', 'complete', captureId, '--workspace', workspaceId,
      '--input-json', json(completeInput()), '--json',
    ])

    expect(human.exitCode).toBe(4)
    expect(human.stdout).toContain('Duplicate Job conflict: deterministic_duplicate')
    expect(human.stdout).toContain(`job=${jobId} facts-revision=3`)
    expect(human.stdout).toContain(`company=${companyId} company-revision=7 assignment-revision=2`)
    expect(human.stdout).toContain('job=018f0f2e-7b16-7a01-8c8c-20c6a9d52302 facts-revision=4')
    expect(human.stdout).toContain('company=company-2 company-revision=3 assignment-revision=5')
    expect(structured.exitCode).toBe(4)
    expect(JSON.parse(structured.stdout)).toEqual(blocked)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ...completeInput(),
    })
  })

  it.each([
    ['retry', { expectedCaptureRevision: 4, expectedGenerationId: 'generation-1', idempotencyKey: 'retry-1', actor }],
    ['replay', { expectedCaptureRevision: 4, expectedGenerationId: 'generation-1', idempotencyKey: 'replay-1', actor, rationale: 'Replay after provider repair.' }],
  ])('uses the typed %s command and reports the new generation', async (command, input) => {
    const started = {
      captureId, requestCaptureRevision: 4, requestGenerationId: 'generation-1',
      idempotencyKey: input.idempotencyKey, status: 'started', captureRevision: 4,
      generationId: 'generation-2',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(started)))

    const result = await runCli([
      'captures', 'resolution', command, captureId, '--workspace', workspaceId,
      '--input-json', json(input), '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(started)
  })

  it('keeps promoted Capture retry rejection typed and nonzero', async () => {
    const blocked = {
      captureId, requestCaptureRevision: 4, requestGenerationId: 'generation-1',
      idempotencyKey: 'retry-promoted', status: 'blocked', currentCaptureRevision: 4,
      currentGenerationId: 'generation-1',
      blocker: { code: 'impossible_state', message: 'Capture is already promoted.' },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(blocked)))

    const result = await runCli([
      'captures', 'resolution', 'retry', captureId, '--workspace', workspaceId,
      '--input-json', json({
        expectedCaptureRevision: 4, expectedGenerationId: 'generation-1',
        idempotencyKey: 'retry-promoted', actor,
      }), '--json',
    ])

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(result.stdout)).toEqual(blocked)
  })

  it('renders Company assignment conflicts as actionable typed outcomes', async () => {
    const blocked = {
      status: 'company_assignment_blocked', blockerCode: 'invalid_input', existingJobId: jobId,
      currentCompanyId: companyId, currentCompanyRevision: 7, assignmentRevision: 2,
      allowedRecovery: ['use_existing_company', 'reassign_company'],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(blocked)))

    const result = await runCli([
      'captures', 'resolution', 'complete', captureId, '--workspace', workspaceId,
      '--input-json', json(completeInput()),
    ])

    expect(result.exitCode).toBe(4)
    expect(result.stdout).toContain(`Company assignment conflict: ${jobId}`)
    expect(result.stdout).toContain('Assignment revision: 2')
    expect(result.stdout).toContain('Allowed: use_existing_company, reassign_company')
  })

  it('renders every stale recovery guard with expected and current values', () => {
    const output = formatHumanOutput({
      status: 'blocked',
      failure: {
        kind: 'stale_guard',
        blocker: { code: 'impossible_state', message: 'Refresh before resubmitting.' },
        recovery: {
          action: 'refresh_and_resubmit',
          guards: [
            { kind: 'capture_revision', expectedRevision: 4, currentRevision: 5 },
            { kind: 'generation', expectedGenerationId: 'generation-1', currentGenerationId: 'generation-2' },
            { kind: 'company_revision', companyId, expectedRevision: 7, currentRevision: 8 },
            { kind: 'assignment_revision', jobId, expectedRevision: 2, currentRevision: 3 },
            { kind: 'duplicate_candidate_revision', candidateId: 'candidate-1', expectedRevision: 1, currentRevision: 2 },
          ],
        },
      },
    })

    expect(output).toContain('capture revision expected=4 current=5')
    expect(output).toContain('generation expected=generation-1 current=generation-2')
    expect(output).toContain(`company=${companyId} revision expected=7 current=8`)
    expect(output).toContain(`job=${jobId} assignment revision expected=2 current=3`)
    expect(output).toContain('candidate=candidate-1 revision expected=1 current=2')
  })

  it('returns a nonzero stale reassignment result with refresh guards in human mode', async () => {
    const blocked = {
      status: 'blocked', workspaceId, idempotencyKey: 'reassign-stale-1', jobId,
      requestAssignmentRevision: 2, destinationCompanyId: companyId,
      requestDestinationCompanyRevision: 7,
      failure: {
        kind: 'stale_guard',
        blocker: { code: 'impossible_state', message: 'The assignment changed.' },
        recovery: {
          action: 'refresh_and_resubmit',
          guards: [
            { kind: 'assignment_revision', jobId, expectedRevision: 2, currentRevision: 3 },
            { kind: 'company_revision', companyId, expectedRevision: 7, currentRevision: 8 },
          ],
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(blocked)))

    const result = await runCli([
      'jobs', 'company', 'reassign', jobId, '--workspace', workspaceId,
      '--input-json', json({
        actor, rationale: 'Correct grouping.', idempotencyKey: 'reassign-stale-1',
        expectedAssignmentRevision: 2, destinationCompanyId: companyId,
        expectedDestinationCompanyRevision: 7,
      }),
    ])

    expect(result.exitCode).toBe(4)
    expect(result.stdout).toContain(`job=${jobId} assignment revision expected=2 current=3`)
    expect(result.stdout).toContain(`company=${companyId} revision expected=7 current=8`)
  })

  it('renders bounded Company reads, keyset pages, duplicate sides, assignments, and history', async () => {
    const lookup = { requested: company(), canonical: company(), redirectPath: [] }
    const candidate = {
      candidateId: 'candidate-1', candidateRevision: 2, left: companySearchResult(),
      right: companySearchResult({ companyId: 'company-2', revision: 3, displayName: 'Delta Laboratories' }),
      score: 0.92, reasons: [{ code: 'normalized_name_similarity', label: 'Similar normalized names.' }],
      status: 'open', updatedAt: '2026-07-24T12:00:00.000Z',
    }
    const assigned = {
      jobId, assignmentRevision: 2,
      workspaceCompany: { companyId, revision: 7, displayName: 'Delta Labs', status: 'active' },
      jobFactsCompanyName: 'Delta Labs Inc.', roleTitle: 'Platform Engineer', namesDiffer: true,
    }
    const history = {
      eventId: 'company-event-1', workspaceId, companyId, companyRevision: 7, kind: 'updated',
      occurredAt: '2026-07-24T12:00:00.000Z', actor,
      rationale: 'Verified careers site.',
      change: {
        priorRevision: 6, newRevision: 7, changedFields: ['display_name'], aliasId: null,
        relatedCompanyId: null, affectedJobCount: 0,
      },
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse({ items: [companySearchResult()], truncated: false }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          companyId, revision: 7, displayName: 'Delta Labs', websiteHost: 'delta.example.com', status: 'active',
          assignedJobCount: 3,
          openDuplicateCandidateCount: 1, updatedAt: '2026-07-24T12:00:00.000Z', canonicalCompanyId: companyId,
        }], pageInfo: pageInfo(), totalCount: 1,
      }))
      .mockResolvedValueOnce(jsonResponse({
        lookup, assignedJobCount: 3, openDuplicateCandidateCount: 1,
        history: { lastEventAt: '2026-07-24T12:00:00.000Z', eventCount: 7, recentEvents: [] },
      }))
      .mockResolvedValueOnce(jsonResponse(lookup))
      .mockResolvedValueOnce(jsonResponse({ items: [candidate], pageInfo: pageInfo(), totalCount: 1 }))
      .mockResolvedValueOnce(jsonResponse({ items: [assigned], pageInfo: pageInfo(), totalCount: 1 }))
      .mockResolvedValueOnce(jsonResponse({ items: [history], pageInfo: pageInfo(), totalCount: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const commands = [
      ['companies', 'search', '--workspace', workspaceId, '--input-json', '{"query":"delta"}'],
      ['companies', 'list', '--workspace', workspaceId],
      ['companies', 'get', companyId, '--workspace', workspaceId],
      ['companies', 'lookup', companyId, '--workspace', workspaceId],
      ['companies', 'duplicates', 'list', '--workspace', workspaceId],
      ['companies', 'assigned-jobs', 'list', companyId, '--workspace', workspaceId],
      ['companies', 'history', 'list', companyId, '--workspace', workspaceId],
    ]
    const outputs = []
    for (const command of commands) outputs.push(await runCli(command))

    expect(outputs.map((result) => result.exitCode)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(outputs[0]?.stdout).toContain(`Delta Labs id=${companyId} revision=7 status=active`)
    expect(outputs[1]?.stdout).toContain('Page: total=1 start=cursor-start end=cursor-end')
    expect(outputs[2]?.stdout).toContain(`Company: Delta Labs id=${companyId} revision=7 status=active`)
    expect(outputs[3]?.stdout).toContain(`Company lookup: Delta Labs id=${companyId}`)
    expect(outputs[4]?.stdout).toContain('candidate=candidate-1 revision=2')
    expect(outputs[4]?.stdout).toContain('left=Delta Labs')
    expect(outputs[4]?.stdout).toContain('right=Delta Laboratories')
    expect(outputs[5]?.stdout).toContain(`job=${jobId} assignment-revision=2`)
    expect(outputs[6]?.stdout).toContain('event=company-event-1 kind=updated')
  })

  it('retains Company command labels for empty preview and keyset pages', async () => {
    const emptyPreview = { items: [], truncated: false }
    const emptyPage = {
      items: [],
      pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false },
      totalCount: 0,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(emptyPreview))
      .mockResolvedValueOnce(jsonResponse(emptyPage))
      .mockResolvedValueOnce(jsonResponse(emptyPage))
      .mockResolvedValueOnce(jsonResponse(emptyPage))
      .mockResolvedValueOnce(jsonResponse(emptyPage))
      .mockResolvedValueOnce(jsonResponse(emptyPreview))
    vi.stubGlobal('fetch', fetchMock)

    const preview = await runCli([
      'companies', 'preview-matches', '--workspace', workspaceId,
      '--input-json', '{"displayName":"Delta Labs"}',
    ])
    const directory = await runCli(['companies', 'list', '--workspace', workspaceId])
    const duplicates = await runCli(['companies', 'duplicates', 'list', '--workspace', workspaceId])
    const assignedJobs = await runCli([
      'companies', 'assigned-jobs', 'list', companyId, '--workspace', workspaceId,
    ])
    const history = await runCli([
      'companies', 'history', 'list', companyId, '--workspace', workspaceId,
    ])
    const previewJson = await runCli([
      'companies', 'preview-matches', '--workspace', workspaceId,
      '--input-json', '{"displayName":"Delta Labs"}', '--json',
    ])

    expect([
      preview.exitCode, directory.exitCode, duplicates.exitCode, assignedJobs.exitCode,
      history.exitCode, previewJson.exitCode,
    ]).toEqual([0, 0, 0, 0, 0, 0])
    expect(preview.stdout).toContain('Company match preview: 0 results')
    expect(directory.stdout).toContain('Company directory: 0 page items; total=0')
    expect(duplicates.stdout).toContain('Duplicate candidates: 0 page items; total=0')
    expect(assignedJobs.stdout).toContain('Assigned Jobs: 0 page items; total=0')
    expect(history.stdout).toContain('Company history: 0 page items; total=0')
    expect(JSON.parse(previewJson.stdout)).toEqual(emptyPreview)
  })

  it('formats direct duplicate, Job assignment, and Company match-preview responses', async () => {
    const candidate = {
      candidateId: 'candidate-1', candidateRevision: 2, left: companySearchResult(),
      right: companySearchResult({ companyId: 'company-2', revision: 3, displayName: 'Delta Laboratories' }),
      score: 0.92, reasons: [{ code: 'normalized_name_similarity', label: 'Similar normalized names.' }],
      status: 'open', updatedAt: '2026-07-24T12:00:00.000Z',
    }
    const assignment = {
      jobId, assignmentRevision: 2,
      workspaceCompany: { companyId, revision: 7, displayName: 'Delta Labs', status: 'active' },
      jobFactsCompanyName: 'Delta Labs Inc.', roleTitle: 'Platform Engineer', namesDiffer: true,
    }
    const preview = {
      items: [{
        companyId, revision: 7, displayName: 'Delta Labs', websiteUrl: 'https://delta.example.com',
        score: 0.92,
        reasons: [{ code: 'same_declared_domain', label: 'Matches declared website domain.' }],
      }],
      truncated: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(candidate))
      .mockResolvedValueOnce(jsonResponse(assignment))
      .mockResolvedValueOnce(jsonResponse(preview))
    vi.stubGlobal('fetch', fetchMock)

    const duplicate = await runCli([
      'companies', 'duplicates', 'get', 'candidate-1', '--workspace', workspaceId,
    ])
    const jobAssignment = await runCli(['jobs', 'company', 'get', jobId, '--workspace', workspaceId])
    const matches = await runCli([
      'companies', 'preview-matches', '--workspace', workspaceId,
      '--input-json', '{"displayName":"Delta Labs","websiteUrl":"https://delta.example.com"}',
    ])

    expect(duplicate.exitCode).toBe(0)
    expect(duplicate.stdout).toContain('Duplicate candidate: candidate=candidate-1 revision=2 status=open score=0.92')
    expect(duplicate.stdout).toContain(`left=Delta Labs id=${companyId} revision=7 status=active`)
    expect(duplicate.stdout).toContain('right=Delta Laboratories id=company-2 revision=3 status=active')
    expect(jobAssignment.exitCode).toBe(0)
    expect(jobAssignment.stdout).toContain(`Job Company assignment: job=${jobId} assignment-revision=2`)
    expect(jobAssignment.stdout).toContain(`company=Delta Labs id=${companyId} revision=7 status=active`)
    expect(matches.exitCode).toBe(0)
    expect(matches.stdout).toContain('Company match preview: 1 result')
    expect(matches.stdout).toContain(`Delta Labs id=${companyId} revision=7`)
    expect(matches.stdout).toContain('score=0.92 reasons=same_declared_domain')
  })

  it('preserves Company mutation, duplicate-review, merge, and reassignment outcomes in human output', async () => {
    const candidate = {
      candidateId: 'candidate-1', candidateRevision: 3, left: companySearchResult(),
      right: companySearchResult({ companyId: 'company-2', revision: 3, displayName: 'Delta Laboratories' }),
      score: 0.92, reasons: [{ code: 'normalized_name_similarity', label: 'Similar normalized names.' }],
      status: 'marked_distinct', updatedAt: '2026-07-24T12:00:00.000Z',
    }
    const assignment = {
      jobId, assignmentRevision: 3,
      workspaceCompany: { companyId, revision: 7, displayName: 'Delta Labs', status: 'active' },
      jobFactsCompanyName: 'Delta Labs Inc.', roleTitle: 'Platform Engineer', namesDiffer: true,
    }
    const created = {
      workspaceId, companyId, idempotencyKey: 'company-write-1', status: 'created',
      requestCompanyRevision: null, company: company({ websiteUrl: null, notes: null }),
    }
    const markedDistinct = {
      status: 'marked_distinct', workspaceId, candidateId: 'candidate-1', requestCandidateRevision: 2,
      leftCompanyId: companyId, requestLeftCompanyRevision: 7, rightCompanyId: 'company-2',
      requestRightCompanyRevision: 3, idempotencyKey: 'company-write-1', candidate,
    }
    const merged = {
      status: 'merged', workspaceId, idempotencyKey: 'company-write-1', requestWinnerCompanyRevision: 7,
      requestLoserCompanyRevision: 4, canonical: company({ revision: 8 }),
      merged: company({
        id: 'company-2', displayName: 'Delta Laboratories', revision: 5, status: 'merged',
        mergedIntoCompanyId: companyId,
      }),
      redirectPath: [companyId], reassignedJobCount: 2, flattenedRedirectCount: 1,
      resolvedCandidateCount: 3, historyPreserved: true, notesPreserved: { winner: true, loser: true },
    }
    const reassigned = {
      status: 'reassigned', workspaceId, jobId, requestAssignmentRevision: 2,
      requestDestinationCompanyRevision: 7, idempotencyKey: 'company-write-1', assignment,
      jobFactsChanged: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(created))
      .mockResolvedValueOnce(jsonResponse(markedDistinct))
      .mockResolvedValueOnce(jsonResponse(merged))
      .mockResolvedValueOnce(jsonResponse(reassigned))
    vi.stubGlobal('fetch', fetchMock)

    const create = await runCli([
      'companies', 'create', '--workspace', workspaceId,
      '--input-json', json(companyWrite({ displayName: 'Delta Labs' })),
    ])
    const distinct = await runCli([
      'companies', 'duplicates', 'mark-distinct', 'candidate-1', '--workspace', workspaceId,
      '--input-json', json(companyWrite({
        expectedCandidateRevision: 2, leftCompanyId: companyId, expectedLeftCompanyRevision: 7,
        rightCompanyId: 'company-2', expectedRightCompanyRevision: 3,
      })),
    ])
    const merge = await runCli([
      'companies', 'duplicates', 'merge', companyId, 'company-2', '--workspace', workspaceId,
      '--input-json', json(companyWrite({
        expectedWinnerCompanyRevision: 7, expectedLoserCompanyRevision: 4,
        loserDisplayNameConfirmation: 'Delta Laboratories', acknowledgeNoUndo: true,
      })),
    ])
    const reassign = await runCli([
      'jobs', 'company', 'reassign', jobId, '--workspace', workspaceId,
      '--input-json', json(companyWrite({
        expectedAssignmentRevision: 2, destinationCompanyId: companyId,
        expectedDestinationCompanyRevision: 7,
      })),
    ])

    expect(create.exitCode).toBe(0)
    expect(create.stdout).toContain(`Company created: Delta Labs id=${companyId} revision=7 status=active`)
    expect(create.stdout).toContain('Request revision: null')
    expect(distinct.exitCode).toBe(0)
    expect(distinct.stdout).toContain('Duplicate candidate marked distinct: candidate=candidate-1 revision=3')
    expect(distinct.stdout).toContain('left=Delta Labs id=company-1 revision=7 status=active')
    expect(distinct.stdout).toContain('right=Delta Laboratories id=company-2 revision=3 status=active')
    expect(merge.exitCode).toBe(0)
    expect(merge.stdout).toContain('Delta Laboratories id=company-2 revision=5 status=merged')
    expect(merge.stdout).toContain(`Delta Labs id=${companyId} revision=8 status=active`)
    expect(merge.stdout).toContain('Request revisions: winner=7 loser=4')
    expect(merge.stdout).toContain('Reassigned jobs: 2; resolved candidates: 3')
    expect(reassign.exitCode).toBe(0)
    expect(reassign.stdout).toContain(`Job reassigned: job=${jobId} assignment-revision=3`)
    expect(reassign.stdout).toContain(`company=Delta Labs id=${companyId} revision=7 status=active`)
    expect(reassign.stdout).toContain('Request revisions: assignment=2 destination-company=7')
  })

  it('defaults Company search to active and makes archived recovery explicit', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ items: [], truncated: false })))
    vi.stubGlobal('fetch', fetchMock)

    const active = await runCli([
      'companies', 'search', '--workspace', workspaceId, '--input-json', '{"query":"delta"}', '--json',
    ])
    const archived = await runCli([
      'companies', 'search', '--workspace', workspaceId,
      '--input-json', '{"query":"delta","scope":"active_and_archived"}', '--json',
    ])

    expect([active.exitCode, archived.exitCode]).toEqual([0, 0])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('query=delta&scope=active&limit=20')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('scope=active_and_archived')
  })

  it.each([
    ['companies create', ['companies', 'create'], companyWrite({ displayName: 'Delta Labs' })],
    ['companies archive', ['companies', 'archive', companyId], companyWrite({ expectedCompanyRevision: 7 })],
    ['companies restore', ['companies', 'restore', companyId], companyWrite({ expectedCompanyRevision: 8 })],
    ['companies duplicates mark-distinct', ['companies', 'duplicates', 'mark-distinct', 'candidate-1'], companyWrite({
      expectedCandidateRevision: 2, leftCompanyId: companyId, expectedLeftCompanyRevision: 7,
      rightCompanyId: 'company-2', expectedRightCompanyRevision: 3,
    })],
    ['jobs company reassign', ['jobs', 'company', 'reassign', jobId], companyWrite({
      expectedAssignmentRevision: 2, destinationCompanyId: companyId,
      expectedDestinationCompanyRevision: 7,
    })],
  ])('uses the typed client for %s and injects the selected workspace', async (_name, command, input) => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse({ message: 'Authentication required.' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      ...command, '--workspace', workspaceId, '--input-json', json(input), '--json',
    ])

    expect(result.exitCode).toBe(3)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.workspaceId).toBeUndefined()
    expect(body.actor).toEqual(actor)
  })

  it('requires an explicit winner, current revisions, exact loser name, and no-undo acknowledgement', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const input = companyWrite({
      expectedWinnerCompanyRevision: 7,
      expectedLoserCompanyRevision: 4,
      loserDisplayNameConfirmation: 'Delta Labs, Inc.',
    })

    const result = await runCli([
      'companies', 'duplicates', 'merge', companyId, 'company-2', '--workspace', workspaceId,
      '--input-json', json(input), '--json',
    ])

    expect(result.exitCode).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'usage_error' } })
  })

  it('sends acknowledged merge guards to the typed Company client', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse({ message: 'Authentication required.' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const input = companyWrite({
      expectedWinnerCompanyRevision: 7,
      expectedLoserCompanyRevision: 4,
      loserDisplayNameConfirmation: 'Delta Labs, Inc.',
      acknowledgeNoUndo: true,
    })

    const result = await runCli([
      'companies', 'duplicates', 'merge', companyId, 'company-2', '--workspace', workspaceId,
      '--input-json', json(input), '--json',
    ])

    expect(result.exitCode).toBe(3)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      winnerCompanyId: companyId,
      loserCompanyId: 'company-2',
      loserDisplayNameConfirmation: 'Delta Labs, Inc.',
      acknowledgeNoUndo: true,
    })
  })

  it('keeps feature commands on the typed SDK boundary with no database or raw-route access', () => {
    const files = [
      'src/valedictorian-cli.capture-resolution-commands.ts',
      'src/valedictorian-cli.company-commands.ts',
      'src/valedictorian-cli.job-commands.ts',
    ]
    const source = files.map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n')

    expect(source).toContain("from '@sparxie/sdk'")
    expect(source).not.toMatch(/from ['"][^'"]*(?:sqlite|prisma|postgres|database|db)[^'"]*['"]/i)
    expect(source).not.toContain('requestValedictorianJson')
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toContain("'/v1/")
  })
})
