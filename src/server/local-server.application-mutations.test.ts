import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBoundaryWorkspaceClient as createBoundaryTestClient, createSeededLocalClient as createLocalValedictorianClient, createTempDatabasePath, readJson, createLocalServerHttpTestFixture } from './local-server.http-test-harness'

describe('local Valedictorian HTTP server', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('rejects invalid workflow mutation input before calling the client', async () => {
    let workflowCalls = 0
    const client = createBoundaryTestClient(() => {})
    client.applications.workflow.update = async () => {
      workflowCalls += 1
      throw new Error('client workflow should not be called')
    }
    const server = await fixture.start({
      client,
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/application-1/workflow`, {
      body: JSON.stringify({
        lockStartedAt: 'tomorrow-ish',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({ message: 'The request is invalid.' })
    expect(workflowCalls).toBe(0)
  })

  it('rejects invalid attempt completion input before calling the client', async () => {
    let completeCalls = 0
    const client = createBoundaryTestClient(() => {})
    client.applications.attempts.complete = async () => {
      completeCalls += 1
      throw new Error('client attempt completion should not be called')
    }
    const server = await fixture.start({
      client,
      host: '127.0.0.1',
      port: 0,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-1/attempts/attempt-1/complete`,
      {
        body: JSON.stringify({
          outcome: 'needs_user_info',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({ message: 'The request is invalid.' })
    expect(completeCalls).toBe(0)
  })

  it('updates application status and records scores through the API', async () => {
    const server = await fixture.start({
      client: await createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const statusResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/status`,
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

    const scoreResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/scores`, {
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

    await expect(readJson(scoreResponse)).resolves.toMatchObject({
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
      id: expect.any(String) as string,
      createdAt: expect.any(String) as string,
    })

    const applicationResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform`,
    )

    await expect(readJson(applicationResponse)).resolves.toMatchObject({
      currentPriorityBand: 'high',
      currentPriorityScore: 8,
    })
  })

  it('runs application mutation commands through the API', async () => {
    const server = await fixture.start({
      client: await createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const createResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications`, {
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

    const updateResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}`, {
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

    const workflowResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/workflow`, {
      body: JSON.stringify({
        missingUserInfo: 'Graduation date confirmation',
        blockerReason: null,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    expect(workflowResponse.status).toBe(200)

    const noteResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/notes`, {
      body: JSON.stringify({ message: 'Reached review page.' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    await expect(readJson(noteResponse)).resolves.toMatchObject({
      notes: 'Reached review page.',
    })

    const linkResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/links`, {
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
      `${server.url}/v1/workspaces/workspace-1/applications/${created.id}/links/${link.id}`,
      {
        body: JSON.stringify({ label: 'LinkedIn Easy Apply' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )
    await expect(readJson(linkUpdateResponse)).resolves.toMatchObject({
      label: 'LinkedIn Easy Apply',
    })

    const linksResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/links?limit=10`)
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

    const eventsResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/events?limit=10`)
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

    const archiveResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}/archive`, {
      body: JSON.stringify({ note: 'No longer pursuing.' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    })
    expect(archiveResponse.status).toBe(200)

    const getArchivedResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${created.id}`)
    expect(getArchivedResponse.status).toBe(404)
  })

  it('runs application attempt commands through the API', async () => {
    const server = await fixture.start({
      client: await createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const startResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts`,
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
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/steps`,
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
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/complete`,
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
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts?limit=10`,
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
    const server = await fixture.start({
      client: await createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() }),
      host: '127.0.0.1',
      port: 0,
    })

    const startResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts`,
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
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/steps`,
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
      `${server.url}/v1/workspaces/workspace-1/applications/application-versant-platform/attempts/${attempt.id}/complete`,
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
    const server = await fixture.start({
      client: await createLocalValedictorianClient({ pgliteDataPath: createTempDatabasePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const unauthorized = await fetch(`${server.url}/v1/workspaces/workspace-1/applications`)
    const missing = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/missing`, {
      headers: { authorization: 'Bearer server-token' },
    })

    expect(unauthorized.status).toBe(401)
    await expect(readJson(unauthorized)).resolves.toEqual({ message: 'Unauthorized' })
    expect(missing.status).toBe(404)
    await expect(readJson(missing)).resolves.toEqual({ message: 'Application not found: missing' })
  })
})
