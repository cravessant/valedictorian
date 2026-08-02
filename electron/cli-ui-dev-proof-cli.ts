import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { IsolatedValidationManifest } from '@sparxie/valedictorian-local-runtime/isolated-validation'
import { load as loadYaml } from 'js-yaml'

export const cliUiDevProofCompanyName = 'Validation Company CLI Proof'
export const expectedCliCommit = 'd576ebfa84119e809666faac668ccd33b5fa3946'
export const expectedCliDependency = 'workspace:0.1.0-alpha.21'
export const expectedCliPackageSha256 =
  'sha256:da8f63519405a7bb5f0bf155f2204b153c0b4199dda42d3914ed546da96e85d9'
export const expectedCliVersion = '0.1.0-alpha.21'

const cliOutputLimit = 32_768
const cliTimeoutMs = 10_000

export interface CliCommandDiagnostic {
  readonly exitCode: number
  readonly label: string
  readonly stderr: string
  readonly stderrBytes: number
  readonly stdoutBytes: number
}

export interface CliProvenance {
  readonly commit: typeof expectedCliCommit
  readonly dependency: typeof expectedCliDependency
  readonly name: '@sparxie/valedictorian-cli'
  readonly packageSha256: string
  readonly version: typeof expectedCliVersion
}

export interface InitialCliCaptureProof {
  readonly captureRevision: number
  readonly evidenceReferences: readonly {
    readonly captureId: string
    readonly captureRevision: number
    readonly evidenceIndexes: readonly number[]
  }[]
}

export interface CompletedCliLineageProof {
  readonly companyRevisionAfter: number
  readonly companyRevisionBefore: number
  readonly jobFactsRevision: number
  readonly jobId: string
}

export interface CliUiDevProofSession {
  diagnostics(): readonly CliCommandDiagnostic[]
  provenance: CliProvenance
  readUnresolvedCapture(): Promise<InitialCliCaptureProof>
  verifyLineageAndMutateCompany(
    initial: InitialCliCaptureProof,
  ): Promise<CompletedCliLineageProof>
}

