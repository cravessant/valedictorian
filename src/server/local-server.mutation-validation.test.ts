import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBoundaryWorkspaceClient as createBoundaryTestClient, readJson, createLocalServerHttpTestFixture } from './local-server.http-test-harness'

describe('local Valedictorian HTTP server mutation validation', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('rejects invalid create mutation input before calling the client', async () => {
    let createCalls = 0
    const server = await fixture.start({
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
      const body = await readJson(response)
      expect(body).toEqual({ message: 'The request is invalid.' })
      expect(JSON.stringify(body)).not.toContain(testCase.message)
    }

    expect(createCalls).toBe(0)
  })

})
