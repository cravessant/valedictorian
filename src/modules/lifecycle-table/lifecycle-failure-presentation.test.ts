import { describe, expect, it } from 'vitest'

import {
  WorkspaceClientUnavailableError,
  workspaceClientUnavailableMessage,
} from '@/app/app-load-failure'
import { lifecycleLoadState } from './lifecycle-queries'
import { LifecycleBlockerError, commandFailureMessage } from './use-lifecycle-command'

/**
 * Every rejection a lifecycle surface can receive that is not an explicitly
 * canonical message. Each carries text a reader must never see: a path, a host,
 * a table name, a credential.
 */
const leaks: ReadonlyArray<unknown> = [
  new Error('sqlite: no such table capture_events at /Users/keni/workspace.db'),
  new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:4317'),
  'raw rejection naming /var/secrets/workspace-token',
  { message: 'object rejection naming internal-host.local' },
]

const forbidden = /workspace\.db|capture_events|127\.0\.0\.1|workspace-token|internal-host\.local/

function failedRead(error: unknown, data?: unknown) {
  return { isPending: false, isFetching: false, isError: true, error, data, refetch: () => {} }
}

function readMessage(error: unknown, fallback: string, data?: unknown): string {
  const state = lifecycleLoadState(failedRead(error, data), fallback)
  return state.status === 'failure' ? state.message : ''
}

describe('lifecycle failure presentation', () => {
  it.each([
    ['a lifecycle read', readMessage, 'Captures could not be loaded.'],
    ['a lifecycle command', commandFailureMessage, 'Capture removal failed.'],
  ])('reduces every unknown rejection %s receives to its fixed message', (_surface, present, fixed) => {
    for (const error of leaks) {
      const message = present(error, fixed)
      expect(message).toBe(fixed)
      expect(forbidden.test(message)).toBe(false)
    }
  })

  it('keeps the fixed message when a stale page is already on screen', () => {
    const message = readMessage(
      new Error('pg: FATAL role "keni" does not exist'),
      'Applications could not be loaded.',
      { items: [] },
    )

    expect(message).toBe('Applications could not be loaded.')
  })

  it('shows a canonical server blocker message the command already read', () => {
    expect(commandFailureMessage(
      new LifecycleBlockerError('Linked Jobs require a removal choice.'),
      'Capture removal failed.',
    )).toBe('Linked Jobs require a removal choice.')
  })

  it('passes the renderer\'s own connection message through both surfaces', () => {
    const unavailable = new WorkspaceClientUnavailableError()

    expect(readMessage(unavailable, 'Captures could not be loaded.'))
      .toBe(workspaceClientUnavailableMessage)
    expect(commandFailureMessage(unavailable, 'Capture removal failed.'))
      .toBe(workspaceClientUnavailableMessage)
  })
})