export function createCliUiDevProofSession({
  cwd = process.cwd(),
  expectedPackageSha256 = expectedCliPackageSha256,
  manifest,
}: {
  readonly cwd?: string
  readonly expectedPackageSha256?: string
  readonly manifest: IsolatedValidationManifest
}): CliUiDevProofSession {
  const cli = resolvePinnedCli(cwd, expectedPackageSha256)
  const apiUrl = exactManifestApiUrl(manifest)
  const workspaceId = manifest.workspace.id
  const commandDiagnostics: CliCommandDiagnostic[] = []

  const runJson = async (label: string, args: readonly string[]) => {
    assertExplicitWorkspace(args, workspaceId)
    const result = await runCliJson({
      apiUrl,
      args: ['--json', ...args],
      entryPath: cli.entryPath,
      label,
    })
    commandDiagnostics.push(result.diagnostic)
    if (result.diagnostic.exitCode !== 0) {
      throw new Error(
        `Pinned CLI command ${label} failed with exit ${String(result.diagnostic.exitCode)}. `
        + result.diagnostic.stderr,
      )
    }
    return result.value
  }

  return {
    diagnostics: () => [...commandDiagnostics],
    provenance: cli.provenance,
    async readUnresolvedCapture() {
      const capture = objectValue(await runJson('capture-before', [
        'captures', 'get', manifest.fixture.captureId, '--workspace', workspaceId,
      ]), 'Capture read')
      const captureRevision = positiveInteger(capture.revision, 'Capture revision')
      if (
        capture.id !== manifest.fixture.captureId
        || capture.workspaceId !== workspaceId
        || capture.removedAt !== null
      ) {
        throw new Error('Pinned CLI read the wrong fixture Capture or workspace.')
      }

      const completion = objectValue(await runJson('capture-detail-before', [
        'captures', 'resolution', 'get', manifest.fixture.captureId,
        '--workspace', workspaceId,
      ]), 'Capture completion detail')
      const evidenceReferences = exactEvidenceReferences(completion, manifest, captureRevision)
      const projections = objectValue(await runJson('capture-projection-before', [
        'captures', 'resolution', 'list', '--workspace', workspaceId,
        '--input-json', '{"filter":"all","limit":20}',
      ]), 'Capture resolution page')
      const item = fixtureProjection(projections, manifest.fixture.captureId)
      const intent = objectValue(item.primaryIntent, 'Capture primary intent')
      if (
        item.captureRevision !== captureRevision
        || item.linkedJob !== null
        || intent.kind !== 'complete_job_information'
      ) {
        throw new Error('Pinned CLI did not observe the fixed unresolved Capture.')
      }
      return { captureRevision, evidenceReferences }
    },
    async verifyLineageAndMutateCompany(initial) {
      const projections = objectValue(await runJson('capture-projection-after', [
        'captures', 'resolution', 'list', '--workspace', workspaceId,
        '--input-json', '{"filter":"all","limit":20}',
      ]), 'Capture resolution page')
      const item = fixtureProjection(projections, manifest.fixture.captureId)
      const linkedJob = objectValue(item.linkedJob, 'Capture linked Job')
      const jobId = nonEmptyString(linkedJob.jobId, 'linked Job id')

      const job = objectValue(await runJson('job-after', [
        'jobs', 'get', jobId, '--workspace', workspaceId,
      ]), 'Job read')
      const jobFacts = objectValue(job.facts, 'Job facts')
      if (
        job.id !== jobId
        || job.workspaceId !== workspaceId
        || jobFacts.roleTitle !== 'Validation Engineer'
        || jobFacts.companyName !== 'Validation Company'
        || !sameEvidenceReferences(job.captureEvidenceReferences, initial.evidenceReferences)
      ) {
        throw new Error('Pinned CLI Job read did not preserve the exact fixture Capture lineage.')
      }

      const assignment = objectValue(await runJson('job-company-after', [
        'jobs', 'company', 'get', jobId, '--workspace', workspaceId,
      ]), 'Job Company assignment')
      const assignedCompany = objectValue(assignment.workspaceCompany, 'assigned Workspace Company')
      if (
        assignment.jobId !== jobId
        || assignedCompany.companyId !== manifest.fixture.companyId
        || assignedCompany.displayName !== 'Validation Company'
      ) {
        throw new Error('Pinned CLI read the wrong Job Workspace Company assignment.')
      }

      const companyBefore = companyFromRead(await runJson('company-before-mutation', [
        'companies', 'get', manifest.fixture.companyId, '--workspace', workspaceId,
      ]), manifest)
      const companyRevisionBefore = positiveInteger(
        companyBefore.revision,
        'Company revision before mutation',
      )
      const mutationInput = JSON.stringify({
        actor: {
          displayName: 'CLI/UI development proof',
          id: 'cli-ui-dev-proof',
          type: 'system',
        },
        displayName: cliUiDevProofCompanyName,
        expectedCompanyRevision: companyRevisionBefore,
        idempotencyKey: `${manifest.run.id}:company-display-name`,
        rationale: 'Deterministic isolated CLI and UI parity proof.',
      })
      const mutation = objectValue(await runJson('company-mutation', [
        'companies', 'update', manifest.fixture.companyId, '--workspace', workspaceId,
        '--input-json', mutationInput,
      ]), 'Company mutation')
      const mutatedCompany = objectValue(mutation.company, 'mutated Company')
      const companyRevisionAfter = positiveInteger(
        mutatedCompany.revision,
        'Company revision after mutation',
      )
      if (
        mutation.status !== 'updated'
        || mutation.workspaceId !== workspaceId
        || mutation.companyId !== manifest.fixture.companyId
        || mutation.requestCompanyRevision !== companyRevisionBefore
        || mutatedCompany.displayName !== cliUiDevProofCompanyName
        || companyRevisionAfter <= companyRevisionBefore
      ) {
        throw new Error('Pinned CLI Company mutation did not advance the expected fixture value.')
      }

      const companyAfter = companyFromRead(await runJson('company-after-mutation', [
        'companies', 'get', manifest.fixture.companyId, '--workspace', workspaceId,
      ]), manifest)
      if (
        companyAfter.displayName !== cliUiDevProofCompanyName
        || companyAfter.revision !== companyRevisionAfter
      ) {
        throw new Error('Pinned CLI could not read back its fixture Company mutation.')
      }
      return {
        companyRevisionAfter,
        companyRevisionBefore,
        jobFactsRevision: positiveInteger(job.factsRevision, 'Job facts revision'),
        jobId,
      }
    },
  }
}

