import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ValedictorianWorkspaceClient } from 'sparxie'
import { createValedictorianHttpServer, type StartedValedictorianHttpServer } from './local-server'

async function readJson(response: Response) {
  return (await response.json()) as unknown
}

function createBoundaryTestClient(onCreate: () => void): ValedictorianWorkspaceClient {
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
    actionQueue: {
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
  } as unknown as ValedictorianWorkspaceClient
}

describe('local Valedictorian HTTP server mutation validation', () => {
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
      const response = await fetch(`${server.url}/v1/workspaces/workspace-1/applications`, {
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

})
