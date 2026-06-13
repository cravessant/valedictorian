import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

describe('Valedictorian CLI sourcing and workflow commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs workflow run and sourcing finding commands over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'run-1', runType: 'sourcing' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'step-1', sequence: 2 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'run-1', status: 'completed' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 'run-1' }], total: 1, limit: 25, offset: 0, hasMore: false }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [{ id: 'finding-1' }],
        total: 1,
        limit: 25,
        offset: 0,
        hasMore: false,
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'finding-1', mergeStatus: 'new' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'finding-1', mergeStatus: 'below_cutoff' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        finding: { id: 'finding-1', mergeStatus: 'merged', mergedApplicationId: 'application-1' },
        application: { id: 'application-1' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'runs',
        'start',
        '--run-type',
        'sourcing',
        '--actor-type',
        'agent',
        '--actor-name',
        'codex',
        '--source-name',
        'LinkedIn',
        '--summary',
        'Started.',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'runs',
        'step',
        'run-1',
        '--type',
        'note',
        '--message',
        'Reached frontier.',
        '--actor',
        'agent:codex',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'runs',
        'complete',
        'run-1',
        '--workspace',
        'workspace-1',
        '--outcome',
        'full_coverage',
        '--summary',
        'Completed.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'runs',
        'list',
        '--run-type',
        'sourcing',
        '--source-id',
        'source-linkedin',
        '--limit',
        '25',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'sourcing',
        'findings',
        'list',
        '--workflow-run-id',
        'run-1',
        '--source-id',
        'source-linkedin',
        '--merge-status',
        'new',
        '--limit',
        '25',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'sourcing',
        'findings',
        'create',
        '--workflow-run-id',
        'run-1',
        '--source-name',
        'LinkedIn',
        '--company-name',
        'Delta Labs',
        '--role-title',
        'Software Engineering Intern',
        '--role-kind',
        'internship',
        '--country',
        'US',
        '--work-mode',
        'remote',
        '--official-url',
        'https://jobs.example.com/delta',
        '--priority-score',
        '7',
        '--priority-band',
        'high',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'sourcing',
        'findings',
        'update',
        'finding-1',
        '--merge-status',
        'below_cutoff',
        '--workspace',
        'workspace-1',
        '--merge-notes',
        'Below cutoff.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'sourcing',
        'findings',
        'promote',
        'finding-1',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs',
      expect.objectContaining({
        body: JSON.stringify({
          runType: 'sourcing',
          actorType: 'agent',
          actorName: 'codex',
          sourceName: 'LinkedIn',
          summary: 'Started.',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs/run-1/steps',
      expect.objectContaining({
        body: JSON.stringify({
          type: 'note',
          message: 'Reached frontier.',
          actor: 'agent:codex',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs/run-1/complete',
      expect.objectContaining({
        body: JSON.stringify({
          outcome: 'full_coverage',
          summary: 'Completed.',
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs?runType=sourcing&sourceId=source-linkedin&limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings?workflowRunId=run-1&sourceId=source-linkedin&mergeStatus=new&limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings',
      expect.objectContaining({
        body: JSON.stringify({
          workflowRunId: 'run-1',
          sourceName: 'LinkedIn',
          companyName: 'Delta Labs',
          roleTitle: 'Software Engineering Intern',
          roleKind: 'internship',
          country: 'US',
          workMode: 'remote',
          officialUrl: 'https://jobs.example.com/delta',
          priorityScore: 7,
          priorityBand: 'high',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings/finding-1',
      expect.objectContaining({
        body: JSON.stringify({
          mergeStatus: 'below_cutoff',
          mergeNotes: 'Below cutoff.',
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings/finding-1/promote',
      expect.objectContaining({
        body: JSON.stringify({}),
        method: 'POST',
      }),
    )
  })

  it('runs a sourcing batch and processes candidates over HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'run-1', runType: 'sourcing' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'finding-1',
        mergeStatus: 'merged',
        mergedApplicationId: 'application-1',
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'run-1', status: 'completed' }))
    vi.stubGlobal('fetch', fetchMock)

    const candidates = [
      {
        companyName: 'Delta Labs',
        roleTitle: 'Software Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        officialUrl: 'https://jobs.example.com/delta',
        score: {
          score: 8,
          band: 'high',
          roleRelevance: 3,
          careerSignal: 2,
          cityWorkMode: 2,
          compensationLogistics: 1,
          penalties: [],
          rationale: 'Strong fit.',
          rubricVersion: 'cli-test',
        },
        cutoffScore: 7,
      },
    ]

    await expect(
      runCli([
        'sourcing',
        'run',
        '--source-id',
        'source-linkedin',
        '--auto-promote',
        '--workspace',
        'workspace-1',
        '--candidates-json',
        JSON.stringify(candidates),
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs',
      expect.objectContaining({
        body: expect.stringContaining('"sourceId":"source-linkedin"') as string,
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/candidates/process',
      expect.objectContaining({
        body: expect.stringContaining('"workflowRunId":"run-1"') as string,
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs/run-1/complete',
      expect.objectContaining({
        body: JSON.stringify({
          outcome: 'processed_1_candidates',
          summary: 'Processed 1 sourcing candidates.',
        }),
        method: 'PATCH',
      }),
    )
  })

  it('records sourcing candidate failures and completes the run', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'run-1', runType: 'sourcing' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Candidate failed' }, { status: 500 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'step-1', type: 'sourcing_candidate_failed' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'run-1', status: 'failed' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'sourcing',
        'run',
        '--source-id',
        'source-linkedin',
        '--auto-promote',
        '--workspace',
        'workspace-1',
        '--candidates-json',
        JSON.stringify([
          {
            companyName: 'Delta Labs',
            roleTitle: 'Software Engineering Intern',
            roleKind: 'internship',
            country: 'US',
            workMode: 'remote',
            officialUrl: 'https://jobs.example.com/delta',
          },
        ]),
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs/run-1/steps',
      expect.objectContaining({
        body: expect.stringContaining('"type":"sourcing_candidate_failed"') as string,
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://valedictorian.test/v1/workspaces/workspace-1/runs/run-1/complete',
      expect.objectContaining({
        body: expect.stringContaining('"status":"failed"') as string,
        method: 'PATCH',
      }),
    )
  })

  it('converts workflow now timestamps before HTTP', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'applications',
      'workflow',
      'application-1',
      '--lock-started-at',
      'now',
      '--workspace',
      'workspace-1',
    ])

    expect(result.exitCode).toBe(0)
    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0][1]?.body ?? '{}') as string,
    ) as { lockStartedAt?: string }
    expect(requestBody.lockStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

})
