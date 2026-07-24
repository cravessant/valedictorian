import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {
  terminateProcessTree,
  waitForProcessGroupExit,
} from './supervised-launch'
import {
  isolatedValidationCommandMatrixTimeoutMs,
  isolatedValidationEvidenceReportTimeoutMs,
  isolatedValidationStructuredReadinessTimeoutMs,
} from './isolated-validation-command-timeouts'
import { waitForIsolatedValidationCondition } from './isolated-validation-wait'

interface CommandSession {
  readonly activeCommand: ActiveCommand
  readonly command: ChildProcess
  readonly evidenceDirectory: string
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly output: () => string
  readonly proxyProcessGroupId: number
}

interface SessionManifest {
  readonly artifacts: { readonly diagnosticsPath: string }
  readonly ports: { readonly api: number; readonly renderer: number }
  readonly urls: { readonly api: string; readonly renderer: string }
  readonly workspace: { readonly id: string; readonly path: string }
}

interface ActiveCommand {
  readonly command: ChildProcess
  evidenceDirectory?: string
  readonly proxyProcessGroupId: number
}

const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1_000)'], {
  detached: true,
  stdio: 'ignore',
})
if (!sentinel.pid) throw new Error('The unrelated sentinel did not start.')
sentinel.unref()
process.stdout.write(`Isolated validation matrix sentinel: ${String(sentinel.pid)}\n`)

const activeCommands = new Set<ActiveCommand>()
let matrixAborted = false
await executeMatrix()

