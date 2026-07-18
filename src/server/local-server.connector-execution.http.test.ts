import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConnectorExecutionError,
  unexpectedConnectorExecutionError,
} from '../modules/connectors/connector-execution.errors'
import {
  createBoundaryWorkspaceClient,
  createLocalServerHttpTestFixture,
} from './local-server.http-test-harness'

const INTERNAL_ERROR_BODY = {
  code: 'internal_error',
  message: 'An unexpected error occurred.',
}

const CONFLICT_ERROR_BODY = { message: 'The request conflicts with the current state.' }

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
})