function resolvePinnedCli(cwd: string, expectedPackageSha256: string) {
  const dependency = objectValue(
    JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')),
    'application package',
  )
  const devDependencies = objectValue(dependency.devDependencies, 'application devDependencies')
  if (devDependencies['@sparxie/valedictorian-cli'] !== expectedCliDependency) {
    throw new Error('The repository-controlled CLI dependency is not the required workspace source.')
  }
  const lockfile = objectValue(
    loadYaml(fs.readFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'utf8')),
    'pnpm lockfile',
  )
  const importers = objectValue(lockfile.importers, 'pnpm lockfile importers')
  const rootImporter = objectValue(importers['.'], 'pnpm root importer')
  const lockedDevDependencies = objectValue(
    rootImporter.devDependencies,
    'pnpm root devDependencies',
  )
  const lockedCli = objectValue(
    lockedDevDependencies['@sparxie/valedictorian-cli'],
    'pnpm CLI dependency',
  )
  if (
    lockedCli.specifier !== expectedCliDependency
    || lockedCli.version !== 'link:packages/cli'
  ) {
    throw new Error('The repository-controlled CLI lock provenance is missing or external.')
  }

  const packageDirectory = fs.realpathSync(
    path.join(cwd, 'node_modules', '@sparxie', 'valedictorian-cli'),
  )
  const workspaceDirectory = fs.realpathSync(path.join(cwd, 'packages', 'cli'))
  if (packageDirectory !== workspaceDirectory) {
    throw new Error('The installed repository-controlled CLI is not the imported workspace source.')
  }
  const packageDocument = objectValue(
    JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8')),
    'CLI package',
  )
  const bins = objectValue(packageDocument.bin, 'CLI package bin')
  if (
    packageDocument.name !== '@sparxie/valedictorian-cli'
    || packageDocument.version !== expectedCliVersion
    || packageDocument.valedictorianSourceCommit !== expectedCliCommit
    || typeof bins['valedictorian-cli'] !== 'string'
  ) {
    throw new Error('The installed repository-controlled CLI has unexpected identity.')
  }
  const entryPath = path.resolve(packageDirectory, bins['valedictorian-cli'])
  fs.accessSync(entryPath, fs.constants.R_OK)
  const packageSha256 = hashCliPackagePayload(packageDirectory)
  if (packageSha256 !== expectedPackageSha256) {
    throw new Error('The installed repository-controlled CLI package hash is unexpected.')
  }
  const provenance: CliProvenance = {
    commit: expectedCliCommit,
    dependency: expectedCliDependency,
    name: '@sparxie/valedictorian-cli',
    packageSha256,
    version: expectedCliVersion,
  }
  return {
    entryPath,
    provenance,
  }
}

export function hashCliPackagePayload(packageDirectory: string) {
  const files = ['package.json', ...regularFiles(path.join(packageDirectory, 'dist'))
    .map((filePath) => path.relative(packageDirectory, filePath).split(path.sep).join('/'))]
    .sort()
  const hash = createHash('sha256')
  for (const relativePath of files) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(packageDirectory, relativePath)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function regularFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return regularFiles(filePath)
    if (entry.isFile()) return [filePath]
    throw new Error('The installed repository-controlled CLI contains an unsupported file.')
  })
}

