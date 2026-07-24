import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterAll, describe, expect, it } from 'vitest'
import {
  terminateProcessTree,
  waitForProcessGroupExit,
} from './supervised-launch'
import {
  isolatedValidationCommandMatrixTestTimeoutMs,
  isolatedValidationCommandMatrixTimeoutMs,
  isolatedValidationMatrixTeardownMarginMs,
} from './isolated-validation-command-timeouts'
import { isolatedValidationMatrixLaunch } from './isolated-validation-matrix-launch'

const receivedSignals: NodeJS.Signals[] = []
const recordSignal = (signal: NodeJS.Signals) => receivedSignals.push(signal)
process.on('SIGINT', recordSignal)
process.on('SIGTERM', recordSignal)

afterAll(() => {
  process.off('SIGINT', recordSignal)
  process.off('SIGTERM', recordSignal)
})

describe.skipIf(process.platform === 'win32')('isolated validation public command lifecycle', () => {
  it('runs the public-command matrix in a reaped detached proof session', async () => {
    const launch = isolatedValidationMatrixLaunch()
    const matrix = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (!matrix.pid) throw new Error('The isolated validation proof driver did not start.')
    let output = ''
    matrix.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
    matrix.stderr?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
    try {
      const [code, signal] = await waitForMatrixExit(matrix)

      expect({ code, signal }, output).toEqual({ code: 0, signal: null })
      await expect(waitForProcessGroupExit(matrix.pid, processGroupTeardownWaitOptions))
        .resolves.toBeUndefined()
    } finally {
      await terminateAndReapMatrix(matrix)
      await terminateAndReapSentinel(output)
    }
    expect(receivedSignals).toEqual([])
  }, isolatedValidationCommandMatrixTestTimeoutMs)
})

const processGroupTeardownWaitOptions = {
  attempts: isolatedValidationMatrixTeardownMarginMs / 50,
  intervalMs: 50,
}

async function waitForMatrixExit(matrix: ReturnType<typeof spawn>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('The isolated validation matrix exceeded its aggregate deadline.'))
    }, isolatedValidationCommandMatrixTimeoutMs)
    timeout.unref()
  })
  try {
    return await Promise.race([once(matrix, 'exit'), deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function terminateAndReapMatrix(matrix: ReturnType<typeof spawn>) {
  if (matrix.exitCode !== null || matrix.signalCode !== null) return
  terminateProcessTree(matrix.pid!)
  try {
    await waitForProcessGroupExit(matrix.pid!, processGroupTeardownWaitOptions)
  } catch {
    terminateProcessTree(matrix.pid!, { force: true })
    await waitForProcessGroupExit(matrix.pid!, processGroupTeardownWaitOptions)
  }
}

async function terminateAndReapSentinel(output: string) {
  const sentinelProcessId = Number(output.match(/^Isolated validation matrix sentinel: (\d+)$/m)?.[1])
  if (!Number.isSafeInteger(sentinelProcessId) || sentinelProcessId <= 1) return
  try {
    process.kill(sentinelProcessId, 'SIGTERM')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code !== 'ESRCH') throw error
  }
  await waitForProcessGroupExit(sentinelProcessId, processGroupTeardownWaitOptions)
}
