import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { writeAtomicDocument } from '../protected-secrets.js'

const manifestSchemaVersion = 'valedictorian-isolated-validation@1'
const sessionIdPattern = /^validation-[a-z0-9]{12,64}$/
const buildValuePattern = /^[A-Za-z0-9._/-]{1,128}$/
const commitPattern = /^(?:[0-9a-f]{7,64}|unknown)$/
const fixtureIdPattern = /^[A-Za-z0-9._:@-]{1,128}$/
const fingerprintPattern = /^sha256:[0-9a-f]{64}$/
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost'])

const loopbackUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'http:' && loopbackHosts.has(url.hostname)
}, 'must be a loopback HTTP URL')

export const isolatedValidationManifestSchema = z.object({
  schemaVersion: z.literal(manifestSchemaVersion),
  run: z.object({
    id: z.string().regex(sessionIdPattern),
    mode: z.literal('isolated-validation'),
  }).strict(),
  build: z.object({
    branch: z.string().regex(buildValuePattern),
    commit: z.string().regex(commitPattern),
    worktree: z.discriminatedUnion('state', [
      z.object({ state: z.literal('clean') }).strict(),
      z.object({
        fingerprint: z.string().regex(fingerprintPattern),
        state: z.literal('dirty'),
      }).strict(),
    ]),
  }).strict(),
  workspace: z.object({
    id: z.string().regex(fixtureIdPattern),
    path: z.string().min(1).max(4_096),
  }).strict(),
  ports: z.object({
    api: z.number().int().min(1).max(65_535),
    renderer: z.number().int().min(1).max(65_535),
  }).strict(),
  urls: z.object({
    api: loopbackUrlSchema,
    renderer: loopbackUrlSchema,
  }).strict(),
  fixture: z.object({
    captureId: z.string().regex(fixtureIdPattern),
    companyId: z.string().regex(fixtureIdPattern),
    timestamp: z.string().datetime({ offset: true }),
    version: z.string().regex(fixtureIdPattern),
    expectedObservables: z.object({
      companyCount: z.literal(1),
      unresolvedCaptureCount: z.literal(1),
    }).strict(),
  }).strict(),
  artifacts: z.object({
    diagnosticsPath: z.string().min(1).max(4_096),
    evidenceDirectory: z.string().min(1).max(4_096),
    manifestPath: z.string().min(1).max(4_096),
  }).strict(),
}).strict()

export type IsolatedValidationManifest = z.infer<typeof isolatedValidationManifestSchema>

export interface IsolatedValidationEnvironment {
  readonly branch: string
  readonly commit: string
  readonly evidenceDirectory: string
  readonly sessionId: string
  readonly worktree: { readonly state: 'clean' } | {
    readonly fingerprint: string
    readonly state: 'dirty'
  }
}

export function readIsolatedValidationEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): IsolatedValidationEnvironment | null {
  if (environment.VALEDICTORIAN_ISOLATED_VALIDATION !== '1') return null
  const branch = environment.VALEDICTORIAN_ISOLATED_VALIDATION_BRANCH
  const commit = environment.VALEDICTORIAN_ISOLATED_VALIDATION_COMMIT
  const evidenceDirectory = environment.VALEDICTORIAN_ISOLATED_VALIDATION_EVIDENCE_PATH
  const sessionId = environment.VALEDICTORIAN_ISOLATED_VALIDATION_SESSION_ID
  const worktreeState = environment.VALEDICTORIAN_ISOLATED_VALIDATION_WORKTREE_STATE
  const worktreeFingerprint = environment.VALEDICTORIAN_ISOLATED_VALIDATION_WORKTREE_FINGERPRINT
  if (!branch || !commit || !evidenceDirectory || !sessionId || !worktreeState) {
    throw new Error('Incomplete isolated validation environment.')
  }
  if (!buildValuePattern.test(branch) || !commitPattern.test(commit) || !sessionIdPattern.test(sessionId)) {
    throw new Error('Invalid isolated validation environment.')
  }
  if (worktreeState === 'clean' && !worktreeFingerprint) {
    return {
      branch,
      commit,
      evidenceDirectory: path.resolve(evidenceDirectory),
      sessionId,
      worktree: { state: 'clean' },
    }
  }
  if (worktreeState === 'dirty' && worktreeFingerprint && fingerprintPattern.test(worktreeFingerprint)) {
    return {
      branch,
      commit,
      evidenceDirectory: path.resolve(evidenceDirectory),
      sessionId,
      worktree: { fingerprint: worktreeFingerprint, state: 'dirty' },
    }
  }
  throw new Error('Invalid isolated validation worktree identity.')
}

export function writeIsolatedValidationManifest(manifest: IsolatedValidationManifest) {
  const parsed = isolatedValidationManifestSchema.parse(manifest)
  writeAtomicDocument(parsed.artifacts.manifestPath, `${JSON.stringify(parsed, null, 2)}\n`)
  return parsed
}