async function runCliJson({
  apiUrl,
  args,
  entryPath,
  label,
}: {
  readonly apiUrl: string
  readonly args: readonly string[]
  readonly entryPath: string
  readonly label: string
}) {
  return new Promise<{ diagnostic: CliCommandDiagnostic; value: unknown }>((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath, ...args], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        VALEDICTORIAN_API_URL: apiUrl,
      } as unknown as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let exceeded = false
    let timedOut = false
    const append = (current: Buffer, chunk: Buffer) => {
      const combined = Buffer.concat([current, chunk])
      if (combined.length <= cliOutputLimit) return combined
      exceeded = true
      child.kill('SIGTERM')
      return combined.subarray(0, cliOutputLimit)
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    const timeout = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return
      timedOut = true
      child.kill('SIGTERM')
    }, cliTimeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (exceeded) {
        reject(new Error(`Pinned CLI command ${label} exceeded its bounded output.`))
        return
      }
      if (timedOut) {
        reject(new Error(`Pinned CLI command ${label} exceeded its ${cliTimeoutMs}ms timeout.`))
        return
      }
      if (signal) {
        reject(new Error(`Pinned CLI command ${label} ended from signal ${signal}.`))
        return
      }
      const diagnostic = {
        exitCode: code ?? 1,
        label,
        stderr: sanitize(stderr.toString('utf8')),
        stderrBytes: stderr.length,
        stdoutBytes: stdout.length,
      }
      if (diagnostic.exitCode !== 0) {
        resolve({ diagnostic, value: null })
        return
      }
      try {
        resolve({ diagnostic, value: JSON.parse(stdout.toString('utf8')) })
      } catch {
        reject(new Error(`Pinned CLI command ${label} did not return structured JSON.`))
      }
    })
  })
}

function exactManifestApiUrl(manifest: IsolatedValidationManifest) {
  const url = new URL(manifest.urls.api)
  if (
    url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || Number(url.port) !== manifest.ports.api
  ) {
    throw new Error('The isolated session manifest does not identify its exact loopback API.')
  }
  return url.toString()
}

function assertExplicitWorkspace(args: readonly string[], workspaceId: string) {
  const index = args.indexOf('--workspace')
  if (
    index < 0
    || args[index + 1] !== workspaceId
    || args.lastIndexOf('--workspace') !== index
  ) {
    throw new Error('Every pinned CLI proof command must explicitly name the fixture workspace.')
  }
}

function exactEvidenceReferences(
  completion: Record<string, unknown>,
  manifest: IsolatedValidationManifest,
  captureRevision: number,
) {
  const expected = [{
    captureId: manifest.fixture.captureId,
    captureRevision,
    evidenceIndexes: [0],
  }]
  if (!sameEvidenceReferences(completion.exactEvidenceReferences, expected)) {
    throw new Error('Pinned CLI Capture detail did not expose exact fixture evidence lineage.')
  }
  return expected
}

function fixtureProjection(page: Record<string, unknown>, captureId: string) {
  const items = Array.isArray(page.items) ? page.items : []
  const matches = items.filter((item) => objectValue(item, 'Capture projection').captureId === captureId)
  if (matches.length !== 1) throw new Error('Pinned CLI did not return one fixture Capture projection.')
  return objectValue(matches[0], 'fixture Capture projection')
}

function companyFromRead(value: unknown, manifest: IsolatedValidationManifest) {
  const read = objectValue(value, 'Company read')
  const lookup = objectValue(read.lookup, 'Company lookup')
  const company = objectValue(lookup.canonical, 'canonical Company')
  if (
    company.id !== manifest.fixture.companyId
    || company.workspaceId !== manifest.workspace.id
    || company.status !== 'active'
  ) {
    throw new Error('Pinned CLI read the wrong fixture Workspace Company.')
  }
  return company
}

function sameEvidenceReferences(actual: unknown, expected: unknown) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object.`)
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} is invalid.`)
  }
  return Number(value)
}

function nonEmptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function sanitize(value: string) {
  return value
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 320)
}
