import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JobAppClient } from 'sparxie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-server-')), 'valedictorian.sqlite')
}

function createLocalValedictorianClient(options: Parameters<typeof createRuntimeLocalValedictorianClient>[0]) {
  return createRuntimeLocalValedictorianClient({
    seedDataMode: 'sample',
    ...options,
  })
}

async function readJson(response: Response) {
  return (await response.json()) as unknown
}

function createBoundaryTestClient(onCreate: () => void): JobAppClient {
  return {
    applications: {
      async archive() {},
      async create() {
        onCreate()
        throw new Error('client create should not be called')
      },
      events: {
        async list() {
          throw new Error('not implemented')
        },
      },
      attempts: {
        async complete() {
          throw new Error('not implemented')
        },
        async list() {
          throw new Error('not implemented')
        },
        async start() {
          throw new Error('not implemented')
        },
        async step() {
          throw new Error('not implemented')
        },
      },
      async get() {
        return null
      },
      links: {
        async create() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
      async list() {
        throw new Error('not implemented')
      },
      notes: {
        async append() {
          throw new Error('not implemented')
        },
      },
      async update() {
        throw new Error('not implemented')
      },
      async updateStatus() {
        throw new Error('not implemented')
      },
      workflow: {
        async update() {
          throw new Error('not implemented')
        },
      },
    },
    queue: {
      async list() {
        throw new Error('not implemented')
      },
    },
    policy: {
      config: {
        async get() {
          throw new Error('not implemented')
        },
        async reset() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
      evidence: {
        async list() {
          throw new Error('not implemented')
        },
        async record() {
          throw new Error('not implemented')
        },
      },
      evaluate: {
        async application() {
          throw new Error('not implemented')
        },
        async runWindow() {
          throw new Error('not implemented')
        },
        async sourcingCandidate() {
          throw new Error('not implemented')
        },
      },
    },
    runs: {
      async complete() {
        throw new Error('not implemented')
      },
      async list() {
        throw new Error('not implemented')
      },
      async start() {
        throw new Error('not implemented')
      },
      async step() {
        throw new Error('not implemented')
      },
    },
    scores: {
      async record() {},
    },
    sourcing: {
      candidates: {
        async process() {
          throw new Error('not implemented')
        },
      },
      findings: {
        async create() {
          throw new Error('not implemented')
        },
        async decide() {
          throw new Error('not implemented')
        },
        async list() {
          throw new Error('not implemented')
        },
        async promote() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
    },
  } as unknown as JobAppClient
}

describe('local Valedictorian HTTP server', () => {
  let server: StartedValedictorianHttpServer | null = null
  const originalReferenceTrackerPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(async () => {
    await server?.close()
    server = null
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('serves health and local capabilities', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    await expect(fetch(`${server.url}/v1/health`).then(readJson)).resolves.toEqual({ ok: true })
    await expect(fetch(`${server.url}/v1/capabilities`).then(readJson)).resolves.toMatchObject({
      localSqlite: true,
      hostedSync: false,
    })
  })

  it('lists and gets applications with auth, filters, and pagination', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const listResponse = await fetch(
      `${server.url}/v1/applications?status=needs_user_info&minScore=6&source=linkedin&limit=25&offset=0`,
      { headers: { authorization: 'Bearer server-token' } },
    )
    const listPayload = (await readJson(listResponse)) as {
      items: Array<{ companyName: string; id: string; status: string }>
      total: number
    }

    expect(listResponse.status).toBe(200)
    expect(listPayload.total).toBe(1)
    expect(listPayload.items[0]).toMatchObject({
      companyName: 'Astranis Space Technologies',
      status: 'needs_user_info',
    })

    const getResponse = await fetch(`${server.url}/v1/applications/${listPayload.items[0].id}`, {
      headers: { authorization: 'Bearer server-token' },
    })

    await expect(readJson(getResponse)).resolves.toMatchObject({
      id: listPayload.items[0].id,
      companyName: 'Astranis Space Technologies',
    })
  })

  it('lists queue rows with auth, bucket filtering, and pagination', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const queueResponse = await fetch(
      `${server.url}/v1/queue?bucket=apply_now&limit=25&offset=0`,
      { headers: { authorization: 'Bearer server-token' } },
    )
    const queuePayload = (await readJson(queueResponse)) as {
      items: Array<{ bucket: string; companyName: string; id: string }>
      total: number
    }

    expect(queueResponse.status).toBe(200)
    expect(queuePayload.total).toBe(1)
    expect(queuePayload.items[0]).toMatchObject({
      id: 'application-versant-platform',
      companyName: 'Versant Media',
      bucket: 'apply_now',
    })
  })

  it('serves profile update, read, and non-secret agent context routes', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const updateResponse = await fetch(`${server.url}/v1/profile`, {
      body: JSON.stringify({
        answers: [
          {
            answer: 'LinkedIn',
            includeInAgentContext: true,
            key: 'how heard',
            label: 'How I heard about the role',
            questionPattern: 'How did you hear about us?',
          },
          {
            answer: 'Private.',
            includeInAgentContext: false,
            key: 'private',
            label: 'Private',
            questionPattern: 'Sensitive question',
          },
        ],
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
      }),
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      method: 'PATCH',
    })

    expect(updateResponse.status).toBe(200)
    await expect(readJson(updateResponse)).resolves.toMatchObject({
      answers: [
        expect.objectContaining({ key: 'how_heard' }),
        expect.objectContaining({ key: 'private' }),
      ],
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })

    await expect(
      fetch(`${server.url}/v1/profile`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })
    await expect(
      fetch(`${server.url}/v1/profile/agent-context`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toEqual({
      answers: [
        {
          answer: 'LinkedIn',
          category: null,
          includeInAgentContext: true,
          key: 'how_heard',
          label: 'How I heard about the role',
          questionPattern: 'How did you hear about us?',
        },
      ],
      basics: {
        email: 'kenny@example.com',
        fullName: 'Kenny Lin',
      },
      education: [],
    })
  })

  it('serves workflow runs and sourcing findings routes', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const runResponse = await fetch(`${server.url}/v1/runs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        runType: 'sourcing',
        actorType: 'agent',
        actorName: 'codex',
        sourceName: 'LinkedIn',
        summary: 'Started sourcing.',
      }),
    })
    const run = (await readJson(runResponse)) as { id: string }

    expect(runResponse.status).toBe(200)
    expect(run).toMatchObject({ id: expect.any(String) })

    const findingResponse = await fetch(`${server.url}/v1/sourcing/findings`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workflowRunId: run.id,
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
    })
    const finding = (await readJson(findingResponse)) as { id: string; sourceId: string }

    expect(findingResponse.status).toBe(200)

    await expect(
      fetch(`${server.url}/v1/runs?runType=sourcing&status=in_progress&sourceId=${finding.sourceId}`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({ total: 1, items: [{ id: run.id }] })
    await expect(
      fetch(`${server.url}/v1/sourcing/findings?workflowRunId=${run.id}&sourceId=${finding.sourceId}&mergeStatus=new`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({ total: 1, items: [{ id: finding.id }] })

    const blockedFindingResponse = await fetch(`${server.url}/v1/sourcing/findings`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workflowRunId: run.id,
        sourceName: 'LinkedIn',
        companyName: 'Human Labs',
        roleTitle: 'Frontend Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
      }),
    })
    const blockedFinding = (await readJson(blockedFindingResponse)) as { id: string }

    await expect(
      fetch(`${server.url}/v1/sourcing/findings/${blockedFinding.id}`, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceUrl: 'https://linkedin.com/jobs/view/human-labs',
          priorityScore: 4,
          priorityBand: 'skip',
          fitNotes: 'Below the current sourcing cutoff.',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      fitNotes: 'Below the current sourcing cutoff.',
      mergeStatus: 'below_cutoff',
      priorityScore: 4,
      sourceUrl: 'https://linkedin.com/jobs/view/human-labs',
    })

    await expect(
      fetch(`${server.url}/v1/sourcing/findings/${blockedFinding.id}/decide`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          mergeStatus: 'not_fit',
          mergeNotes: 'Requires a non-student schedule.',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      id: blockedFinding.id,
      mergeNotes: 'Requires a non-student schedule.',
      mergeStatus: 'not_fit',
    })

    await expect(
      fetch(`${server.url}/v1/sourcing/findings/${finding.id}/promote`, {
        method: 'POST',
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({
      id: finding.id,
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })

    const candidateResponse = await fetch(`${server.url}/v1/sourcing/candidates/process`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workflowRunId: run.id,
        sourceId: finding.sourceId,
        companyName: 'Echo Health',
        roleTitle: 'Data Engineering Intern',
        roleKind: 'internship',
        country: 'US',
        workMode: 'remote',
        officialUrl: 'https://jobs.example.com/echo',
        score: {
          score: 8,
          band: 'high',
          roleRelevance: 3,
          careerSignal: 2,
          cityWorkMode: 2,
          compensationLogistics: 1,
          penalties: [],
          rationale: 'Strong fit.',
          rubricVersion: 'server-test',
        },
        cutoffScore: 7,
      }),
    })

    expect(candidateResponse.status).toBe(200)
    await expect(readJson(candidateResponse)).resolves.toMatchObject({
      companyName: 'Echo Health',
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
  })

  it('returns a bad request for invalid queue buckets', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const response = await fetch(`${server.url}/v1/queue?bucket=random`, {
      headers: { authorization: 'Bearer server-token' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      message: 'Invalid queue bucket: random',
    })
  })

  it('serves policy config, evidence, and scheduler-ready evaluation endpoints', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    await expect(
      fetch(`${server.url}/v1/policy/config`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({
      scoring: {
        applyCutoff: 6,
      },
    })

    await expect(
      fetch(`${server.url}/v1/policy/config`, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scoring: {
            applyCutoff: 7,
          },
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      scoring: {
        applyCutoff: 7,
      },
    })

    const evidence = (await fetch(`${server.url}/v1/policy/evidence`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subjectType: 'application',
        subjectId: 'application-versant-platform',
        tag: 'explicit_user_approval',
        source: 'user',
        note: 'Approved.',
      }),
    }).then(readJson)) as { id: string }

    expect(evidence).toMatchObject({ id: expect.any(String) })
    await expect(
      fetch(
        `${server.url}/v1/policy/evidence?subjectType=application&subjectId=application-versant-platform`,
        {
          headers: { authorization: 'Bearer server-token' },
        },
      ).then(readJson),
    ).resolves.toEqual([expect.objectContaining({ id: evidence.id })])

    await expect(
      fetch(`${server.url}/v1/policy/evaluate/run-window`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceName: 'LinkedIn',
          now: '2026-06-08T18:00:00.000Z',
          previousRunCompletedAt: '2026-06-08T17:00:00.000Z',
          timezone: 'America/New_York',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      action: 'recommend_run_window',
      recommendedCoverageStartedAt: '2026-06-08T16:30:00.000Z',
      recommendedCoverageEndedAt: '2026-06-08T18:00:00.000Z',
      status: 'allow',
    })
  })

  it('rejects invalid create mutation input before calling the client', async () => {
    let createCalls = 0
    server = await createValedictorianHttpServer({
      client: createBoundaryTestClient(() => {
        createCalls += 1
      }),
      host: '127.0.0.1',
      port: 0,
    })

    const validBody = {
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
    }
    const cases = [
      {
        body: {
          ...validBody,
          roleKind: 'intern',
        },
        message: 'Invalid roleKind: intern',
      },
      {
        body: {
          ...validBody,
          companyName: '   ',
        },
        message: 'companyName is required',
      },
      {
        body: {
          ...validBody,
          primaryLink: undefined,
        },
        message: 'Application creation requires a primaryLink or sourceLink',
      },
      {
        body: {
          ...validBody,
          primaryLink: {
            kind: 'official',
            label: 'official',
            url: 'ftp://jobs.example.com/delta',
          },
        },
        message: 'Invalid application URL: ftp://jobs.example.com/delta',
      },
    ]

    for (const testCase of cases) {
      const response = await fetch(`${server.url}/v1/applications`, {
        body: JSON.stringify(testCase.body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      expect(response.status).toBe(400)
      await expect(readJson(response)).resolves.toEqual({
        message: testCase.message,
      })
    }

    expect(createCalls).toBe(0)
  })

  it('rejects invalid workflow mutation input before calling the client', async () => {
    let workflowCalls = 0
    const client = createBoundaryTestClient(() => {})
    client.applications.workflow.update = async () => {
      workflowCalls += 1
      throw new Error('client workflow should not be called')
    }
    server = await createValedictorianHttpServer({
      client,
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(`${server.url}/v1/applications/application-1/workflow`, {
      body: JSON.stringify({
        lockStartedAt: 'tomorrow-ish',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      message: 'Invalid lockStartedAt: tomorrow-ish',
    })
    expect(workflowCalls).toBe(0)
  })

  it('rejects invalid attempt completion input before calling the client', async () => {
    let completeCalls = 0
    const client = createBoundaryTestClient(() => {})
    client.applications.attempts.complete = async () => {
      completeCalls += 1
      throw new Error('client attempt completion should not be called')
    }
    server = await createValedictorianHttpServer({
      client,
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(
      `${server.url}/v1/applications/application-1/attempts/attempt-1/complete`,
      {
        body: JSON.stringify({
          outcome: 'needs_user_info',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      message: 'missingUserInfo is required for needs_user_info attempts',
    })
    expect(completeCalls).toBe(0)
  })

  it('updates application status and records scores through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const statusResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/status`,
      {
        body: JSON.stringify({ status: 'submitted', notes: 'Submitted from HTTP test.' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    await expect(readJson(statusResponse)).resolves.toMatchObject({
      id: 'application-versant-platform',
      notes: 'Submitted from HTTP test.',
      status: 'submitted',
    })

    const scoreResponse = await fetch(`${server.url}/v1/scores`, {
      body: JSON.stringify({
        applicationId: 'application-versant-platform',
        score: 8,
        band: 'high',
        roleRelevance: 3,
        careerSignal: 2,
        cityWorkMode: 2,
        compensationLogistics: 1,
        penalties: [],
        rationale: 'Strong fit.',
        rubricVersion: 'http-test',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readJson(scoreResponse)).resolves.toEqual({ ok: true })

    const applicationResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform`,
    )

    await expect(readJson(applicationResponse)).resolves.toMatchObject({
      currentPriorityBand: 'high',
      currentPriorityScore: 8,
    })
  })

  it('runs application mutation commands through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const createResponse = await fetch(`${server.url}/v1/applications`, {
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
          url: 'https://jobs.example.com/delta/software-engineering-intern',
        },
        initialNote: 'Created from HTTP mutation test.',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const created = (await readJson(createResponse)) as { id: string }

    expect(createResponse.status).toBe(200)
    expect(created).toMatchObject({
      roleTitle: 'Software Engineering Intern',
      primaryLink: {
        url: 'https://jobs.example.com/delta/software-engineering-intern',
      },
    })

    const updateResponse = await fetch(`${server.url}/v1/applications/${created.id}`, {
      body: JSON.stringify({
        locationRaw: 'United States / Remote',
        hasApplied: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    await expect(readJson(updateResponse)).resolves.toMatchObject({
      hasApplied: true,
      location: 'United States / Remote',
    })

    const workflowResponse = await fetch(`${server.url}/v1/applications/${created.id}/workflow`, {
      body: JSON.stringify({
        missingUserInfo: 'Graduation date confirmation',
        blockerReason: null,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    expect(workflowResponse.status).toBe(200)

    const noteResponse = await fetch(`${server.url}/v1/applications/${created.id}/notes`, {
      body: JSON.stringify({ message: 'Reached review page.' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    await expect(readJson(noteResponse)).resolves.toMatchObject({
      notes: 'Reached review page.',
    })

    const linkResponse = await fetch(`${server.url}/v1/applications/${created.id}/links`, {
      body: JSON.stringify({
        kind: 'source',
        label: 'LinkedIn',
        url: 'https://www.linkedin.com/jobs/view/delta',
        isPrimary: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const link = (await readJson(linkResponse)) as { id: string }

    expect(linkResponse.status).toBe(200)

    const linkUpdateResponse = await fetch(
      `${server.url}/v1/applications/${created.id}/links/${link.id}`,
      {
        body: JSON.stringify({ label: 'LinkedIn Easy Apply' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )
    await expect(readJson(linkUpdateResponse)).resolves.toMatchObject({
      label: 'LinkedIn Easy Apply',
    })

    const linksResponse = await fetch(`${server.url}/v1/applications/${created.id}/links?limit=10`)
    const links = (await readJson(linksResponse)) as {
      items: Array<{ id: string; isPrimary: boolean; label: string }>
    }

    expect(linksResponse.status).toBe(200)
    expect(links.items).toMatchObject([
      {
        id: link.id,
        label: 'LinkedIn Easy Apply',
        isPrimary: true,
      },
      {
        label: 'official',
        isPrimary: false,
      },
    ])

    const eventsResponse = await fetch(`${server.url}/v1/applications/${created.id}/events?limit=10`)
    const events = (await readJson(eventsResponse)) as {
      items: Array<{ type: string }>
    }

    expect(eventsResponse.status).toBe(200)
    expect(events.items.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'application_created',
        'application_updated',
        'workflow_updated',
        'note',
        'link_created',
        'link_updated',
      ]),
    )

    const archiveResponse = await fetch(`${server.url}/v1/applications/${created.id}/archive`, {
      body: JSON.stringify({ note: 'No longer pursuing.' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    expect(archiveResponse.status).toBe(200)

    const getArchivedResponse = await fetch(`${server.url}/v1/applications/${created.id}`)
    expect(getArchivedResponse.status).toBe(404)
  })

  it('runs application attempt commands through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const startResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/attempts`,
      {
        body: JSON.stringify({
          actorType: 'agent',
          actorName: 'codex',
          summary: 'Started from HTTP.',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    const attempt = (await readJson(startResponse)) as { id: string }

    expect(startResponse.status).toBe(200)
    expect(attempt).toMatchObject({
      status: 'in_progress',
      steps: [{ type: 'attempt_started' }],
    })

    const stepResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/attempts/${attempt.id}/steps`,
      {
        body: JSON.stringify({
          type: 'page_verified',
          message: 'Verified contact page.',
          payload: {
            page: 'contact',
          },
          actor: 'agent:codex',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )

    await expect(readJson(stepResponse)).resolves.toMatchObject({
      sequence: 2,
      type: 'page_verified',
    })

    const completeResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/attempts/${attempt.id}/complete`,
      {
        body: JSON.stringify({
          outcome: 'needs_user_info',
          summary: 'Needs exact availability dates.',
          missingUserInfo: 'Fall 2026 start and end dates',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    await expect(readJson(completeResponse)).resolves.toMatchObject({
      status: 'completed',
      outcome: 'needs_user_info',
    })

    const listResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/attempts?limit=10`,
    )

    await expect(readJson(listResponse)).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: attempt.id,
          steps: [
            { type: 'attempt_started' },
            { type: 'page_verified' },
            { type: 'attempt_completed' },
          ],
        },
      ],
    })
  })

  it('accepts verification receipt attempt steps and completes submitted attempts through the API', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const startResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/attempts`,
      {
        body: JSON.stringify({
          actorType: 'agent',
          actorName: 'codex',
          summary: 'Started from HTTP.',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    const attempt = (await readJson(startResponse)) as { id: string }
    const receiptResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/attempts/${attempt.id}/steps`,
      {
        body: JSON.stringify({
          type: 'verification_receipt',
          message: 'Final review verification passed.',
          payload: {
            version: 1,
            scope: 'final_review',
            status: 'passed',
            verified: ['resume_attachment', 'contact_info', 'required_answers'],
            unresolved: [],
            evidence: 'Final review page showed resume, contact info, and required answers.',
          },
          actor: 'agent:codex',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )

    await expect(readJson(receiptResponse)).resolves.toMatchObject({
      sequence: 2,
      type: 'verification_receipt',
    })

    const completeResponse = await fetch(
      `${server.url}/v1/applications/application-versant-platform/attempts/${attempt.id}/complete`,
      {
        body: JSON.stringify({
          outcome: 'submitted',
          summary: 'Submitted after final review verification.',
          confirmationText: 'Application submitted',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    await expect(readJson(completeResponse)).resolves.toMatchObject({
      status: 'completed',
      outcome: 'submitted',
      steps: [
        { type: 'attempt_started' },
        { type: 'verification_receipt' },
        { type: 'attempt_completed' },
      ],
    })
  })

  it('returns useful HTTP statuses for unauthorized and missing resources', async () => {
    server = await createValedictorianHttpServer({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const unauthorized = await fetch(`${server.url}/v1/applications`)
    const missing = await fetch(`${server.url}/v1/applications/missing`, {
      headers: { authorization: 'Bearer server-token' },
    })

    expect(unauthorized.status).toBe(401)
    await expect(readJson(unauthorized)).resolves.toEqual({ message: 'Unauthorized' })
    expect(missing.status).toBe(404)
    await expect(readJson(missing)).resolves.toEqual({ message: 'Application not found: missing' })
  })
})
