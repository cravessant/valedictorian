import { fork, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SUPERVISED_LEADER_EXIT_MESSAGE = 'supervised-leader-exit'

export type ProcessSignalSender = (pid: number, signal: NodeJS.Signals) => unknown
export interface ProcessCommandResult {
  error?: Error
  status: number | null
  stderr?: Buffer | string
}
export interface ProcessTreeTerminationOptions {
  force?: boolean
  platform?: NodeJS.Platform
  runCommand?: (command: string, args: string[]) => ProcessCommandResult
  sendSignal?: ProcessSignalSender
}

export interface ProcessTreeShutdownOptions {
  forceAfterMs?: number
  onError?: (error: unknown) => void
  platform?: NodeJS.Platform
  processId: number
  terminate?: (
    processId: number,
    options: Pick<ProcessTreeTerminationOptions, 'force' | 'platform'>,
  ) => void
  waitForExit?: (processId: number, platform: NodeJS.Platform) => Promise<void>
}

export interface ProcessTreeShutdown {
  begin(): void
  hasFailed(): boolean
  leaderExited(): void
  waitForExit(): Promise<boolean>
}

export interface ProcessGroupExitWaitOptions {
  attempts?: number
  delay?: (milliseconds: number) => Promise<void>
  intervalMs?: number
  probe?: (pid: number) => unknown
}

export interface SupervisedLaunchLifecycleOptions {
  cleanup: () => void
  processTreeShutdown: ProcessTreeShutdown
  setExitCode: (code: number) => void
}

export interface SupervisedLeaderExitMessage {
  code: number | null
  signal: NodeJS.Signals | null
  type: typeof SUPERVISED_LEADER_EXIT_MESSAGE
}

export interface SupervisedAnchorLaunchOptions {
  environment: NodeJS.ProcessEnv
  forkProcess?: typeof fork
  modulePath?: string
  platform?: NodeJS.Platform
}

export function terminateProcessTree(
  processId: number,
  {
    force = false,
    platform = process.platform,
    runCommand = (command, args) => spawnSync(command, args, {
      encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'],
    }),
    sendSignal = (pid, signal) => process.kill(pid, signal),
  }: ProcessTreeTerminationOptions = {},
) {
  if (platform === 'win32') {
    const result = runCommand('taskkill', [
      '/PID', String(processId), '/T', ...(force ? ['/F'] : []),
    ])
    if (result.error) throw result.error
    const stderr = typeof result.stderr === 'string'
      ? result.stderr
      : result.stderr?.toString('utf8') ?? ''
    if (result.status !== 0 && !/not found|no running instance|not running/i.test(stderr)) {
      throw new Error(`taskkill failed with exit status ${String(result.status)}.`)
    }
    return
  }
  try {
    sendSignal(-processId, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    if (code !== 'ESRCH' && !(code === 'EPERM' && isProcessGone(processId))) {
      throw error
    }
  }
}

export function createProcessTreeShutdown({
  forceAfterMs = 5_000,
  onError = () => undefined,
  platform = process.platform,
  processId,
  terminate = terminateProcessTree,
  waitForExit = (id, currentPlatform) => currentPlatform === 'win32'
    ? Promise.resolve()
    : waitForProcessGroupExit(id),
}: ProcessTreeShutdownOptions) {
  let began = false
  let failed = false
  let forced = false
  let forceTimer: ReturnType<typeof setTimeout> | undefined

  function reportError(error: unknown) {
    failed = true
    onError(error)
  }

  function force() {
    if (forced) return
    try {
      terminate(processId, { force: true, platform })
      forced = true
      if (forceTimer) clearTimeout(forceTimer)
      forceTimer = undefined
    } catch (error) {
      reportError(error)
    }
  }

  const shutdown: ProcessTreeShutdown = {
    begin() {
      if (began) return
      began = true
      forceTimer = setTimeout(force, forceAfterMs)
      forceTimer.unref()

      if (platform === 'win32') {
        force()
        return
      }

      try {
        terminate(processId, { platform })
      } catch (error) {
        force()
        reportError(error)
      }
    },
    hasFailed() {
      return failed
    },
    leaderExited() {
      if (began) force()
    },
    async waitForExit() {
      try {
        await waitForExit(processId, platform)
        return platform !== 'win32' || !failed
      } catch (error) {
        reportError(error)
        return false
      }
    },
  }
  return shutdown
}

export async function waitForProcessGroupExit(
  processId: number,
  {
    attempts = 50,
    delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    intervalMs = 100,
    probe = (pid) => process.kill(pid, 0),
  }: ProcessGroupExitWaitOptions = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      probe(-processId)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined
      if (code === 'ESRCH') return
      if (code === 'EPERM' && leaderIsGone(processId, probe)) return
      throw error
    }
    if (attempt + 1 < attempts) await delay(intervalMs)
  }
  throw new Error(`Process group ${String(processId)} did not exit after forced termination.`)
}

function leaderIsGone(processId: number, probe: (pid: number) => unknown) {
  try {
    probe(processId)
    return false
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    return code === 'ESRCH'
  }
}

function isProcessGone(processId: number) {
  try {
    process.kill(processId, 0)
    return false
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    return code === 'ESRCH'
  }
}

export function launchSupervisedAnchor({
  environment,
  forkProcess = fork,
  modulePath = fileURLToPath(new URL('./supervised-anchor.ts', import.meta.url)),
  platform = process.platform,
}: SupervisedAnchorLaunchOptions) {
  return forkProcess(modulePath, [], {
    detached: platform !== 'win32',
    env: environment,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
}

export function createSupervisedLaunchLifecycle({
  cleanup,
  processTreeShutdown,
  setExitCode,
}: SupervisedLaunchLifecycleOptions) {
  let began = false
  let finalization: Promise<void> | undefined
  let leaderExitCode: number | undefined

  function beginTermination() {
    if (began) return
    began = true
    processTreeShutdown.begin()
  }

  return {
    anchorExited(treeAlreadyStopped = false) {
      if (finalization) return finalization
      finalization = (async () => {
        if (!treeAlreadyStopped) {
          if (!began) beginTermination()
          processTreeShutdown.leaderExited()
        }
        const exited = await processTreeShutdown.waitForExit()
        if (!exited) {
          setExitCode(1)
          return
        }
        cleanup()
        setExitCode(processTreeShutdown.hasFailed() ? 1 : (leaderExitCode ?? 1))
      })()
      return finalization
    },
    leaderExited(code: number | null, signal: NodeJS.Signals | null, treeAlreadyStopped = false) {
      leaderExitCode ??= code ?? (signal ? 1 : 0)
      if (!treeAlreadyStopped) beginTermination()
    },
    shutdown: beginTermination,
  }
}

export function isSupervisedLeaderExitMessage(
  value: unknown,
): value is SupervisedLeaderExitMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SupervisedLeaderExitMessage>
  return candidate.type === SUPERVISED_LEADER_EXIT_MESSAGE
    && (candidate.code === null || typeof candidate.code === 'number')
    && (candidate.signal === null || typeof candidate.signal === 'string')
}
