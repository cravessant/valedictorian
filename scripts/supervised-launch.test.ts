import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  createSupervisedLaunchLifecycle,
  createProcessTreeShutdown,
  launchSupervisedAnchor,
  terminateProcessTree,
  waitForProcessGroupExit,
} from './supervised-launch'

describe('supervised app launch', () => {
  it('terminates the renderer/backend process group as one unit', () => {
    const sendSignal = vi.fn()

    terminateProcessTree(43210, { platform: 'darwin', sendSignal })

    expect(sendSignal).toHaveBeenCalledWith(-43210, 'SIGTERM')
  })

  it('terminates the full Windows process tree', () => {
    const runCommand = vi.fn(() => ({ status: 0 }))

    terminateProcessTree(43210, { platform: 'win32', runCommand })

    expect(runCommand).toHaveBeenCalledWith('taskkill', ['/PID', '43210', '/T'])
  })

  it('force-terminates the full process tree on Windows and POSIX', () => {
    const runCommand = vi.fn(() => ({ status: 0 }))
    const sendSignal = vi.fn()

    terminateProcessTree(43210, { force: true, platform: 'win32', runCommand })
    terminateProcessTree(54321, { force: true, platform: 'linux', sendSignal })

    expect(runCommand).toHaveBeenCalledWith('taskkill', ['/PID', '43210', '/T', '/F'])
    expect(sendSignal).toHaveBeenCalledWith(-54321, 'SIGKILL')
  })

  it('ignores an exited Windows tree but surfaces arbitrary taskkill failures', () => {
    expect(() => terminateProcessTree(43210, {
      platform: 'win32',
      runCommand: () => ({ status: 128, stderr: 'ERROR: The process "43210" not found.' }),
    })).not.toThrow()

    expect(() => terminateProcessTree(43210, {
      platform: 'win32',
      runCommand: () => ({ status: 5, stderr: 'ERROR: Access is denied.' }),
    })).toThrow(/taskkill/i)
    expect(() => terminateProcessTree(43210, {
      platform: 'win32',
      runCommand: () => ({ error: new Error('spawn failed'), status: null }),
    })).toThrow(/spawn failed/i)
  })

  it('force-terminates the Windows tree before its leader can exit', () => {
    const terminate = vi.fn()
    const shutdown = createProcessTreeShutdown({
      platform: 'win32',
      processId: 43210,
      terminate,
    })

    shutdown.begin()
    shutdown.leaderExited()

    expect(terminate).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledWith(43210, {
      force: true,
      platform: 'win32',
    })
  })

  it('force-terminates a POSIX group when its leader exits before the timeout', () => {
    vi.useFakeTimers()
    const terminate = vi.fn()
    const shutdown = createProcessTreeShutdown({
      forceAfterMs: 5_000,
      platform: 'linux',
      processId: 43210,
      terminate,
    })

    shutdown.begin()
    shutdown.leaderExited()
    vi.advanceTimersByTime(5_000)

    expect(terminate.mock.calls).toEqual([
      [43210, { platform: 'linux' }],
      [43210, { force: true, platform: 'linux' }],
    ])
    vi.useRealTimers()
  })

  it('still forces POSIX cleanup when graceful termination fails', () => {
    const gracefulError = new Error('graceful termination failed')
    const onError = vi.fn()
    const terminate = vi.fn((_processId: number, options: { force?: boolean }) => {
      if (!options.force) throw gracefulError
    })
    const shutdown = createProcessTreeShutdown({
      onError,
      platform: 'darwin',
      processId: 43210,
      terminate,
    })

    shutdown.begin()

    expect(onError).toHaveBeenCalledWith(gracefulError)
    expect(terminate).toHaveBeenLastCalledWith(43210, {
      force: true,
      platform: 'darwin',
    })
  })

  it.each([
    ['win32', false, { force: true, platform: 'win32' }],
    ['linux', true, { platform: 'linux' }],
  ] as const)('targets a living anchor when the Vite leader exits on %s', (
    platform,
    detached,
    expectedTermination,
  ) => {
    // The launch seam only reads the child's pid, so a pid-only stub is enough.
    const anchor = { pid: 43210 } as unknown as ChildProcess
    const forkProcess = vi.fn(() => anchor)
    const terminate = vi.fn()
    const launched = launchSupervisedAnchor({
      environment: { FIXTURE: 'yes' },
      forkProcess,
      modulePath: '/fixture/supervised-anchor.ts',
      platform,
    })
    const lifecycle = createSupervisedLaunchLifecycle({
      cleanup: vi.fn(),
      processTreeShutdown: createProcessTreeShutdown({
        platform,
        processId: launched.pid!,
        terminate,
      }),
      setExitCode: vi.fn(),
    })

    lifecycle.leaderExited(7, null)

    expect(forkProcess).toHaveBeenCalledWith('/fixture/supervised-anchor.ts', [], {
      detached,
      env: { FIXTURE: 'yes' },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })
    expect(terminate).toHaveBeenCalledWith(43210, expectedTermination)
  })

  it('waits for process-group disappearance before cleanup and preserves the Vite exit status', async () => {
    const events: string[] = []
    let confirmExit!: () => void
    const lifecycle = createSupervisedLaunchLifecycle({
      cleanup: () => events.push('cleanup'),
      processTreeShutdown: {
        begin: () => events.push('terminate'),
        hasFailed: () => false,
        leaderExited: () => events.push('force-after-anchor-exit'),
        waitForExit: () => new Promise<boolean>((resolve) => {
          confirmExit = () => resolve(true)
        }),
      },
      setExitCode: (code) => events.push(`exit:${code}`),
    })

    lifecycle.leaderExited(7, null)
    expect(events).toEqual(['terminate'])

    const finalized = lifecycle.anchorExited()
    expect(events).toEqual(['terminate', 'force-after-anchor-exit'])

    confirmExit()
    await finalized
    expect(events).toEqual([
      'terminate',
      'force-after-anchor-exit',
      'cleanup',
      'exit:7',
    ])
  })

  it('probes a POSIX process group until every descendant disappears', async () => {
    const exited = Object.assign(new Error('missing process group'), { code: 'ESRCH' })
    const probe = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => { throw exited })
    const delay = vi.fn(async () => undefined)

    await waitForProcessGroupExit(43210, { attempts: 3, delay, probe })

    expect(probe.mock.calls).toEqual([[-43210], [-43210], [-43210]])
    expect(delay).toHaveBeenCalledTimes(2)
  })

  it('bounds POSIX process-group disappearance confirmation', async () => {
    const probe = vi.fn()
    const delay = vi.fn(async () => undefined)

    await expect(waitForProcessGroupExit(43210, {
      attempts: 2,
      delay,
      probe,
    })).rejects.toThrow(/did not exit/i)

    expect(probe.mock.calls).toEqual([[-43210], [-43210]])
    expect(delay).toHaveBeenCalledOnce()
  })

  it('accepts an unowned reused group only after the owned leader is gone', async () => {
    const permissionDenied = Object.assign(new Error('permission denied'), { code: 'EPERM' })
    const missing = Object.assign(new Error('missing leader'), { code: 'ESRCH' })
    const probe = vi.fn()
      .mockImplementationOnce(() => { throw permissionDenied })
      .mockImplementationOnce(() => { throw missing })

    await expect(waitForProcessGroupExit(43210, { probe })).resolves.toBeUndefined()
    expect(probe.mock.calls).toEqual([[-43210], [43210]])
  })

  it.each([
    ['graceful', (force: boolean) => !force],
    ['forced', (force: boolean) => force],
  ] as const)('keeps a %s termination failure sticky after Vite reports success', async (
    _failure,
    shouldFail,
  ) => {
    const cleanup = vi.fn()
    const setExitCode = vi.fn()
    const shutdown = createProcessTreeShutdown({
      platform: 'linux',
      processId: 43210,
      terminate: (_processId, options) => {
        if (shouldFail(Boolean(options.force))) throw new Error('termination failed')
      },
      waitForExit: async () => undefined,
    })
    const lifecycle = createSupervisedLaunchLifecycle({
      cleanup,
      processTreeShutdown: shutdown,
      setExitCode,
    })

    lifecycle.leaderExited(0, null)
    await lifecycle.anchorExited()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(setExitCode).toHaveBeenLastCalledWith(1)
  })

  it('preserves validation state and a failure status when group disappearance times out', async () => {
    const cleanup = vi.fn()
    const setExitCode = vi.fn()
    const onError = vi.fn()
    const waitFailure = new Error('process group did not exit')
    const shutdown = createProcessTreeShutdown({
      onError,
      platform: 'linux',
      processId: 43210,
      terminate: vi.fn(),
      waitForExit: async () => { throw waitFailure },
    })
    const lifecycle = createSupervisedLaunchLifecycle({
      cleanup,
      processTreeShutdown: shutdown,
      setExitCode,
    })

    lifecycle.leaderExited(0, null)
    await lifecycle.anchorExited()

    expect(onError).toHaveBeenCalledWith(waitFailure)
    expect(cleanup).not.toHaveBeenCalled()
    expect(setExitCode).toHaveBeenLastCalledWith(1)
  })

  it('preserves validation state when Windows taskkill cannot confirm tree removal', async () => {
    const cleanup = vi.fn()
    const setExitCode = vi.fn()
    const shutdown = createProcessTreeShutdown({
      platform: 'win32',
      processId: 43210,
      terminate: () => { throw new Error('taskkill failed') },
    })
    const lifecycle = createSupervisedLaunchLifecycle({
      cleanup,
      processTreeShutdown: shutdown,
      setExitCode,
    })

    lifecycle.leaderExited(0, null)
    await lifecycle.anchorExited()

    expect(cleanup).not.toHaveBeenCalled()
    expect(setExitCode).toHaveBeenLastCalledWith(1)
  })

  it.skipIf(process.platform === 'win32')('confirms a real process group is gone before cleanup', async () => {
    const child = spawn('sh', ['-c', 'sleep 30 & echo $!; wait'], {
      detached: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
    const [output] = await once(child.stdout!, 'data')
    const descendantPid = Number(String(output).trim())
    const closed = once(child, 'close')
    const cleanup = vi.fn(() => {
      expect(() => process.kill(-child.pid!, 0)).toThrow()
    })
    const setExitCode = vi.fn()
    const lifecycle = createSupervisedLaunchLifecycle({
      cleanup,
      processTreeShutdown: createProcessTreeShutdown({ processId: child.pid! }),
      setExitCode,
    })

    lifecycle.leaderExited(0, null)
    await closed
    await lifecycle.anchorExited()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(setExitCode).toHaveBeenLastCalledWith(0)
    await vi.waitFor(() => expect(() => process.kill(descendantPid, 0)).toThrow(), {
      timeout: 2_000,
    })
  })
})
