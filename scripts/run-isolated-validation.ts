import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isolatedValidationFixture } from '../src/runtime/isolated-validation.fixture-contract'
import { seedIsolatedValidationFixture } from '../src/runtime/isolated-validation.fixture'
import {
  createIsolatedValidationEvidenceDirectory,
  isolatedValidationManifestSchema,
  writeIsolatedValidationDiagnostic,
  writeIsolatedValidationOwnershipEvidence,
  type IsolatedValidationDiagnostic,
} from '../src/runtime/isolated-validation'
import { getDefaultWorkspaceRegistryPath } from '../src/workspace/workspace.paths'
import { createFileWorkspaceRegistryStore } from '../src/workspace/workspace.registry'
import { initializeWorkspace } from '../src/workspace/workspace.initializer'
import {
  createProcessTreeShutdown,
  createSupervisedLaunchLifecycle,
  isSupervisedLeaderExitMessage,
  launchSupervisedAnchor,
} from './supervised-launch'
import { readIsolatedValidationBuildIdentity } from './isolated-validation-build-identity'

class ValidationFailure extends Error {
  constructor(
    readonly classification: IsolatedValidationDiagnostic['classification'],
    readonly stage: IsolatedValidationDiagnostic['stage'],
    message: string,
  ) {
    super(message)
  }
}

const sessionId = `validation-${crypto.randomBytes(12).toString('hex')}`
const workspaceId = `isolated-validation-${crypto.randomBytes(12).toString('hex')}`
let evidenceDirectory = ''
let temporaryRoot = ''
let cleanupFinished = false
let diagnostic: Omit<IsolatedValidationDiagnostic, 'exitCode' | 'schemaVersion'> | null = null
let diagnosticExitCode: number | undefined
let diagnosticPersisted = false
let diagnosticPersistenceFailed = false

try {
  throwTestFailure('evidence')
  evidenceDirectory = createIsolatedValidationEvidenceDirectory(os.tmpdir())
} catch (error) {
  reportUnpersistedFailure('The isolated validation evidence directory could not be created.', error)
  process.exitCode = 1
}

if (evidenceDirectory) {
  try {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-isolated-validation-'))
    process.stdout.write(`Isolated validation evidence: ${evidenceDirectory}\n`)
    throwTestFailure('ownership')
    writeIsolatedValidationOwnershipEvidence(evidenceDirectory, { orchestratorProcessId: process.pid })
    const options = readOptions(process.argv.slice(2))
    const environment = await prepareEnvironment(options)
    if (options.failure === 'setup') {
      throw new ValidationFailure('setup_failure', 'setup', 'The isolated fixture setup was intentionally failed.')
    }
    const anchor = launchSupervisedAnchor({
      environment,
      ...(options.failure === 'anchor'
        ? { modulePath: path.resolve('scripts/supervised-anchor.failure.ts') }
        : options.failure === 'premature_completion'
          ? { modulePath: path.resolve('scripts/supervised-anchor.premature-completion.ts') }
        : {}),
    })
    if (!anchor.pid) throw new ValidationFailure('anchor_failure', 'anchor', 'The supervised validation anchor did not start.')
    if (options.failure !== 'anchor') {
      writeIsolatedValidationOwnershipEvidence(evidenceDirectory, {
        orchestratorProcessId: process.pid,
        processGroupId: anchor.pid,
      })
    }
    let leaderReported = false
    const lifecycle = createSupervisedLaunchLifecycle({
      cleanup: finishCleanup,
      processTreeShutdown: createProcessTreeShutdown({
        onError() {
          fail('process_tree_error', 'process_tree', 'The owned validation process tree could not be stopped.')
        },
        processId: anchor.pid,
      }),
      setExitCode(code) {
        process.exitCode = code
      },
    })
    let terminalCompletion = false
    const timeout = setTimeout(() => {
      fail('timeout', 'timeout', `The isolated validation session exceeded ${String(options.timeoutMs)} ms.`)
      lifecycle.shutdown()
    }, options.timeoutMs)
    timeout.unref()
    const interrupt = (signal: NodeJS.Signals) => {
      fail('interrupted', 'signal', `The isolated validation session received ${signal}.`)
      lifecycle.shutdown()
    }
    process.once('SIGINT', () => interrupt('SIGINT'))
    process.once('SIGTERM', () => interrupt('SIGTERM'))
    anchor.on('message', (message) => {
      if (!isSupervisedLeaderExitMessage(message)) return
      leaderReported = true
      terminalCompletion = message.code === 0 && !message.signal && hasCompletedTerminalState()
      const exitCode = terminalCompletion
        ? 0
        : message.code && message.code > 0 ? message.code : 1
      if (!terminalCompletion) {
        fail('child_failure', 'child', 'The Vite or Electron validation child exited before completing readiness.', exitCode)
      }
      lifecycle.leaderExited(exitCode, message.signal, terminalCompletion)
    })
    anchor.once('error', (error) => {
      fail('anchor_failure', 'anchor', diagnosticMessage('The supervised validation anchor could not be started.', error))
      lifecycle.shutdown()
      void lifecycle.anchorExited()
    })
    anchor.once('exit', () => {
      clearTimeout(timeout)
      if (!leaderReported && !diagnostic) {
        fail('anchor_failure', 'anchor', 'The supervised validation anchor exited before launching Vite.')
      }
      if (options.failure === 'anchor') {
        finishCleanup()
        return
      }
      void lifecycle.anchorExited(terminalCompletion).catch(() => {
        fail('process_tree_error', 'process_tree', 'The owned validation process tree did not exit cleanly.')
      })
    })
  } catch (error) {
    const failure = error instanceof ValidationFailure
      ? error
      : new ValidationFailure(
        'setup_failure',
        'setup',
        diagnosticMessage('The isolated validation setup could not be completed.', error),
      )
    fail(failure.classification, failure.stage, failure.message)
    finishCleanup()
  }
}

