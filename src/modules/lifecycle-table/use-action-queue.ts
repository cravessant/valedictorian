import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActionQueueBucket,
  ActionQueueListResult,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'

import { actionQueueLoadFailure } from '../../app/app-load-failure'
import type { ErrorPresentation } from '../../app/error-presentation'
import type { LifecycleLoadState } from './lifecycle-table'

const ACTION_QUEUE_PAGE_SIZE = 50

export interface ActionQueueState {
  readonly result: ActionQueueListResult | null
  readonly load: LifecycleLoadState
  readonly error: ErrorPresentation | null
}

export interface UseActionQueueParams {
  readonly client: Pick<ValedictorianWorkspaceClient, 'actionQueue'> | null
  readonly active: boolean
}

export interface UseActionQueueResult {
  readonly state: ActionQueueState
  readonly bucket: ActionQueueBucket | undefined
  readonly offset: number
  readonly setBucket: (bucket: ActionQueueBucket | undefined) => void
  readonly nextPage: () => void
  readonly previousPage: () => void
  readonly refresh: () => Promise<void>
}

export function useActionQueue({ client, active }: UseActionQueueParams): UseActionQueueResult {
  const [bucket, setBucketValue] = useState<ActionQueueBucket | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState<ActionQueueState>({
    result: null,
    load: { status: 'loading' },
    error: null,
  })
  const generation = useRef(0)
  const hasResultRef = useRef(false)

  const load = useCallback(async function loadActionQueue() {
    const gen = ++generation.current
    if (!client) {
      setState({
        result: null,
        load: { status: 'failure', message: 'Workspace HTTP client is unavailable.' },
        error: null,
      })
      return
    }
    setState((prev) => ({ result: prev.result, load: { status: 'loading' }, error: null }))
    try {
      const result = await client.actionQueue.list({
        ...(bucket !== undefined ? { actionBucket: bucket } : {}),
        limit: ACTION_QUEUE_PAGE_SIZE,
        offset,
      })
      if (gen !== generation.current) return
      if (offset > 0 && result.items.length === 0 && result.total > 0) {
        setOffset(0)
        return
      }
      hasResultRef.current = true
      setState({ result, load: { status: 'loaded' }, error: null })
    } catch (error: unknown) {
      if (gen !== generation.current) return
      const presentation = actionQueueLoadFailure(error, hasResultRef.current)
      setState((prev) => ({
        result: prev.result,
        load: {
          status: 'failure',
          message: presentation?.message ?? 'Action Queue could not be loaded.',
          onRetry: () => { void loadActionQueue() },
        },
        error: presentation,
      }))
    }
  }, [bucket, client, offset])

  useEffect(() => {
    if (active) void load()
  }, [active, load])

  const setBucket = useCallback((next: ActionQueueBucket | undefined) => {
    setBucketValue(next)
    setOffset(0)
  }, [])

  const nextPage = useCallback(() => {
    setOffset((prev) => prev + ACTION_QUEUE_PAGE_SIZE)
  }, [])

  const previousPage = useCallback(() => {
    setOffset((prev) => Math.max(0, prev - ACTION_QUEUE_PAGE_SIZE))
  }, [])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  return { state, bucket, offset, setBucket, nextPage, previousPage, refresh }
}
