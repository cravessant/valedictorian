import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

const jobId = '018f0f2e-7b16-7a01-8c8c-20c6a9d52301'
const actor = { id: 'user-1', type: 'user' }
const override = { actor, rationale: 'Reviewer confirmed fit.', warningCodes: ['fit'] }
const warnings = [
  'fit', 'rank', 'cutoff', 'missing_optional_facts', 'third_party_destination', 'weak_possible_match',
].map((code) => ({ code, message: `${code} requires confirmation.` }))
const facts = {
  companyName: 'Delta Labs', roleTitle: 'Platform Engineer', sourceName: 'Employer site',
  roleKind: 'experienced', term: null, terms: [], timingMode: 'unknown', startDate: null,
  endDate: null, location: null, workMode: 'remote', employmentType: 'full_time',
  seniority: 'mid', compensation: null, postedAt: null,
  destination: { class: 'employer_or_ats', url: 'https://jobs.example.com/role' },
}
const evidenceReferences = [{ captureId: 'capture-1', captureRevision: 1, evidenceIndexes: [0] }]
const input = {
  idempotencyKey: 'promote-capture-1', actor, captureRevision: 1, selectedFacts: facts,
  evidenceReferences, externalIdentities: [],
}

describe('lifecycle typed output', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves warnings, override, duplicate resolution, and the discriminant as JSON', async () => {
    const resultBody = {
      status: 'promoted',
      resource: {
        id: jobId,
        workspaceId: 'workspace-1',
        factsRevision: 1,
        facts,
        availabilityRevision: 1,
        availability: { state: 'unknown', observedAt: '2026-07-21T18:00:00.000Z' },
        externalIdentities: [],
        captureEvidenceReferences: evidenceReferences,
        createdAt: '2026-07-21T18:00:00.000Z',
        updatedAt: '2026-07-21T18:00:00.000Z',
        removedAt: null,
      },
      created: false,
      warnings,
      override,
      duplicateResolution: { action: 'attach', targetResourceId: jobId },
      audit: { actor, timestamp: '2026-07-21T18:00:00.000Z', override },
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(resultBody))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'captures', 'promote-to-job', 'capture-1', '--workspace', 'workspace-1',
      '--input-json', JSON.stringify(input), '--duplicate-action', 'attach',
      '--duplicate-target-id', jobId, '--idempotency-key', 'explicit-idempotency',
      '--override-actor-id', actor.id,
      '--override-actor-type', actor.type, '--override-rationale', override.rationale,
      '--override-warning-codes-json', '["fit"]', '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(resultBody)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      idempotencyKey: 'explicit-idempotency',
      override,
      duplicateResolution: { action: 'attach', targetResourceId: jobId },
    })
  })

  it('accepts the merge duplicate resolution without collapsing a blocker', async () => {
    const blocked = {
      status: 'blocked',
      blocker: {
        code: 'deterministic_duplicate',
        message: 'Choose an existing opportunity.',
        conflictingResourceId: 'opportunity-2',
        allowedDuplicateResolutions: ['attach', 'merge'],
      },
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse(blocked))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'jobs', 'promote-to-opportunity', jobId, '--workspace', 'workspace-1',
      '--input-json', JSON.stringify({
        idempotencyKey: 'promote-job-1', actor, expectedFactsRevision: 1,
        evaluation: { fit: 'fit', rank: 1, cutoff: 'above', disposition: 'pursue' },
      }),
      '--duplicate-action', 'merge', '--duplicate-target-id', 'opportunity-2', '--json',
    ])

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(result.stdout)).toEqual(blocked)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      duplicateResolution: { action: 'merge', targetResourceId: 'opportunity-2' },
    })
  })

  it('keeps blockers and dependent choices complete in JSON', async () => {
    const blocked = {
      status: 'blocked',
      id: 'application-1',
      blocker: {
        code: 'deterministic_duplicate',
        message: 'Dependent resources must be resolved.',
        conflictingResourceId: 'application-2',
        allowedDuplicateResolutions: ['attach', 'merge'],
      },
      supportedChoices: ['reject_if_dependents', 'preserve_historical_lineage'],
      dependentIds: ['attempt-1'],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(blocked)))

    const result = await runCli([
      'applications', 'remove', 'application-1', '--workspace', 'workspace-1',
      '--choice', 'reject_if_dependents', '--actor-id', actor.id, '--actor-type', actor.type,
      '--rationale', 'Retire stale application.', '--json',
    ])

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(result.stdout)).toEqual(blocked)
  })

  it('preserves succeeded mutation results', async () => {
    const resource = {
      id: 'capture-1', workspaceId: 'workspace-1', revision: 1,
      evidenceMode: 'reported', adapter: { id: 'cli-1', kind: 'cli', version: '1.0.0' },
      observedAt: '2026-07-21T18:00:00.000Z', receivedAt: '2026-07-21T18:00:01.000Z',
      providerRecordId: null, providerSchema: null, payload: null, evidence: [],
      createdAt: '2026-07-21T18:00:01.000Z', updatedAt: '2026-07-21T18:00:01.000Z',
      removedAt: null,
    }
    const succeeded = {
      status: 'succeeded', resource, duplicateResolution: null,
      audit: { actor: { id: 'system-1', type: 'system' }, timestamp: '2026-07-21T18:00:01.000Z' },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(succeeded)))

    const result = await runCli([
      'captures', 'create', '--workspace', 'workspace-1', '--evidence-mode', 'reported',
      '--adapter-id', 'cli-1', '--adapter-kind', 'cli', '--adapter-version', '1.0.0',
      '--observed-at', '2026-07-21T18:00:00.000Z', '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(succeeded)
  })

  it.each([
    ['manual', 'reported'],
    ['import', 'ats_details_provided'],
    ['connector', 'ats_details_provided'],
  ])('creates %s captures through the canonical provenance contract', async (adapterKind, evidenceMode) => {
    const blocked = {
      status: 'blocked',
      blocker: { code: 'missing_lineage', message: 'Additional lineage is required.' },
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse(blocked))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'captures', 'create', '--workspace', 'workspace-1', '--evidence-mode', evidenceMode,
      '--adapter-id', `${adapterKind}-adapter`, '--adapter-kind', adapterKind,
      '--adapter-version', '1.0.0', '--observed-at', '2026-07-21T18:00:00.000Z',
      '--payload-json', '{"company":"Delta Labs"}',
      '--evidence-json', '[{"kind":"company","label":"Employer","value":"Delta Labs"}]',
      '--json',
    ])

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      evidenceMode,
      adapter: { id: `${adapterKind}-adapter`, kind: adapterKind, version: '1.0.0' },
      payload: { company: 'Delta Labs' },
    })
  })

  it.each([
    {
      name: 'removed',
      argv: [
        'captures', 'remove', 'capture-1', '--choice', 'reject_if_dependents',
        '--actor-id', actor.id, '--actor-type', actor.type, '--rationale', 'Remove it.',
      ],
      body: {
        status: 'removed', id: 'capture-1', choice: 'reject_if_dependents',
        removedAt: '2026-07-21T18:00:00.000Z', affectedDependentIds: [],
        audit: { actor, timestamp: '2026-07-21T18:00:00.000Z' },
      },
    },
    {
      name: 'restored',
      argv: [
        'captures', 'restore', 'capture-1', '--actor-id', actor.id,
        '--actor-type', actor.type, '--rationale', 'Restore it.',
      ],
      body: {
        status: 'restored', id: 'capture-1', restoredAt: '2026-07-21T18:00:00.000Z',
        dependentLinks: [], audit: { actor, timestamp: '2026-07-21T18:00:00.000Z' },
      },
    },
  ])('preserves $name command results', async ({ argv, body }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))
    const result = await runCli([...argv, '--workspace', 'workspace-1', '--json'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(body)
  })

  it('applies an override display-name flag to an override supplied in JSON', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse({ status: 'blocked', blocker: {
        code: 'missing_lineage', message: 'Still blocked.',
      } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'captures', 'promote-to-job', 'capture-1', '--workspace', 'workspace-1',
      '--input-json', JSON.stringify({ ...input, override }),
      '--override-actor-display-name', 'Review Lead', '--json',
    ])

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      override: { actor: { displayName: 'Review Lead' } },
    })
  })

  it('rejects a display-name-only override when no complete override exists', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'captures', 'promote-to-job', 'capture-1', '--workspace', 'workspace-1',
      '--input-json', JSON.stringify(input),
      '--override-actor-display-name', 'Review Lead', '--json',
    ])

    expect(result.exitCode).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders stable human messages for warnings and blockers', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'blocked',
        id: 'application-1',
        blocker: {
          code: 'deterministic_duplicate',
          message: 'Resolve the duplicate before removal.',
          field: 'evidenceReferences',
          conflictingResourceId: 'application-2',
          allowedDuplicateResolutions: ['attach', 'merge'],
        },
        supportedChoices: ['reject_if_dependents'],
        dependentIds: ['job-1'],
      })))

    const result = await runCli([
      'applications', 'remove', 'application-1', '--workspace', 'workspace-1',
      '--choice', 'reject_if_dependents', '--actor-id', actor.id, '--actor-type', actor.type,
      '--rationale', 'Retire duplicate.',
    ])

    expect(result.exitCode).toBe(4)
    expect(result.stdout).toContain(
      'Blocked: deterministic_duplicate - Resolve the duplicate before removal.',
    )
    expect(result.stdout).toContain('Field: evidenceReferences')
    expect(result.stdout).toContain('Conflicting resource: application-2')
    expect(result.stdout).toContain('Supported removal choices: reject_if_dependents')
    expect(result.stdout).toContain('Dependent resources: job-1')
  })

  it.each([
    'invalid_input', 'missing_lineage', 'foreign_lineage', 'workspace_ownership',
    'strong_identity_conflict', 'impossible_state', 'bounded_data_violation',
    'security_violation', 'deterministic_duplicate',
  ])('preserves the %s blocker class', async (code) => {
    const blocked = {
      status: 'blocked',
      blocker: {
        code,
        message: `Blocked by ${code}.`,
        ...(code === 'deterministic_duplicate'
          ? { conflictingResourceId: 'capture-2', allowedDuplicateResolutions: ['attach', 'merge'] }
          : {}),
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(blocked)))

    const result = await runCli([
      'captures', 'correct', 'capture-1', '--workspace', 'workspace-1',
      '--input-json', JSON.stringify({
        expectedRevision: 1, actor, rationale: 'Correction.', correction: { providerRecordId: 'role-1' },
      }), '--json',
    ])

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(result.stdout)).toEqual(blocked)
  })
})