export function publishIsolatedValidationReadiness({
  apiUrl,
  rendererUrl,
  workspace,
  fixture,
  environment = process.env,
}: {
  readonly apiUrl: string
  readonly rendererUrl: string
  readonly workspace: { readonly id: string; readonly path: string }
  readonly fixture: {
    readonly captureId: string
    readonly companyId: string
    readonly timestamp: string
    readonly version: string
  }
  readonly environment?: NodeJS.ProcessEnv
}): IsolatedValidationManifest | null {
  const session = readIsolatedValidationEnvironment(environment)
  if (!session) return null
  const api = new URL(apiUrl)
  const renderer = new URL(rendererUrl)
  loopbackUrlSchema.parse(api.toString())
  loopbackUrlSchema.parse(renderer.toString())
  const apiPort = portFromUrl(api)
  const rendererPort = portFromUrl(renderer)
  const manifestPath = path.join(session.evidenceDirectory, 'session-manifest.json')
  const diagnosticsPath = path.join(session.evidenceDirectory, 'diagnostics.json')
  return writeIsolatedValidationManifest({
    schemaVersion: manifestSchemaVersion,
    run: { id: session.sessionId, mode: 'isolated-validation' },
    build: { branch: session.branch, commit: session.commit, worktree: session.worktree },
    workspace: { id: workspace.id, path: workspace.path },
    ports: { api: apiPort, renderer: rendererPort },
    urls: { api: api.toString(), renderer: renderer.toString() },
    fixture: {
      captureId: fixture.captureId,
      companyId: fixture.companyId,
      timestamp: fixture.timestamp,
      version: fixture.version,
      expectedObservables: { companyCount: 1, unresolvedCaptureCount: 1 },
    },
    artifacts: {
      diagnosticsPath,
      evidenceDirectory: session.evidenceDirectory,
      manifestPath,
    },
  })
}

const isolatedValidationDiagnosticSchema = z.object({
  classification: z.enum([
    'anchor_failure',
    'child_failure',
    'invalid_arguments',
    'interrupted',
    'process_tree_error',
    'setup_failure',
    'timeout',
  ]),
  exitCode: z.number().int().min(1).max(255),
  message: z.string().min(1).max(240),
  schemaVersion: z.literal('valedictorian-isolated-validation-diagnostic@1'),
  stage: z.enum(['anchor', 'arguments', 'child', 'process_tree', 'setup', 'signal', 'timeout']),
}).strict()

export type IsolatedValidationDiagnostic = z.infer<typeof isolatedValidationDiagnosticSchema>

export function writeIsolatedValidationDiagnostic(
  evidenceDirectory: string,
  input: {
    readonly classification: IsolatedValidationDiagnostic['classification']
    readonly exitCode?: number
    readonly message: string
    readonly stage: IsolatedValidationDiagnostic['stage']
  },
) {
  const diagnosticsPath = path.join(evidenceDirectory, 'diagnostics.json')
  const diagnostic = isolatedValidationDiagnosticSchema.parse({
    classification: input.classification,
    schemaVersion: 'valedictorian-isolated-validation-diagnostic@1',
    exitCode: input.exitCode ?? 1,
    message: sanitizeDiagnosticMessage(input.message),
    stage: input.stage,
  })
  writeAtomicDocument(diagnosticsPath, `${JSON.stringify(diagnostic, null, 2)}\n`)
  return diagnosticsPath
}

export function writeIsolatedValidationTerminalState(
  outcome: 'completed' | 'child_failure',
  environment: NodeJS.ProcessEnv = process.env,
) {
  const session = readIsolatedValidationEnvironment(environment)
  if (!session) return null
  const terminalStatePath = path.join(session.evidenceDirectory, 'terminal-state.json')
  writeAtomicDocument(terminalStatePath, `${JSON.stringify({
    outcome,
    schemaVersion: 'valedictorian-isolated-validation-terminal-state@1',
    sessionId: session.sessionId,
  }, null, 2)}\n`)
  return terminalStatePath
}

export function writeIsolatedValidationOwnershipEvidence(
  evidenceDirectory: string,
  ownership: { readonly orchestratorProcessId: number; readonly processGroupId?: number },
) {
  if (!Number.isSafeInteger(ownership.orchestratorProcessId) || ownership.orchestratorProcessId < 2) {
    throw new Error('Isolated validation ownership evidence requires an orchestrator process id.')
  }
  if (ownership.processGroupId !== undefined && (
    !Number.isSafeInteger(ownership.processGroupId) || ownership.processGroupId < 2
  )) {
    throw new Error('Isolated validation ownership evidence requires a process group id.')
  }
  const ownershipPath = path.join(evidenceDirectory, 'owned-process.json')
  writeAtomicDocument(ownershipPath, `${JSON.stringify({
    orchestratorProcessId: ownership.orchestratorProcessId,
    ...(ownership.processGroupId === undefined ? {} : { processGroupId: ownership.processGroupId }),
    schemaVersion: 'valedictorian-isolated-validation-process@1',
  }, null, 2)}\n`)
  return ownershipPath
}

export function createIsolatedValidationEvidenceDirectory(temporaryDirectory = requireTemporaryDirectory()) {
  const directory = fs.mkdtempSync(path.join(temporaryDirectory, 'valedictorian-validation-evidence-'))
  fs.chmodSync(directory, 0o700)
  return directory
}

function portFromUrl(url: URL) {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Isolated validation readiness URL has an invalid port.')
  }
  return port
}

function sanitizeDiagnosticMessage(value: string) {
  return value
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/(?:api[_-]?key|password|secret|token)\s+[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240)
}

function requireTemporaryDirectory() {
  const temporaryDirectory = path.resolve(process.env.TMPDIR ?? '/tmp')
  if (!fs.statSync(temporaryDirectory).isDirectory()) {
    throw new Error('The configured temporary directory is unavailable.')
  }
  return temporaryDirectory
}
