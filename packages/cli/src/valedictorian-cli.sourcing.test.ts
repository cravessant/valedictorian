import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'finding-1', mergeStatus: 'not_fit' }))
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
        '--source-url',
        'https://ats.example.com/apply?source=linkedin&route=agent&utm_source=agent',
        '--start-date',
        '2027-05-15',
        '--end-date',
        '2027-09-01',
        '--priority-score',
        '7',
        '--priority-band',
        'high',
        '--merge-status',
        'blocked',
        '--disposition-reason',
        'Needs user confirmation.',
        '--policy-blocker',
        'needs_user_decision',
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
        '--terms-json',
        '[{"season":"fall","year":2027}]',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      runCli([
        'sourcing',
        'findings',
        'decide',
        'finding-1',
        '--merge-status',
        'blocked',
        '--disposition-reason',
        'Needs user decision on sponsorship.',
        '--policy-blocker',
        'needs_user_decision',
        '--merge-notes',
        'Imported markdown row was below fit threshold.',
        '--workspace',
        'workspace-1',
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
          startDate: '2027-05-15',
          endDate: '2027-09-01',
          country: 'US',
          workMode: 'remote',
          officialUrl: 'https://jobs.example.com/delta',
          sourceUrl: 'https://ats.example.com/apply?source=linkedin&route=agent&utm_source=agent',
          priorityScore: 7,
          priorityBand: 'high',
          policyBlocker: 'needs_user_decision',
          dispositionReason: 'Needs user confirmation.',
          mergeStatus: 'blocked',
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
          terms: [{ season: 'fall', year: 2027 }],
          mergeNotes: 'Below cutoff.',
        }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings/finding-1/decide',
      expect.objectContaining({
        body: JSON.stringify({
          mergeStatus: 'blocked',
          mergeNotes: 'Imported markdown row was below fit threshold.',
          policyBlocker: 'needs_user_decision',
          dispositionReason: 'Needs user decision on sponsorship.',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings/finding-1/promote',
      expect.objectContaining({
        body: JSON.stringify({}),
        method: 'POST',
      }),
    )
  })

  it('rejects manual merged status in sourcing finding create and update flags', async () => {
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
        'Manual Merge Labs',
        '--role-title',
        'Software Engineering Intern',
        '--role-kind',
        'internship',
        '--work-mode',
        'remote',
        '--merge-status',
        'merged',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Sourcing findings can only be marked merged by promotion.'),
    })

    await expect(
      runCli([
        'sourcing',
        'findings',
        'update',
        'finding-1',
        '--merge-status',
        'merged',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Sourcing findings can only be marked merged by promotion.'),
    })
  })

  it('rejects classifier-owned finding fields that would be overwritten', async () => {
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
        'Duplicate Labs',
        '--role-title',
        'Software Engineering Intern',
        '--role-kind',
        'internship',
        '--work-mode',
        'remote',
        '--official-url',
        'https://jobs.example.com/duplicate-labs',
        '--duplicate-notes',
        'Looks duplicated.',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('--duplicate-notes is generated by duplicate detection'),
    })

    await expect(
      runCli([
        'sourcing',
        'findings',
        'update',
        'finding-1',
        '--blocker',
        'Needs user decision.',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('--blocker requires --merge-status blocked.'),
    })

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
        'Mixed Timing Labs',
        '--role-title',
        'Software Engineering Intern',
        '--role-kind',
        'internship',
        '--work-mode',
        'remote',
        '--term',
        'Fall 2027',
        '--start-date',
        '2027-09-01',
        '--workspace',
        'workspace-1',
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Date-based timing cannot include term or terms input'),
    })
  })

  it('bulk imports sourcing findings from a JSON file and reports row failures', async () => {
    const inputPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-import-')),
      'findings.json',
    )
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        defaults: {
          workflowRunId: 'run-1',
          sourceName: 'LinkedIn',
          roleKind: 'internship',
          workMode: 'remote',
          country: 'US',
        },
        findings: [
          {
            companyName: 'Delta Labs',
            roleTitle: 'Software Engineering Intern',
            terms: [{ season: 'summer', year: 2027 }],
            officialUrl: 'https://jobs.example.com/delta?utm_source=linkedin&b=2&a=1',
            priorityScore: 7,
            priorityBand: 'high',
          },
          {
            companyName: 'Route Labs',
            roleTitle: 'Platform Intern',
            sourceUrl:
              'https://ats.example.com/apply?source=linkedin&route=agent&utm_source=agent',
            fitNotes: 'Promising source-only posting.',
          },
          {
            companyName: 'Broken Labs',
            roleTitle: 'Closed Intern',
            sourceUrl: 'https://ats.example.com/broken?route=agent',
          },
        ],
      }),
    )
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'finding-delta', mergeStatus: 'new' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'finding-route', mergeStatus: 'new' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Role is closed' }, { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'sourcing',
      'findings',
      'import',
      '--workspace',
      'workspace-1',
      '--input-json',
      inputPath,
      '--json',
    ])
    const output = JSON.parse(result.stdout) as {
      failureCount: number
      failures: Array<{ companyName: string; index: number; message: string }>
      importedCount: number
    }

    expect(result.exitCode).toBe(1)
    expect(output).toMatchObject({
      failureCount: 1,
      failures: [{ companyName: 'Broken Labs', index: 2, message: 'Role is closed' }],
      importedCount: 2,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/sourcing/findings',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      workflowRunId: 'run-1',
      sourceName: 'LinkedIn',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      terms: [{ season: 'summer', year: 2027 }],
      priorityBand: 'high',
      officialUrl: 'https://jobs.example.com/delta?a=1&b=2',
      priorityScore: 7,
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      workflowRunId: 'run-1',
      sourceName: 'LinkedIn',
      companyName: 'Route Labs',
      roleTitle: 'Platform Intern',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      sourceUrl: 'https://ats.example.com/apply?source=linkedin&route=agent&utm_source=agent',
      fitNotes: 'Promising source-only posting.',
    })
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