async function executeMatrix() {
  let matrixFailed = false
  let matrixFailure: unknown
  try {
    await runMatrixWithinDeadline()
  } catch (error) {
    matrixFailed = true
    matrixFailure = error
  }
  const cleanupErrors: unknown[] = []
  if (matrixFailed) {
    matrixAborted = true
    try {
      await stopActiveCommands()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
  }
  try {
    await terminateAndReapProcessGroup(sentinel.pid!)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  if (matrixFailed && cleanupErrors.length > 0) {
    throw new AggregateError([matrixFailure, ...cleanupErrors])
  }
  if (matrixFailed) throw matrixFailure
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors)
  process.stdout.write('Isolated validation matrix complete\n')
}

async function runMatrix() {
  const normal = await startCommand([
    '--timeout-ms', '60000', '--test-close-after-ready', '--test-readiness-delay-ms', '750',
  ])
  const normalManifest = await readManifestWhenReady(normal)
  assert.deepEqual(await normal.exited, { code: 0, signal: null })
  await assertSessionStopped(normal, normalManifest)

  const [first, second] = await Promise.all([
    startCommand(['--timeout-ms', '60000']),
    startCommand(['--timeout-ms', '60000']),
  ])
  const [firstManifest, secondManifest] = await Promise.all([
    readManifestWhenReady(first),
    readManifestWhenReady(second),
  ])
  assert.notEqual(firstManifest.workspace.id, secondManifest.workspace.id)
  assert.notEqual(firstManifest.workspace.path, secondManifest.workspace.path)
  assert.notEqual(firstManifest.ports.api, secondManifest.ports.api)
  assert.notEqual(firstManifest.ports.renderer, secondManifest.ports.renderer)
  assert.notEqual(firstManifest.ports.api, firstManifest.ports.renderer)
  assert.notEqual(secondManifest.ports.api, secondManifest.ports.renderer)
  await Promise.all([connectWhenReady(firstManifest.urls.api), connectWhenReady(secondManifest.urls.api)])
  process.kill(readOwnership(first).orchestratorProcessId, 'SIGINT')
  process.kill(readOwnership(second).orchestratorProcessId, 'SIGTERM')
  assert.deepEqual(await first.exited, { code: 1, signal: null })
  assert.deepEqual(await second.exited, { code: 1, signal: null })
  await assertSessionStopped(first, firstManifest, { classification: 'interrupted', stage: 'signal' })
  await assertSessionStopped(second, secondManifest, { classification: 'interrupted', stage: 'signal' })

  await assertEarlyFailure(
    ['--timeout-ms', '1000', '--test-readiness-delay-ms', '10000'],
    { classification: 'timeout', stage: 'timeout' },
  )

  const childFailure = await startCommand(['--timeout-ms', '60000', '--test-failure', 'electron'])
  const childFailureManifest = await readManifestWhenReady(childFailure)
  assert.deepEqual(await childFailure.exited, { code: 1, signal: null })
  await assertSessionStopped(childFailure, childFailureManifest, {
    classification: 'child_failure', stage: 'child',
  })

  await assertEarlyFailure(['--test-failure', 'fixture'], { classification: 'setup_failure', stage: 'setup' })
  await assertEarlyFailure(['--test-failure', 'anchor'], { classification: 'anchor_failure', stage: 'anchor' })
  await assertEarlyFailure(
    ['--test-failure', 'premature_completion'],
    { classification: 'child_failure', stage: 'child' },
  )
  await assertEarlyFailure(['--not-a-real-option'], { classification: 'invalid_arguments', stage: 'arguments' })
}

async function startCommand(args: readonly string[]): Promise<CommandSession> {
  if (matrixAborted) throw new Error('The isolated validation matrix was aborted before starting another command.')
  const command = spawn(process.execPath, [path.resolve('scripts/isolated-validation.command-proxy.mjs'), ...args], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, VALEDICTORIAN_API_TOKEN: 'test-secret-must-not-escape' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!command.pid) throw new Error('The isolated validation command proxy did not start.')
  let output = ''
  command.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
  command.stderr?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
  const activeCommand: ActiveCommand = { command, proxyProcessGroupId: command.pid }
  activeCommands.add(activeCommand)
  const exited = once(command, 'exit').then(([code, signal]) => ({ code, signal }))
  const evidenceDirectory = await waitForEvidenceDirectory(() => output, command)
  activeCommand.evidenceDirectory = evidenceDirectory
  return {
    activeCommand,
    command,
    evidenceDirectory,
    exited,
    output: () => output,
    proxyProcessGroupId: command.pid,
  }
}

async function readManifestWhenReady(session: CommandSession) {
  const manifestPath = path.join(session.evidenceDirectory, 'session-manifest.json')
  await waitForCommandCondition(
    () => fs.existsSync(manifestPath),
    session.command,
    'the isolated validation manifest',
    isolatedValidationStructuredReadinessTimeoutMs,
  )
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SessionManifest
}

async function assertSessionStopped(
  session: CommandSession,
  manifest: SessionManifest,
  expectedDiagnostic?: { readonly classification: string; readonly stage: string },
) {
  const ownership = readOwnership(session)
  assert.notEqual(ownership.processGroupId, undefined)
  await waitForProcessGroupExit(ownership.processGroupId!, { attempts: 40, intervalMs: 50 })
  await waitForProcessGroupExit(session.proxyProcessGroupId, { attempts: 40, intervalMs: 50 })
  assert.equal(processIsGone(ownership.orchestratorProcessId), true)
  assert.equal(fs.existsSync(path.dirname(manifest.workspace.path)), false)
  assert.equal(fs.statSync(path.join(session.evidenceDirectory, 'session-manifest.json')).mode & 0o777, 0o600)
  if (expectedDiagnostic) {
    const diagnostic = JSON.parse(fs.readFileSync(manifest.artifacts.diagnosticsPath, 'utf8'))
    assert.deepEqual({ classification: diagnostic.classification, stage: diagnostic.stage }, expectedDiagnostic)
    assert.equal(JSON.stringify(diagnostic).includes('test-secret-must-not-escape'), false)
  }
  assertSentinelPreserved()
  activeCommands.delete(session.activeCommand)
}

async function assertEarlyFailure(
  args: readonly string[],
  expectedDiagnostic: { readonly classification: string; readonly stage: string },
) {
  const rootsBefore = isolatedRoots()
  const session = await startCommand(args)
  assert.deepEqual(await session.exited, { code: 1, signal: null })
  const diagnosticsPath = path.join(session.evidenceDirectory, 'diagnostics.json')
  await waitForIsolatedValidationCondition(() => fs.existsSync(diagnosticsPath), {
    description: 'the isolated validation diagnostics',
    timeoutMs: isolatedValidationEvidenceReportTimeoutMs,
  })
  const diagnostic = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf8'))
  assert.equal(fs.existsSync(path.join(session.evidenceDirectory, 'session-manifest.json')), false)
  assert.deepEqual({ classification: diagnostic.classification, stage: diagnostic.stage }, expectedDiagnostic)
  assert.equal(JSON.stringify(diagnostic).includes('test-secret-must-not-escape'), false)
  await waitForIsolatedValidationCondition(() => sameEntries(isolatedRoots(), rootsBefore), {
    description: 'isolated validation temporary-root cleanup',
    timeoutMs: isolatedValidationEvidenceReportTimeoutMs,
  })
  await waitForProcessGroupExit(session.proxyProcessGroupId, { attempts: 40, intervalMs: 50 })
  const ownership = readOwnership(session)
  if (ownership.processGroupId !== undefined) {
    await waitForProcessGroupExit(ownership.processGroupId, { attempts: 40, intervalMs: 50 })
  }
  assertSentinelPreserved()
  activeCommands.delete(session.activeCommand)
}

function connect(url: string) {
  const endpoint = new URL(url)
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect(Number(endpoint.port), endpoint.hostname)
    socket.once('connect', () => {
      socket.end()
      resolve()
    })
    socket.once('error', reject)
  })
}

