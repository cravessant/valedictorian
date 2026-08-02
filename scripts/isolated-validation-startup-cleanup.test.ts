import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const temporaryRootPrefix = 'valedictorian-isolated-validation-'
const testSecret = 'startup-cleanup-secret-7e6d'

describe.skipIf(process.platform === 'win32')('isolated validation startup cleanup', () => {
  it('does not acquire a disposable root when evidence setup fails', async () => {
    const temporaryDirectory = createTestTemporaryDirectory()
    const rootsBefore = isolatedRoots(temporaryDirectory)
    const sentinel = startSentinel()
    try {
      const result = await runValidationWithFailure('evidence', temporaryDirectory)

      expect(result.exit).toEqual({ code: 1, signal: null })
      expect(isolatedRoots(temporaryDirectory)).toEqual(rootsBefore)
      expect(processIsRunning(sentinel.pid!)).toBe(true)
      expect(result.output).not.toContain(testSecret)
      expect(failureLine(result.output)).toHaveLength(1)
      expect(failureLine(result.output)[0].length).toBeLessThanOrEqual(300)
      expect(result.output).not.toContain('Isolated validation evidence:')
    } finally {
      await stopSentinel(sentinel)
      fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it('removes its root and retains sanitized diagnostics when ownership evidence fails', async () => {
    const temporaryDirectory = createTestTemporaryDirectory()
    const rootsBefore = isolatedRoots(temporaryDirectory)
    const sentinel = startSentinel()
    try {
      const result = await runValidationWithFailure('ownership', temporaryDirectory)
      const evidenceDirectory = result.output.match(/^Isolated validation evidence: (.+)$/m)?.[1]

      expect(result.exit).toEqual({ code: 1, signal: null })
      expect(evidenceDirectory).toBeTruthy()
      expect(isolatedRoots(temporaryDirectory)).toEqual(rootsBefore)
      expect(processIsRunning(sentinel.pid!)).toBe(true)
      expect(result.output).not.toContain(testSecret)
      const diagnostics = fs.readFileSync(path.join(evidenceDirectory!, 'diagnostics.json'), 'utf8')
      expect(diagnostics).not.toContain(testSecret)
      expect(JSON.parse(diagnostics)).toMatchObject({ classification: 'setup_failure', stage: 'setup' })
      fs.rmSync(evidenceDirectory!, { force: true, recursive: true })
    } finally {
      await stopSentinel(sentinel)
      fs.rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })
})

function runValidationWithFailure(stage: 'evidence' | 'ownership', temporaryDirectory: string) {
  const validation = spawn(process.execPath, ['--import', 'tsx', 'scripts/run-isolated-validation.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TMPDIR: temporaryDirectory,
      VALEDICTORIAN_ISOLATED_VALIDATION_TEST_FAILURE: stage,
      VALEDICTORIAN_ISOLATED_VALIDATION_TEST_SECRET: testSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  validation.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-8_192) })
  validation.stderr?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-8_192) })
  return once(validation, 'close').then(([code, signal]) => ({
    exit: { code, signal },
    output,
  }))
}

function startSentinel() {
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1_000)'], {
    detached: true,
    stdio: 'ignore',
  })
  if (!sentinel.pid) throw new Error('The unrelated startup-cleanup sentinel did not start.')
  sentinel.unref()
  return sentinel
}

async function stopSentinel(sentinel: ChildProcess) {
  if (!sentinel.pid || !processIsRunning(sentinel.pid)) return
  const exited = once(sentinel, 'exit')
  process.kill(sentinel.pid, 'SIGTERM')
  await exited
}

function createTestTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-startup-cleanup-'))
}

function isolatedRoots(temporaryDirectory: string) {
  return fs.readdirSync(temporaryDirectory).filter((entry) => entry.startsWith(temporaryRootPrefix)).sort()
}

function processIsRunning(processId: number) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')
  }
}

function failureLine(output: string) {
  return output.split('\n').filter((line) => line.startsWith('Isolated validation failure:'))
}
