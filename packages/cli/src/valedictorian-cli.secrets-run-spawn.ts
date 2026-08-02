import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import type { Writable } from 'node:stream'

export interface SecretsRunSpawnRequest {
  readonly executable: string
  readonly argv: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly shell: false
  stdin: 'ignore' | { value: string }
  readonly fdValues: Map<number, string>
  readonly signal?: AbortSignal
}

export interface SecretsRunSpawnResult {
  readonly exitCode: number
}

export type SecretsRunSpawnAdapter = (
  request: SecretsRunSpawnRequest,
) => Promise<SecretsRunSpawnResult>

const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

export const defaultSecretsRunSpawn: SecretsRunSpawnAdapter = async (request) => {
  const stdio = buildStdio(request)
  const child = nodeSpawn(request.executable, [...request.argv], {
    env: request.env,
    shell: false,
    stdio,
  })

  return await waitForSpawnedChild(child, request)
}

function buildStdio(request: SecretsRunSpawnRequest): Array<'ignore' | 'inherit' | 'pipe'> {
  const maxFd = request.fdValues.size > 0 ? Math.max(...request.fdValues.keys()) : 2
  const stdio: Array<'ignore' | 'inherit' | 'pipe'> = []

  for (let fd = 0; fd <= maxFd; fd += 1) {
    if (fd === 0) {
      stdio.push(request.stdin === 'ignore' ? 'ignore' : 'pipe')
      continue
    }
    if (fd === 1 || fd === 2) {
      stdio.push('inherit')
      continue
    }
    stdio.push(request.fdValues.has(fd) ? 'pipe' : 'ignore')
  }

  return stdio
}

export async function waitForSpawnedChild(
  child: ChildProcess,
  request: SecretsRunSpawnRequest,
): Promise<SecretsRunSpawnResult> {
  const listeners: Array<() => void> = []
  const ownedStreams: Writable[] = []
  let settled = false
  let rejectLifecycle: ((error: Error) => void) | undefined

  const failLifecycle = (error: Error) => {
    if (settled) {
      return
    }
    settled = true
    child.kill('SIGTERM')
    rejectLifecycle?.(valueFreeSpawnError(error))
  }

  try {
    return await new Promise<SecretsRunSpawnResult>((resolve, reject) => {
      rejectLifecycle = reject

      if (request.stdin !== 'ignore') {
        const stdin = child.stdin
        if (!stdin) {
          reject(new Error('secrets run failed to open child stdin'))
          return
        }
        ownedStreams.push(stdin)
        attachOwnedStreamError(stdin, failLifecycle, listeners)
        stdin.end(request.stdin.value)
      }

      for (const [fd, value] of request.fdValues) {
        const stream = child.stdio[fd]
        if (!stream || !('end' in stream) || typeof stream.end !== 'function') {
          reject(new Error(`secrets run failed to open child file descriptor ${fd}`))
          return
        }
        ownedStreams.push(stream as Writable)
        attachOwnedStreamError(stream as Writable, failLifecycle, listeners)
        ;(stream as Writable).end(value)
      }

      for (const signalName of forwardedSignals) {
        const onSignal = () => {
          if (!settled) {
            child.kill(signalName)
          }
        }
        process.on(signalName, onSignal)
        listeners.push(() => process.off(signalName, onSignal))
      }

      if (request.signal) {
        const onAbort = () => {
          if (!settled) {
            child.kill('SIGTERM')
          }
        }
        if (request.signal.aborted) {
          onAbort()
        } else {
          request.signal.addEventListener('abort', onAbort, { once: true })
          listeners.push(() => request.signal?.removeEventListener('abort', onAbort))
        }
      }

      const onChildError = (error: Error) => {
        if (settled) {
          return
        }
        settled = true
        reject(error)
      }
      const onChildExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return
        }
        settled = true
        if (signal) {
          resolve({ exitCode: 128 + signalNumber(signal) })
          return
        }
        resolve({ exitCode: code ?? 1 })
      }
      child.on('error', onChildError)
      child.on('exit', onChildExit)
      listeners.push(() => {
        child.off('error', onChildError)
        child.off('exit', onChildExit)
      })
    })
  } finally {
    for (const remove of listeners) {
      remove()
    }
    closeOwnedStreams(ownedStreams.length > 0 ? ownedStreams : collectStdioStreams(child))
    if (!settled) {
      child.kill('SIGTERM')
    }
  }
}

function attachOwnedStreamError(
  stream: Writable,
  onError: (error: Error) => void,
  listeners: Array<() => void>,
) {
  const handleError = (error: Error) => {
    onError(error)
  }
  stream.on('error', handleError)
  listeners.push(() => stream.off('error', handleError))
}

function valueFreeSpawnError(error: Error): Error {
  const code =
    'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string'
      ? (error as NodeJS.ErrnoException).code
      : undefined
  if (code === 'EPIPE') {
    return Object.assign(new Error('secrets run child pipe closed'), { code: 'EPIPE' })
  }
  return new Error('secrets run child stream failed')
}

function collectStdioStreams(child: ChildProcess): Writable[] {
  const streams: Writable[] = []
  for (const stream of child.stdio) {
    if (stream && typeof stream === 'object' && 'destroy' in stream) {
      streams.push(stream as Writable)
    }
  }
  return streams
}

function closeOwnedStreams(streams: Writable[]) {
  for (const stream of streams) {
    if ('destroyed' in stream && stream.destroyed) {
      continue
    }
    if (typeof stream.destroy === 'function') {
      stream.destroy()
    }
  }
}

function signalNumber(signal: NodeJS.Signals): number {
  const signals = osConstants.signals as Record<string, number | undefined>
  return signals[signal] ?? 1
}