async function prepareEnvironment(options: ValidationOptions) {
  const root = requireTemporaryRoot()
  const workspacePath = path.join(root, `workspace-${sessionId}`)
  const userDataPath = path.join(root, `user-data-${sessionId}`)
  const workspace = initializeWorkspace(workspacePath, {
    createId: () => workspaceId,
    now: new Date(isolatedValidationFixture.timestamp),
  })
  if (workspace.id !== workspaceId) {
    throw new ValidationFailure('setup_failure', 'setup', 'The isolated workspace identity was not created.')
  }
  await createFileWorkspaceRegistryStore(getDefaultWorkspaceRegistryPath(userDataPath)).markOpened({
    id: workspace.id, name: workspace.name, path: workspace.rootPath,
  }, new Date(isolatedValidationFixture.timestamp))
  if (options.failure === 'fixture') {
    throw new ValidationFailure('setup_failure', 'setup', 'The isolated fixture seed was intentionally failed.')
  }
  await seedIsolatedValidationFixture({
    pgliteDataPath: workspace.pgliteDataPath,
    profilePath: workspace.profilePath,
    workspaceId: workspace.id,
  })
  const build = readIsolatedValidationBuildIdentity()
  const environment = scrubbedEnvironment(process.env)
  return {
    ...environment,
    VALEDICTORIAN_API_HOST: '127.0.0.1',
    VALEDICTORIAN_API_PORT: '0',
    VALEDICTORIAN_ISOLATED_VALIDATION: '1',
    VALEDICTORIAN_ISOLATED_VALIDATION_BRANCH: build.branch,
    VALEDICTORIAN_ISOLATED_VALIDATION_COMMIT: build.commit,
    VALEDICTORIAN_ISOLATED_VALIDATION_EVIDENCE_PATH: evidenceDirectory,
    VALEDICTORIAN_ISOLATED_VALIDATION_RENDERER_PORT: '0',
    VALEDICTORIAN_ISOLATED_VALIDATION_SESSION_ID: sessionId,
    VALEDICTORIAN_ISOLATED_VALIDATION_WORKTREE_FINGERPRINT: build.fingerprint,
    VALEDICTORIAN_ISOLATED_VALIDATION_WORKTREE_STATE: build.state,
    ...(options.closeAfterReady ? { VALEDICTORIAN_ISOLATED_VALIDATION_CLOSE_AFTER_READY: '1' } : {}),
    ...(options.failure === 'electron' ? { VALEDICTORIAN_ISOLATED_VALIDATION_FAIL_ELECTRON: '1' } : {}),
    ...(options.readinessDelayMs === 0
      ? {}
      : { VALEDICTORIAN_ISOLATED_VALIDATION_READINESS_DELAY_MS: String(options.readinessDelayMs) }),
    VALEDICTORIAN_MODE: 'local-desktop',
    VALEDICTORIAN_SEED_DATA: 'none',
    VALEDICTORIAN_USER_DATA_PATH: userDataPath,
    VITE_VALEDICTORIAN_BUILD_IDENTITY: `validation ${build.branch}@${build.commit} ${build.state}`,
  }
}

function finishCleanup() {
  if (cleanupFinished) return
  cleanupFinished = true
  try {
    persistDiagnostic()
  } finally {
    if (temporaryRoot) removeOwnedTemporaryRoot(temporaryRoot)
  }
}

function fail(
  classification: IsolatedValidationDiagnostic['classification'],
  stage: IsolatedValidationDiagnostic['stage'],
  message: string,
  exitCode = 1,
) {
  if (!diagnostic) diagnostic = { classification, message, stage }
  diagnosticExitCode ??= exitCode
  persistDiagnostic()
  process.exitCode = 1
}

