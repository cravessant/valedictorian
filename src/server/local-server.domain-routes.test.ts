import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeWorkspace } from '../workspace/workspace.initializer'
import { createFileWorkspaceRegistryStore } from '../workspace/workspace.registry'
import { createLocalWorkspaceManager } from './local-workspaces'
import { createBoundaryWorkspaceClient as createBoundaryTestClient, createSeededLocalClient as createLocalValedictorianClient, createTempSqlitePath, readJson, createLocalServerHttpTestFixture } from './local-server.http-test-harness'

describe('local Valedictorian HTTP server', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('blocks opening a workspace when its manifest id is registered to a different path', async () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-collision-a-'))
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-collision-b-'))
    const firstWorkspace = initializeWorkspace(firstRoot, {
      createId: () => 'workspace-collision',
    })
    initializeWorkspace(secondRoot, {
      createId: () => 'workspace-collision',
    })
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    await registryStore.markOpened({
      id: firstWorkspace.id,
      name: firstWorkspace.name,
      path: firstWorkspace.rootPath,
    })

    const server = await fixture.start({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: createLocalWorkspaceManager({ registryStore }),
    })

    const response = await fetch(`${server.url}/v1/workspaces/open`, {
      body: JSON.stringify({ path: secondRoot }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(409)
    await expect(readJson(response)).resolves.toEqual({
      message:
        'Workspace id workspace-collision is already registered to a different path. Re-key the workspace to register it here.',
    })
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: 'workspace-collision',
      workspaces: {
        'workspace-collision': {
          path: firstRoot,
        },
      },
    })
  })

  it('re-keys a colliding workspace manifest when explicitly requested', async () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-rekey-a-'))
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-rekey-b-'))
    const firstWorkspace = initializeWorkspace(firstRoot, {
      createId: () => 'workspace-collision',
      now: new Date('2026-06-12T09:00:00.000Z'),
    })
    initializeWorkspace(secondRoot, {
      createId: () => 'workspace-collision',
      now: new Date('2026-06-12T09:30:00.000Z'),
    })
    const manifestPath = path.join(secondRoot, '.valedictorian', 'manifest.json')
    const manifestBeforeRekey = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    await registryStore.markOpened({
      id: firstWorkspace.id,
      name: firstWorkspace.name,
      path: firstWorkspace.rootPath,
    })

    const server = await fixture.start({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager: createLocalWorkspaceManager({
        createId: () => 'workspace-rekeyed',
        now: () => new Date('2026-06-12T14:00:00.000Z'),
        registryStore,
      }),
    })

    const response = await fetch(`${server.url}/v1/workspaces/open`, {
      body: JSON.stringify({ path: secondRoot, rekey: true }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })

    await expect(readJson(response)).resolves.toMatchObject({
      id: 'workspace-rekeyed',
      path: secondRoot,
    })
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).toEqual({
      ...manifestBeforeRekey,
      id: 'workspace-rekeyed',
    })
    await expect(registryStore.get()).resolves.toMatchObject({
      lastOpenedWorkspaceId: 'workspace-rekeyed',
      workspaces: {
        'workspace-collision': {
          path: firstRoot,
        },
        'workspace-rekeyed': {
          path: secondRoot,
        },
      },
    })
  })

  it('records and clears a workspace latest error around backend load attempts', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-error-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    const workspaceManager = createLocalWorkspaceManager({
      createId: () => 'workspace-error',
      now: () => new Date('2026-06-12T15:00:00.000Z'),
      registryStore,
      seedDataMode: 'sample',
    })
    await workspaceManager.open({ path: workspaceRoot })
    fs.rmSync(workspaceRoot, { force: true, recursive: true })

    const server = await fixture.start({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager,
    })

    const failingResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-error/applications?limit=1`,
    )

    expect(failingResponse.status).toBe(400)
    await expect(fetch(`${server.url}/v1/workspaces`).then(readJson)).resolves.toMatchObject({
      items: [
        {
          id: 'workspace-error',
          latestError: {
            at: '2026-06-12T15:00:00.000Z',
            message: `Workspace path does not exist: ${workspaceRoot}`,
          },
        },
      ],
    })

    initializeWorkspace(workspaceRoot, { createId: () => 'workspace-error' })

    const successfulResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-error/applications?limit=1`,
    )

    expect(successfulResponse.status).toBe(200)
    await expect(fetch(`${server.url}/v1/workspaces`).then(readJson)).resolves.toMatchObject({
      items: [
        {
          id: 'workspace-error',
          latestError: null,
        },
      ],
    })
  })

  it('exposes write-only workspace secrets and explicit sensitive profile details over HTTP', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-http-secrets-'))
    const registryStore = createFileWorkspaceRegistryStore(createTempSqlitePath())
    const workspaceManager = createLocalWorkspaceManager({
      createId: () => 'workspace-secrets',
      registryStore,
      secretCodec: {
        decrypt(value) {
          return value.replace(/^enc:/, '')
        },
        encrypt(value) {
          return `enc:${value}`
        },
      },
    })
    await workspaceManager.open({ path: workspaceRoot })

    const server = await fixture.start({
      client: createBoundaryTestClient(() => {}),
      host: '127.0.0.1',
      port: 0,
      workspaceManager,
    })

    const secretResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/secrets/greenhouse_password`,
      {
        body: JSON.stringify({
          kind: 'password',
          label: 'Greenhouse',
          value: 'correct horse battery staple',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      },
    )
    const secretPayload = (await readJson(secretResponse)) as Record<string, unknown>
    const listResponse = await fetch(`${server.url}/v1/workspaces/workspace-secrets/secrets`)
    const listPayload = (await readJson(listResponse)) as { items: Array<Record<string, unknown>> }
    const revealResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/secrets/greenhouse_password`,
    )

    expect(secretResponse.status).toBe(200)
    expect(secretPayload).toMatchObject({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse',
    })
    expect(secretPayload).not.toHaveProperty('value')
    expect(listPayload.items[0]).toMatchObject({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse',
    })
    expect(listPayload.items[0]).not.toHaveProperty('value')
    expect(revealResponse.status).toBe(404)

    const sensitiveUpdateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/profile/sensitive`,
      {
        body: JSON.stringify({ disabilityStatus: 'No', ssnLast4: '5125' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
    )
    const sensitiveGetResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/profile/sensitive`,
    )

    await expect(readJson(sensitiveUpdateResponse)).resolves.toMatchObject({
      disabilityStatus: 'No',
      ssnLast4: '5125',
    })
    await expect(readJson(sensitiveGetResponse)).resolves.toMatchObject({
      disabilityStatus: 'No',
      ssnLast4: '5125',
    })

    const deleteResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-secrets/secrets/greenhouse_password`,
      { method: 'DELETE' },
    )
    const emptyListResponse = await fetch(`${server.url}/v1/workspaces/workspace-secrets/secrets`)

    expect(deleteResponse.status).toBe(200)
    await expect(readJson(emptyListResponse)).resolves.toEqual({ items: [] })
  })

  it('lists and gets applications with auth, filters, and pagination', async () => {
    const server = await fixture.start({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const listResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/applications?status=needs_user_info&minScore=6&source=linkedin&limit=25&offset=0`,
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

    const getResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/applications/${listPayload.items[0].id}`, {
      headers: { authorization: 'Bearer server-token' },
    })

    await expect(readJson(getResponse)).resolves.toMatchObject({
      id: listPayload.items[0].id,
      companyName: 'Astranis Space Technologies',
    })
  })

  it('lists action queue rows with auth, action bucket filtering, and pagination', async () => {
    const server = await fixture.start({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const actionQueueResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/action-queue?actionBucket=apply_now&limit=25&offset=0`,
      { headers: { authorization: 'Bearer server-token' } },
    )
    const actionQueuePayload = (await readJson(actionQueueResponse)) as {
      items: Array<{ actionBucket: string; companyName: string; id: string }>
      total: number
    }

    expect(actionQueueResponse.status).toBe(200)
    expect(actionQueuePayload.total).toBe(1)
    expect(actionQueuePayload.items[0]).toMatchObject({
      id: 'application-versant-platform',
      companyName: 'Versant Media',
      actionBucket: 'apply_now',
    })
  })

  it('serves profile update, read, and non-secret agent context routes', async () => {
    const server = await fixture.start({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const updateResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/profile`, {
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
      fetch(`${server.url}/v1/workspaces/workspace-1/profile`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({
      email: 'kenny@example.com',
      fullName: 'Kenny Lin',
    })
    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/profile/agent-context`, {
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
    const server = await fixture.start({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const runResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/runs`, {
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

    const findingResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings`, {
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
        timingMode: 'dates',
        startDate: '2027-05-15',
        endDate: '2027-09-01',
        officialUrl: 'https://jobs.example.com/delta',
        priorityScore: 7,
        priorityBand: 'high',
      }),
    })
    const finding = (await readJson(findingResponse)) as { id: string; sourceId: string }

    expect(findingResponse.status).toBe(200)
    expect(finding).toMatchObject({
      term: 'Summer 2027 / Fall 2027',
      terms: [
        { season: 'summer', year: 2027 },
        { season: 'fall', year: 2027 },
      ],
      timingMode: 'dates',
      startDate: '2027-05-15',
      endDate: '2027-09-01',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/runs?runType=sourcing&status=in_progress&sourceId=${finding.sourceId}`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({ total: 1, items: [{ id: run.id }] })
    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings?workflowRunId=${run.id}&sourceId=${finding.sourceId}&mergeStatus=new`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({ total: 1, items: [{ id: finding.id }] })
    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings?usability=usable&destinationClass=employer_or_ats`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({ total: 0, items: [] })

    const blockedFindingResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings`, {
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

    const mergedCreateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workflowRunId: run.id,
          sourceName: 'LinkedIn',
          companyName: 'Manual Merge Labs',
          roleTitle: 'Software Engineering Intern',
          roleKind: 'internship',
          country: 'US',
          workMode: 'remote',
          sourceUrl: 'https://linkedin.com/jobs/view/manual-merge-labs',
          priorityScore: 8,
          priorityBand: 'high',
          mergeStatus: 'merged',
        }),
      },
    )

    expect(mergedCreateResponse.status).toBe(400)
    await expect(readJson(mergedCreateResponse)).resolves.toEqual({
      message: 'Sourcing findings can only be marked merged by promotion.',
    })

    const mixedTimingResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workflowRunId: run.id,
          sourceName: 'LinkedIn',
          companyName: 'Mixed Timing Labs',
          roleTitle: 'Software Engineering Intern',
          roleKind: 'internship',
          country: 'US',
          workMode: 'remote',
          term: 'Fall 2027',
          startDate: '2027-09-01',
          sourceUrl: 'https://linkedin.com/jobs/view/mixed-timing-labs',
        }),
      },
    )

    expect(mixedTimingResponse.status).toBe(400)
    await expect(readJson(mixedTimingResponse)).resolves.toEqual({
      message: 'Date-based timing cannot include term or terms input.',
    })

    const mergedUpdateResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mergeStatus: 'merged' }),
      },
    )

    expect(mergedUpdateResponse.status).toBe(400)
    await expect(readJson(mergedUpdateResponse)).resolves.toEqual({
      message: 'Sourcing findings can only be marked merged by promotion.',
    })

    const duplicateNotesResponse = await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ duplicateNotes: 'Looks duplicated.' }),
      },
    )

    expect(duplicateNotesResponse.status).toBe(400)
    await expect(readJson(duplicateNotesResponse)).resolves.toEqual({
      message:
        'duplicateNotes is generated by duplicate detection; use dispositionReason or mergeNotes for manual notes.',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}`, {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceUrl:
            'https://linkedin.com/jobs/view/human-labs?currentJobId=123&trackingId=abc&utm_source=agent',
          priorityScore: 4,
          priorityBand: 'skip',
          fitNotes: 'Below the current sourcing cutoff.',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      fitNotes: 'Below the current sourcing cutoff.',
      mergeStatus: 'below_cutoff',
      priorityScore: 4,
      sourceUrl:
        'https://linkedin.com/jobs/view/human-labs?currentJobId=123&trackingId=abc&utm_source=agent',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/findings/${blockedFinding.id}/decide`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          mergeStatus: 'blocked',
          mergeNotes: 'Needs user decision on sponsorship.',
          policyBlocker: 'needs_user_decision',
        }),
      }).then(readJson),
    ).resolves.toMatchObject({
      dispositionReason: 'Needs user decision on sponsorship.',
      id: blockedFinding.id,
      mergeNotes: 'Needs user decision on sponsorship.',
      mergeStatus: 'blocked',
      policyBlocker: 'needs_user_decision',
    })

    const promotedFinding = (await fetch(
      `${server.url}/v1/workspaces/workspace-1/sourcing/findings/${finding.id}/promote`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer server-token' },
      },
    ).then(readJson)) as { id: string; mergedApplicationId: string; mergeStatus: string }

    expect(promotedFinding).toMatchObject({
      id: finding.id,
      mergeStatus: 'merged',
      mergedApplicationId: expect.any(String),
    })
    await expect(
      fetch(
        `${server.url}/v1/workspaces/workspace-1/sourcing/findings?workflowRunId=${run.id}&mergeStatus=merged`,
        {
          headers: { authorization: 'Bearer server-token' },
        },
      ).then(readJson),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: finding.id, mergedApplicationId: promotedFinding.mergedApplicationId }],
    })

    const candidateResponse = await fetch(`${server.url}/v1/workspaces/workspace-1/sourcing/candidates/process`, {
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

  it('returns a bad request for invalid action queue buckets', async () => {
    const server = await fixture.start({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/workspace-1/action-queue?actionBucket=random`,
      {
        headers: { authorization: 'Bearer server-token' },
      },
    )

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      message: 'Invalid action queue bucket: random',
    })
  })

  it('serves policy config, evidence, and scheduler-ready evaluation endpoints', async () => {
    const server = await fixture.start({
      client: createLocalValedictorianClient({ sqlitePath: createTempSqlitePath() }),
      host: '127.0.0.1',
      port: 0,
      token: 'server-token',
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/policy/config`, {
        headers: { authorization: 'Bearer server-token' },
      }).then(readJson),
    ).resolves.toMatchObject({
      scoring: {
        applyCutoff: 6,
      },
    })

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/policy/config`, {
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

    const evidence = (await fetch(`${server.url}/v1/workspaces/workspace-1/policy/evidence`, {
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
        `${server.url}/v1/workspaces/workspace-1/policy/evidence?subjectType=application&subjectId=application-versant-platform`,
        {
          headers: { authorization: 'Bearer server-token' },
        },
      ).then(readJson),
    ).resolves.toEqual([expect.objectContaining({ id: evidence.id })])

    await expect(
      fetch(`${server.url}/v1/workspaces/workspace-1/policy/evaluate/run-window`, {
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


})
