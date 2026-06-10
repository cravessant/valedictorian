import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, readPackageJson, runCli } from './valedictorian-cli.test-helpers'

describe('valedictorian-cli npm package', () => {
  const sparxieGitDependency =
    'github:KennySparxie/sparxie#acad8b518e65746513bc9cfa6082fe93c43ac34f'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes a valedictorian-cli bin and keeps Electron, UI, and SQLite out of the package', () => {
    const packageJson = readPackageJson()
    const dependencyNames = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    })

    expect(packageJson.name).toBe('valedictorian-cli')
    expect(packageJson.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/)
    expect(packageJson.bin?.['valedictorian-cli']).toBe('./dist/valedictorian.js')
    expect(packageJson.files).toEqual(['dist'])
    expect(packageJson.scripts?.prepare).toBe('pnpm build')
    expect(packageJson.scripts?.prepublishOnly).toBe('pnpm lint && pnpm test && pnpm build')
    expect(packageJson.dependencies?.sparxie).toBe(sparxieGitDependency)
    expect(Object.values(packageJson.scripts ?? {})).not.toEqual(
      expect.arrayContaining([expect.stringContaining('../sparxie')]),
    )
    expect(dependencyNames).not.toEqual(
      expect.arrayContaining([
        'electron',
        'react',
        'react-dom',
        'drizzle-orm',
        'better-sqlite3',
        '@types/better-sqlite3',
      ]),
    )
  })

  it('lists applications over HTTP with filters, pagination, sorting, and token auth', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 5,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(
      [
        'applications',
        'list',
        '--status',
        'needs_user_info',
        '--role',
        'backend',
        '--min-score',
        '6',
        '--sort',
        'company_asc',
        '--limit',
        '25',
        '--offset',
        '5',
        '--json',
      ],
      { VALEDICTORIAN_API_TOKEN: 'token-1' },
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/applications?status=needs_user_info&minScore=6&role=backend&sort=company_asc&limit=25&offset=5',
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer token-1',
        },
        method: 'GET',
      },
    )
  })

  it('lists queue rows over HTTP with bucket filtering, pagination, and token auth', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 5,
      hasMore: false,
      bucketCounts: { apply_now: 0 },
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(
      ['queue', 'list', '--bucket', 'apply_now', '--limit', '25', '--offset', '5', '--json'],
      { VALEDICTORIAN_API_TOKEN: 'token-1' },
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/queue?bucket=apply_now&limit=25&offset=5',
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer token-1',
        },
        method: 'GET',
      },
    )
  })

  it('gets applications, updates status, and records scores over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1', status: 'submitted' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(runCli(['applications', 'get', 'application-1', '--json'])).resolves.toMatchObject({
      exitCode: 0,
    })
    await expect(
      runCli([
        'applications',
        'status',
        'application-1',
        'submitted',
        '--notes',
        'Submitted from CLI.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'scores',
        'record',
        'application-1',
        '--score',
        '8',
        '--band',
        'high',
        '--role-relevance',
        '3',
        '--career-signal',
        '2',
        '--city-work-mode',
        '2',
        '--compensation-logistics',
        '1',
        '--rationale',
        'Strong fit.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/applications/application-1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/applications/application-1/status',
      expect.objectContaining({
        body: JSON.stringify({ status: 'submitted', notes: 'Submitted from CLI.' }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/scores',
      expect.objectContaining({
        body: expect.stringContaining('"applicationId":"application-1"') as string,
        method: 'POST',
      }),
    )
  })

  it('runs application mutation commands over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1', hasApplied: true }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1', notes: 'Reached review.' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'link-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'link-1', label: 'company site' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, limit: 50, offset: 0, hasMore: false }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'create',
        '--company-name',
        'Delta Labs',
        '--role-title',
        'Software Engineering Intern',
        '--source-name',
        'LinkedIn',
        '--role-kind',
        'internship',
        '--country',
        'US',
        '--work-mode',
        'remote',
        '--status',
        'queued',
        '--primary-url',
        'https://jobs.example.com/delta',
        '--initial-note',
        'Seeded by CLI.',
        '--json',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'update',
        'application-1',
        '--role-title',
        'Software Engineering Intern II',
        '--has-applied',
        'true',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'workflow',
        'application-1',
        '--missing-user-info',
        'Start date',
        '--hold-started-at',
        '2026-06-04T16:00:00.000Z',
        '--manual-review-kind',
        'overridable',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli(['applications', 'note', 'application-1', '--message', 'Reached review.']),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'link',
        'add',
        'application-1',
        '--kind',
        'official',
        '--label',
        'official',
        '--url',
        'https://jobs.example.com/delta',
        '--primary',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'link',
        'update',
        'application-1',
        'link-1',
        '--label',
        'company site',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli(['applications', 'events', 'application-1', '--limit', '50', '--json']),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli(['applications', 'archive', 'application-1', '--note', 'No longer pursuing.']),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/applications',
      expect.objectContaining({
        body: JSON.stringify({
          companyName: 'Delta Labs',
          roleTitle: 'Software Engineering Intern',
          sourceName: 'LinkedIn',
          roleKind: 'internship',
          country: 'US',
          workMode: 'remote',
          status: 'queued',
          primaryLink: {
            kind: 'official',
            label: 'official',
            url: 'https://jobs.example.com/delta',
          },
          initialNote: 'Seeded by CLI.',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/applications/application-1',
      expect.objectContaining({
        body: JSON.stringify({
          roleTitle: 'Software Engineering Intern II',
          hasApplied: true,
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/applications/application-1/workflow',
      expect.objectContaining({
        body: JSON.stringify({
          holdStartedAt: '2026-06-04T16:00:00.000Z',
          manualReviewKind: 'overridable',
          missingUserInfo: 'Start date',
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://valedictorian.test/v1/applications/application-1/notes',
      expect.objectContaining({
        body: JSON.stringify({ message: 'Reached review.' }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://valedictorian.test/v1/applications/application-1/links',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/delta',
          isPrimary: true,
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://valedictorian.test/v1/applications/application-1/links/link-1',
      expect.objectContaining({
        body: JSON.stringify({ label: 'company site' }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      'https://valedictorian.test/v1/applications/application-1/events?limit=50',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      'https://valedictorian.test/v1/applications/application-1/archive',
      expect.objectContaining({
        body: JSON.stringify({ note: 'No longer pursuing.' }),
        method: 'PATCH',
      }),
    )
  })

  it('runs application attempt commands over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'attempt-1', status: 'in_progress' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'step-1', sequence: 2 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'attempt-1', status: 'completed' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 'attempt-1' }], total: 1, limit: 25, offset: 0, hasMore: false }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'attempts',
        'start',
        'application-1',
        '--actor-type',
        'agent',
        '--actor-name',
        'codex',
        '--summary',
        'Started.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'attempts',
        'step',
        'application-1',
        'attempt-1',
        '--type',
        'page_verified',
        '--message',
        'Verified page.',
        '--actor',
        'agent:codex',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'applications',
        'attempts',
        'complete',
        'application-1',
        'attempt-1',
        '--outcome',
        'needs_user_info',
        '--summary',
        'Needs dates.',
        '--missing-user-info',
        'Fall 2026 dates',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli(['applications', 'attempts', 'list', 'application-1', '--limit', '25', '--json']),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/applications/application-1/attempts',
      expect.objectContaining({
        body: JSON.stringify({
          actorType: 'agent',
          actorName: 'codex',
          summary: 'Started.',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/applications/application-1/attempts/attempt-1/steps',
      expect.objectContaining({
        body: JSON.stringify({
          type: 'page_verified',
          message: 'Verified page.',
          actor: 'agent:codex',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/applications/application-1/attempts/attempt-1/complete',
      expect.objectContaining({
        body: JSON.stringify({
          outcome: 'needs_user_info',
          summary: 'Needs dates.',
          missingUserInfo: 'Fall 2026 dates',
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://valedictorian.test/v1/applications/application-1/attempts?limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('sends verification receipt attempt steps over HTTP with JSON payloads', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'step-1', sequence: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'attempts',
        'step',
        'application-1',
        'attempt-1',
        '--type',
        'verification_receipt',
        '--message',
        'Final review verification passed.',
        '--payload-json',
        JSON.stringify({
          version: 1,
          scope: 'final_review',
          status: 'passed',
          verified: ['resume_attachment', 'contact_info'],
          unresolved: [],
          evidence: 'Final review page showed resume and contact info.',
        }),
        '--actor',
        'agent:codex',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0]
    expect(requestUrl).toBe(
      'https://valedictorian.test/v1/applications/application-1/attempts/attempt-1/steps',
    )
    expect(requestInit).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      type: 'verification_receipt',
      message: 'Final review verification passed.',
      actor: 'agent:codex',
      payload: {
        version: 1,
        scope: 'final_review',
        status: 'passed',
        verified: ['resume_attachment', 'contact_info'],
        unresolved: [],
        evidence: 'Final review page showed resume and contact info.',
      },
    })
  })

  it('rejects invalid CLI-only input before calling HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    vi.stubGlobal('fetch', fetchMock)

    const invalidSort = await runCli(['applications', 'list', '--sort', 'random_sort'])
    const removedName = await runCli(['applications', 'list', '--name', 'astranis'])
    const invalidDate = await runCli(['applications', 'list', '--created-from', 'tomorrow-ish'])
    const invalidRoleKind = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'intern',
      '--country',
      'US',
      '--work-mode',
      'remote',
      '--status',
      'queued',
      '--primary-url',
      'https://jobs.example.com/delta',
    ])
    const invalidWorkMode = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'internship',
      '--country',
      'US',
      '--work-mode',
      'distributed',
      '--status',
      'queued',
      '--primary-url',
      'https://jobs.example.com/delta',
    ])
    const missingLink = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'internship',
      '--country',
      'US',
      '--work-mode',
      'remote',
      '--status',
      'queued',
    ])
    const malformedUrl = await runCli([
      'applications',
      'create',
      '--company-name',
      'Delta Labs',
      '--role-title',
      'Software Engineering Intern',
      '--source-name',
      'LinkedIn',
      '--role-kind',
      'internship',
      '--country',
      'US',
      '--work-mode',
      'remote',
      '--status',
      'queued',
      '--primary-url',
      'ftp://jobs.example.com/delta',
    ])
    const invalidManualKind = await runCli([
      'applications',
      'workflow',
      'application-1',
      '--manual-review-kind',
      'manual',
    ])
    const invalidWorkflowTimestamp = await runCli([
      'applications',
      'workflow',
      'application-1',
      '--lock-started-at',
      'tomorrow-ish',
    ])
    const emptyUpdate = await runCli(['applications', 'update', 'application-1'])
    const blankNote = await runCli([
      'applications',
      'note',
      'application-1',
      '--message',
      '   ',
    ])
    const invalidAttemptCompletion = await runCli([
      'applications',
      'attempts',
      'complete',
      'application-1',
      'attempt-1',
      '--outcome',
      'needs_user_info',
    ])

    expect(invalidSort.exitCode).toBe(1)
    expect(invalidSort.stderr).toContain('Invalid application list sort: random_sort')
    expect(removedName.exitCode).toBe(1)
    expect(removedName.stderr).toContain('Use --search for broad text search or --role for role titles')
    expect(invalidDate.exitCode).toBe(1)
    expect(invalidDate.stderr).toContain('Invalid date for --created-from: tomorrow-ish')
    expect(invalidRoleKind.exitCode).toBe(1)
    expect(invalidRoleKind.stderr).toContain('Invalid roleKind: intern')
    expect(invalidWorkMode.exitCode).toBe(1)
    expect(invalidWorkMode.stderr).toContain('Invalid workMode: distributed')
    expect(missingLink.exitCode).toBe(1)
    expect(missingLink.stderr).toContain('Application creation requires a primaryLink or sourceLink')
    expect(malformedUrl.exitCode).toBe(1)
    expect(malformedUrl.stderr).toContain('Invalid application URL: ftp://jobs.example.com/delta')
    expect(invalidManualKind.exitCode).toBe(1)
    expect(invalidManualKind.stderr).toContain('Invalid manualReviewKind: manual')
    expect(invalidWorkflowTimestamp.exitCode).toBe(1)
    expect(invalidWorkflowTimestamp.stderr).toContain('Invalid lockStartedAt: tomorrow-ish')
    expect(emptyUpdate.exitCode).toBe(1)
    expect(emptyUpdate.stderr).toContain('Application metadata update requires at least one field')
    expect(blankNote.exitCode).toBe(1)
    expect(blankNote.stderr).toContain('note message is required')
    expect(invalidAttemptCompletion.exitCode).toBe(1)
    expect(invalidAttemptCompletion.stderr).toContain(
      'missingUserInfo is required for needs_user_info attempts',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