function persistDiagnostic() {
  if (!diagnostic || diagnosticPersisted || diagnosticPersistenceFailed || !evidenceDirectory) return
  try {
    writeIsolatedValidationDiagnostic(evidenceDirectory, {
      ...diagnostic,
      ...(diagnosticExitCode === undefined ? {} : { exitCode: diagnosticExitCode }),
    })
    diagnosticPersisted = true
  } catch (error) {
    diagnosticPersistenceFailed = true
    reportUnpersistedFailure('The isolated validation diagnostic could not be persisted.', error, diagnostic.message)
  }
}

function scrubbedEnvironment(environment: NodeJS.ProcessEnv) {
  const clean = { ...environment }
  for (const name of Object.keys(clean)) {
    if (/(?:api[_-]?key|password|secret|token)/i.test(name)) delete clean[name]
    if (name.startsWith('VALEDICTORIAN_')) delete clean[name]
  }
  delete clean.ELECTRON_RUN_AS_NODE
  return clean
}

function removeOwnedTemporaryRoot(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath)
  if (
    path.dirname(resolvedRoot) !== path.resolve(os.tmpdir())
    || !path.basename(resolvedRoot).startsWith('valedictorian-isolated-validation-')
  ) {
    throw new Error('Refusing to remove a non-validation directory.')
  }
  fs.rmSync(resolvedRoot, { force: true, recursive: true })
}

function requireTemporaryRoot() {
  if (!temporaryRoot) throw new Error('The isolated validation temporary root is unavailable.')
  return temporaryRoot
}

function readOptions(args: readonly string[]): ValidationOptions {
  let timeoutMs = 900_000
  let closeAfterReady = false
  let failure: ValidationOptions['failure']
  let readinessDelayMs = 0
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      continue
    } else if (argument === '--timeout-ms') {
      timeoutMs = readBoundedInteger(args[++index], '--timeout-ms', 1_000, 3_600_000)
    } else if (argument === '--test-close-after-ready') {
      closeAfterReady = true
    } else if (argument === '--test-failure') {
      const value = args[++index]
      if (
        value !== 'anchor'
        && value !== 'electron'
        && value !== 'fixture'
        && value !== 'premature_completion'
        && value !== 'setup'
      ) {
        throw new ValidationFailure('invalid_arguments', 'arguments', 'The test failure mode is invalid.')
      }
      failure = value
    } else if (argument === '--test-readiness-delay-ms') {
      readinessDelayMs = readBoundedInteger(args[++index], '--test-readiness-delay-ms', 1, 10_000)
    } else {
      throw new ValidationFailure('invalid_arguments', 'arguments', 'The isolated validation arguments are invalid.')
    }
  }
  return { closeAfterReady, failure, readinessDelayMs, timeoutMs }
}

function readBoundedInteger(value: string | undefined, name: string, minimum: number, maximum: number) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ValidationFailure('invalid_arguments', 'arguments', `${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`)
  }
  return number
}

function hasCompletedTerminalState() {
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(evidenceDirectory, 'terminal-state.json'), 'utf8'),
    ) as { outcome?: unknown }
    if (state.outcome !== 'completed') return false
    const manifest = isolatedValidationManifestSchema.parse(JSON.parse(
      fs.readFileSync(path.join(evidenceDirectory, 'session-manifest.json'), 'utf8'),
    ))
    return manifest.run.id === sessionId
  } catch {
    return false
  }
}

function diagnosticMessage(prefix: string, error: unknown) {
  if (!(error instanceof Error)) return prefix
  const name = error.name.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'Error'
  const message = sanitizeFailureText(error.message).slice(0, 160)
  return message ? `${prefix} ${name}: ${message}` : `${prefix} ${name}.`
}

function throwTestFailure(stage: 'evidence' | 'ownership') {
  if (process.env.VALEDICTORIAN_ISOLATED_VALIDATION_TEST_FAILURE !== stage) return
  const secret = process.env.VALEDICTORIAN_ISOLATED_VALIDATION_TEST_SECRET ?? 'test-secret'
  throw new Error(`The validation ${stage} setup was intentionally failed with token=${secret}.`)
}

function reportUnpersistedFailure(prefix: string, error: unknown, message = '') {
  const detail = error instanceof Error
    ? `${error.name.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'Error'}: ${error.message}`
    : ''
  const value = sanitizeFailureText(`${prefix} ${message} ${detail}`).slice(0, 240)
  try {
    process.stderr.write(`Isolated validation failure: ${value}\n`)
  } catch {
    // Reporting cannot prevent cleanup.
  }
}

function sanitizeFailureText(value: string) {
  return value
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/(?:api[_-]?key|password|secret|token)\s+[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
}

interface ValidationOptions {
  readonly closeAfterReady: boolean
  readonly failure?: 'anchor' | 'electron' | 'fixture' | 'premature_completion' | 'setup'
  readonly readinessDelayMs: number
  readonly timeoutMs: number
}