async function connectWhenReady(url: string) {
  let lastError: unknown
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      await connect(url)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw lastError ?? new Error(`The isolated API did not accept a loopback connection: ${url}`)
}

function readOwnership(session: CommandSession) {
  return JSON.parse(
    fs.readFileSync(path.join(session.evidenceDirectory, 'owned-process.json'), 'utf8'),
  ) as { orchestratorProcessId: number; processGroupId?: number }
}

function assertSentinelPreserved() {
  assert.notEqual(sentinel.pid, undefined)
  assert.equal(processIsGone(sentinel.pid!), false)
}

function processIsGone(processId: number) {
  try {
    process.kill(processId, 0)
    return false
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
  }
}

function isolatedRoots() {
  return fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('valedictorian-isolated-validation-')).sort()
}

function sameEntries(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function waitForEvidenceDirectory(readOutput: () => string, command: ChildProcess) {
  let evidenceDirectory: string | null = null
  await waitForCommandCondition(() => {
    evidenceDirectory = readOutput().match(/^Isolated validation evidence: (.+)$/m)?.[1] ?? null
    return evidenceDirectory !== null
  }, command, 'the isolated validation evidence report', isolatedValidationEvidenceReportTimeoutMs)
  if (!evidenceDirectory) throw new Error('The isolated validation command did not report an evidence directory.')
  return evidenceDirectory
}

async function runMatrixWithinDeadline() {
  let rejectInterrupted: ((error: Error) => void) | undefined
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = reject
  })
  const interrupt = (signal: NodeJS.Signals) => {
    rejectInterrupted?.(new Error(`The isolated validation matrix received ${signal}.`))
  }
  const onSigint = () => interrupt('SIGINT')
  const onSigterm = () => interrupt('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  const running = runMatrix()
  void running.catch(() => undefined)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('The isolated validation command matrix exceeded its aggregate deadline.'))
    }, isolatedValidationCommandMatrixTimeoutMs)
    timeout.unref()
  })
  try {
    await Promise.race([running, deadline, interrupted])
  } finally {
    if (timeout) clearTimeout(timeout)
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

async function stopActiveCommands() {
  const commands = [...activeCommands]
  await Promise.all(commands.map((command) => stopActiveCommand(command)))
}

async function stopActiveCommand(command: ActiveCommand) {
  const processGroupIds = new Set<number>([command.proxyProcessGroupId])
  if (command.evidenceDirectory) {
    const ownership = readOwnershipIfAvailable(command.evidenceDirectory)
    if (ownership?.processGroupId !== undefined) processGroupIds.add(ownership.processGroupId)
  }
  for (const processGroupId of processGroupIds) {
    if (processGroupId === sentinel.pid) continue
    await terminateAndReapProcessGroup(processGroupId)
  }
}

async function terminateAndReapProcessGroup(processGroupId: number) {
  try {
    terminateProcessTree(processGroupId)
  } catch {
    // A concurrently completed process group needs no further signal.
  }
  try {
    await waitForProcessGroupExit(processGroupId, { attempts: 40, intervalMs: 50 })
    return
  } catch {
    terminateProcessTree(processGroupId, { force: true })
    await waitForProcessGroupExit(processGroupId, { attempts: 40, intervalMs: 50 })
  }
}

function readOwnershipIfAvailable(evidenceDirectory: string) {
  try {
    return JSON.parse(fs.readFileSync(path.join(evidenceDirectory, 'owned-process.json'), 'utf8')) as {
      processGroupId?: number
    }
  } catch {
    return undefined
  }
}

async function waitForCommandCondition(
  predicate: () => boolean,
  command: ChildProcess,
  description: string,
  timeoutMs: number,
) {
  await waitForIsolatedValidationCondition(() => {
    if (predicate()) return true
    if (command.exitCode !== null || command.signalCode !== null) {
      const outcome = command.signalCode ?? `exit code ${String(command.exitCode)}`
      throw new Error(`The isolated validation command ended before ${description} (${outcome}).`)
    }
    return false
  }, { description, timeoutMs })
}
