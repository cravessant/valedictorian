import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

describe('valedictorian-cli npm package', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
        '--workspace',
        'workspace-1',
        '--json',
      ],
      { VALEDICTORIAN_API_TOKEN: 'token-1' },
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?status=needs_user_info&minScore=6&role=backend&sort=company_asc&limit=25&offset=5',
      {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer token-1',
        },
        method: 'GET',
      },
    )
  })

  it('requires and applies an explicit workspace for application list commands', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const missingWorkspace = await runCli(['applications', 'list', '--limit', '25'])
    const scoped = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--limit',
      '25',
    ])

    expect(missingWorkspace.exitCode).toBe(1)
    expect(missingWorkspace.stderr).toContain('--workspace is required')
    expect(scoped.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('inspects connector status through workspace-scoped HTTP', async () => {
    const payload = {
      id: 'connector-instance-jobright',
      displayName: 'Jobright',
      status: 'auth_required',
      actionRequired: [{ kind: 'auth' }],
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const missingWorkspace = await runCli(['connectors', 'inspect', 'connector-instance-jobright'])
    const result = await runCli([
      'connectors',
      'inspect',
      'connector-instance-jobright',
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect(missingWorkspace.exitCode).toBe(1)
    expect(missingWorkspace.stderr).toContain('--workspace is required')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/connectors/connector-instance-jobright/status',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('triggers connector runs through workspace-scoped HTTP without source-specific CLI logic', async () => {
    const payload = {
      id: 'run-queued',
      connectorInstanceId: 'connector-instance-jobright',
      mode: 'manual',
      status: 'queued',
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      'connectors',
      'trigger',
      'connector-instance-jobright',
      '--workspace',
      'workspace-1',
      '--mode',
      'manual',
      '--coverage-started-at',
      '2026-07-01T00:00:00.000Z',
      '--coverage-ended-at',
      '2026-07-08T00:00:00.000Z',
      '--filter-signature',
      'internships',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/connectors/connector-instance-jobright/runs',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      coverageStartedAt: '2026-07-01T00:00:00.000Z',
      coverageEndedAt: '2026-07-08T00:00:00.000Z',
      filterSignature: 'internships',
      mode: 'manual',
    })
  })

  it('accepts global --workspace before the command for workspace-scoped commands', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([
      '--workspace',
      'workspace-1',
      'applications',
      'list',
      '--limit',
      '25',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=25',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('manages profile details and secret summaries over workspace-scoped HTTP', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-cli-profile-'))
    const profilePath = path.join(tempDirectory, 'profile.json')
    const sensitivePath = path.join(tempDirectory, 'sensitive.json')
    const secretValuePath = path.join(tempDirectory, 'secret-value.txt')
    const profileInput = {
      fullName: 'Sparxie Example',
      email: 'alex@example.com',
      answers: [
        {
          key: 'work_auth',
          label: 'Work authorization',
          questionPattern: 'Are you authorized to work?',
          answer: 'Yes',
          includeInAgentContext: true,
        },
      ],
    }
    const sensitiveInput = {
      birthYear: '2000',
      ssnLast4: '1234',
    }
    const profilePayload = {
      ...profileInput,
      education: [],
    }
    const agentContextPayload = {
      answers: profileInput.answers,
      basics: {
        email: 'alex@example.com',
        fullName: 'Sparxie Example',
      },
      education: [],
    }
    const secretSummary = {
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      updatedAt: '2026-07-03T12:00:00.000Z',
    }

    fs.writeFileSync(profilePath, JSON.stringify(profileInput))
    fs.writeFileSync(sensitivePath, JSON.stringify(sensitiveInput))
    fs.writeFileSync(secretValuePath, 'super-secret-password')

    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(profilePayload))
    fetchMock.mockResolvedValueOnce(jsonResponse(agentContextPayload))
    fetchMock.mockResolvedValueOnce(jsonResponse(profilePayload))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        birthDay: null,
        birthMonth: null,
        birthYear: '2000',
        disabilityStatus: null,
        gender: null,
        hispanicLatino: null,
        raceEthnicity: null,
        ssnLast4: '1234',
        veteranStatus: null,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        birthDay: null,
        birthMonth: null,
        birthYear: '2000',
        disabilityStatus: null,
        gender: null,
        hispanicLatino: null,
        raceEthnicity: null,
        ssnLast4: '1234',
        veteranStatus: null,
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(secretSummary))
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [secretSummary] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const profileGet = await runCli(['profile', 'get', '--workspace', 'workspace-1', '--json'])
    const agentContext = await runCli([
      'profile',
      'agent-context',
      '--workspace',
      'workspace-1',
      '--json',
    ])
    const profileUpdate = await runCli([
      'profile',
      'update',
      '--workspace',
      'workspace-1',
      '--input-json',
      profilePath,
      '--json',
    ])
    const sensitiveUpdate = await runCli([
      'profile',
      'sensitive',
      'update',
      '--workspace',
      'workspace-1',
      '--input-json',
      sensitivePath,
      '--json',
    ])
    const sensitiveSummary = await runCli([
      'profile',
      'sensitive',
      'summary',
      '--workspace',
      'workspace-1',
      '--json',
    ])
    const secretUpsert = await runCli([
      'profile',
      'secrets',
      'upsert',
      'greenhouse_password',
      '--workspace',
      'workspace-1',
      '--kind',
      'password',
      '--label',
      'Greenhouse password',
      '--value-file',
      secretValuePath,
      '--json',
    ])
    const secretList = await runCli([
      'profile',
      'secrets',
      'list',
      '--workspace',
      'workspace-1',
      '--json',
    ])
    const secretDelete = await runCli([
      'profile',
      'secrets',
      'delete',
      'greenhouse_password',
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect(profileGet.exitCode).toBe(0)
    expect(agentContext.exitCode).toBe(0)
    expect(profileUpdate.exitCode).toBe(0)
    expect(sensitiveUpdate.exitCode).toBe(0)
    expect(sensitiveSummary.exitCode).toBe(0)
    expect(secretUpsert.exitCode).toBe(0)
    expect(secretList.exitCode).toBe(0)
    expect(secretDelete.exitCode).toBe(0)
    expect(JSON.parse(profileGet.stdout)).toEqual(profilePayload)
    expect(JSON.parse(agentContext.stdout)).toEqual(agentContextPayload)
    expect(JSON.parse(profileUpdate.stdout)).toEqual(profilePayload)
    expect(JSON.parse(sensitiveUpdate.stdout)).toEqual({
      populatedFieldCount: 2,
      populatedFields: ['birthYear', 'ssnLast4'],
    })
    expect(JSON.parse(sensitiveSummary.stdout)).toEqual({
      populatedFieldCount: 2,
      populatedFields: ['birthYear', 'ssnLast4'],
    })
    expect(JSON.parse(secretUpsert.stdout)).toEqual(secretSummary)
    expect(JSON.parse(secretList.stdout)).toEqual({ items: [secretSummary] })
    expect(JSON.parse(secretDelete.stdout)).toEqual({ ok: true })
    expect(`${sensitiveUpdate.stdout}${sensitiveSummary.stdout}`).not.toContain('1234')
    expect(`${secretUpsert.stdout}${secretList.stdout}${secretDelete.stdout}`).not.toContain(
      'super-secret-password',
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/profile',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/agent-context',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/profile',
      expect.objectContaining({
        body: JSON.stringify(profileInput),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/sensitive',
      expect.objectContaining({
        body: JSON.stringify(sensitiveInput),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://valedictorian.test/v1/workspaces/workspace-1/profile/sensitive',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://valedictorian.test/v1/workspaces/workspace-1/secrets/greenhouse_password',
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'password',
          label: 'Greenhouse password',
          value: 'super-secret-password',
        }),
        method: 'PUT',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      'https://valedictorian.test/v1/workspaces/workspace-1/secrets',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      'https://valedictorian.test/v1/workspaces/workspace-1/secrets/greenhouse_password',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('resolves workspace names and fails when a workspace name is ambiguous', async () => {
    const workspaces = {
      items: [
        { id: 'workspace-alpha', name: 'Example Workspace', open: true, source: 'local' },
        { id: 'workspace-beta', name: 'Winter Search', open: false, source: 'local' },
      ],
    }
    const duplicateWorkspaces = {
      items: [
        { id: 'workspace-one', name: 'Example Workspace', open: true, source: 'local' },
        { id: 'workspace-two', name: 'Example Workspace', open: false, source: 'local' },
      ],
    }
    const applications = { items: [], total: 0, limit: 10, offset: 0, hasMore: false }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(workspaces))
    fetchMock.mockResolvedValueOnce(jsonResponse(applications))
    fetchMock.mockResolvedValueOnce(jsonResponse(duplicateWorkspaces))
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await runCli([
      'applications',
      'list',
      '--workspace',
      'example workspace',
      '--limit',
      '10',
      '--json',
    ])
    const ambiguous = await runCli([
      'applications',
      'list',
      '--workspace',
      'Example Workspace',
      '--limit',
      '10',
    ])

    expect(resolved.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-alpha/applications?limit=10',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(ambiguous.exitCode).toBe(1)
    expect(ambiguous.stderr).toContain('Workspace name is ambiguous: Example Workspace')
    expect(ambiguous.stderr).toContain('workspace-one')
    expect(ambiguous.stderr).toContain('workspace-two')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('formats resource commands as human text by default and supports leading --json', async () => {
    const payload = {
      items: [
        {
          id: 'application-1',
          companyName: 'Delta Labs',
          roleTitle: 'Software Engineering Intern',
          status: 'queued',
          priorityScore: 7,
          priorityBand: 'high',
        },
      ],
      total: 1,
      limit: 1,
      offset: 0,
      hasMore: false,
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValueOnce(jsonResponse(payload))
    fetchMock.mockResolvedValueOnce(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const textResult = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--limit',
      '1',
    ])

    expect(textResult.exitCode).toBe(0)
    expect(textResult.stdout).toContain('1 item - limit 1 - offset 0 - end reached')
    expect(textResult.stdout).toContain(
      'Delta Labs - Software Engineering Intern - status=queued - priority=7/high - id=application-1',
    )
    expect(() => JSON.parse(textResult.stdout)).toThrow()

    const jsonResult = await runCli([
      '--json',
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--limit',
      '1',
    ])

    expect(jsonResult.exitCode).toBe(0)
    expect(JSON.parse(jsonResult.stdout)).toEqual(payload)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications?limit=1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('lists action queue rows over HTTP with action bucket filtering, pagination, and token auth', async () => {
    const payload = {
      items: [],
      total: 0,
      limit: 25,
      offset: 5,
      hasMore: false,
      actionBucketCounts: { apply_now: 0 },
    }
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli(
      [
        'action-queue',
        'list',
        '--workspace',
        'workspace-1',
        '--action-bucket',
        'apply_now',
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
      'https://valedictorian.test/v1/workspaces/workspace-1/action-queue?actionBucket=apply_now&limit=25&offset=5',
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
    const scoreRecord = {
      applicationId: 'application-1',
      score: 8,
      band: 'high',
      roleRelevance: 3,
      careerSignal: 2,
      cityWorkMode: 2,
      compensationLogistics: 1,
      penalties: [],
      rationale: 'Strong fit.',
      rubricVersion: 'valedictorian-cli',
      id: 'score-1',
      createdAt: '2026-06-30T00:00:00.000Z',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'application-1', status: 'submitted' }))
    fetchMock.mockResolvedValueOnce(jsonResponse(scoreRecord))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runCli([
        'applications',
        'get',
        'application-1',
        '--workspace',
        'workspace-1',
        '--json',
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
    })
    await expect(
      runCli([
        'applications',
        'status',
        'application-1',
        'submitted',
        '--workspace',
        'workspace-1',
        '--notes',
        'Submitted from CLI.',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })
    const scoreResult = await runCli([
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
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect(scoreResult.exitCode).toBe(0)
    expect(JSON.parse(scoreResult.stdout)).toEqual(scoreRecord)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://valedictorian.test/v1/workspaces/workspace-1/applications/application-1/status',
      expect.objectContaining({
        body: JSON.stringify({ status: 'submitted', notes: 'Submitted from CLI.' }),
        method: 'PATCH',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://valedictorian.test/v1/workspaces/workspace-1/scores',
      expect.objectContaining({
        body: expect.stringContaining('"applicationId":"application-1"') as string,
        method: 'POST',
      }),
    )
  })
})
