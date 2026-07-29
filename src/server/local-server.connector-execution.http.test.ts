import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConnectorExecutionError,
  connectorInstalledVersionMismatchError,
  unexpectedConnectorExecutionError,
} from '../modules/connectors/public/connector.execution-errors'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'

const INTERNAL_ERROR_BODY = {
  code: 'internal_error',
  message: 'An unexpected error occurred.',
}

const CONFLICT_ERROR_BODY = { message: 'The request conflicts with the current state.' }

function jsonRequest(method: string, body: unknown) {
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method }
}

describe('local server connector execution HTTP errors', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  it('returns a fixed 409 for a nominal connector execution conflict', async () => {
    const client = createBoundaryWorkspaceClient(() => {}, {
      connectors: {
        runs: {
          async trigger() {
            throw new ConnectorExecutionError('disabled connector id canary')
          },
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      onRequestError: vi.fn(),
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/connector-errors/connectors/fixture/runs`,
      {
        body: JSON.stringify({ mode: 'manual' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual(CONFLICT_ERROR_BODY)
  })

  it('returns a fixed 500 for a nominal unexpected connector execution failure', async () => {
    const failure = unexpectedConnectorExecutionError()
    const events: unknown[] = []
    const client = createBoundaryWorkspaceClient(() => {}, {
      connectors: {
        runs: {
          async trigger() {
            throw failure
          },
        },
      } as never,
    })
    const server = await fixture.start({
      client,
      onRequestError(event) {
        events.push(event)
      },
      resolveWorkspaceClient: () => client,
    })

    const response = await fetch(
      `${server.url}/v1/workspaces/connector-errors/connectors/fixture/runs`,
      {
        body: JSON.stringify({ mode: 'manual' }),
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'connector-unexpected-89',
        },
        method: 'POST',
      },
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      ...INTERNAL_ERROR_BODY,
      requestId: 'connector-unexpected-89',
    })
    expect(events).toEqual([{
      error: failure,
      method: 'POST',
      pathname: '/v1/workspaces/connector-errors/connectors/fixture/runs',
      requestId: 'connector-unexpected-89',
    }])
    expect(events[0]).toMatchObject({ error: failure })
    expect(Object.getOwnPropertyNames(failure)).toEqual([
      'stack',
      'message',
      'statusCode',
      'name',
    ])
    expect(Reflect.ownKeys(failure)).toEqual([
      'stack',
      'message',
      'statusCode',
      'name',
    ])
    expect(failure).toMatchObject({
      name: 'ConnectorExecutionError',
      message: 'Connector execution failed.',
      statusCode: 500,
    })
    expect(failure.cause).toBeUndefined()
    expect(failure).not.toHaveProperty('detail')
  })

  it.each([
    {
      body: {
        id: 'connector one',
        connectorId: 'fixture.jobs',
        connectorVersion: '0.12.0',
        displayName: 'Fixture Jobs',
        enabled: true,
        auth: [],
        config: {},
        filters: {},
      },
      method: 'POST',
      path: '/connectors',
      surface: 'create',
    },
    {
      body: { connectorVersion: '0.13.0', enabled: false },
      method: 'PATCH',
      path: '/connectors/connector%20one',
      surface: 'update',
    },
    {
      body: { mode: 'manual' },
      method: 'POST',
      path: '/connectors/connector%20one/runs',
      surface: 'run trigger',
    },
  ])(
    'returns the fixed 409 conflict without version detail for a $surface mismatch',
    async ({ body, method, path }) => {
      const events: unknown[] = []
      const reject = () => {
        throw connectorInstalledVersionMismatchError('fixture.jobs', '0.13.0')
      }
      const client = createBoundaryWorkspaceClient(() => {}, {
        connectors: {
          create: reject,
          update: reject,
          runs: { trigger: reject },
        } as never,
      })
      const server = await fixture.start({
        client,
        onRequestError(event) {
          events.push(event)
        },
        resolveWorkspaceClient: () => client,
      })

      const response = await fetch(
        `${server.url}/v1/workspaces/connector-errors${path}`,
        jsonRequest(method, body),
      )
      const responseBody = await response.text()

      expect(response.status).toBe(409)
      expect(JSON.parse(responseBody)).toEqual(CONFLICT_ERROR_BODY)
      expect(responseBody).not.toMatch(/fixture\.jobs|0\.13\.0|0\.12\.0|mismatch|connector one/i)
      // A fixed classified conflict is not an unexpected failure, so nothing is logged.
      expect(events).toEqual([])
    },
  )
})
