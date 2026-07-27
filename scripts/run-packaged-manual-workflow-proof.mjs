import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  findPackagedAppExecutable,
  resolvePackagedResourcesDirectory,
} from './run-packaged-pglite-smoke.mjs'
import { inspectPgliteRuntimeArtifactLayout } from './inspect-pglite-runtime-assets.mjs'

export function packagedManualWorkflowProofEnvironment(environment, resultDirectory, phase, buildIdentity) {
  const result = {
    ...environment,
    VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_BUILD_IDENTITY: buildIdentity,
    VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_PROOF_PATH: resultDirectory,
    VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_PROOF_PHASE: phase,
  }
  delete result.ELECTRON_RUN_AS_NODE
  return result
}

async function runPackagedApp(executablePath, environment, timeoutMs) {
  await new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Packaged manual workflow proof timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) resolve(undefined)
      else reject(new Error(`Packaged app exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`))
    })
  })
}

function readPhaseResult(resultDirectory, phase) {
  const resultPath = path.join(resultDirectory, `${phase}.json`)
  if (!fs.existsSync(resultPath)) {
    throw new Error(`Packaged app did not create ${phase}.json`)
  }
  return JSON.parse(fs.readFileSync(resultPath, 'utf8'))
}

export async function runPackagedManualWorkflowRestartProof({
  buildIdentity,
  environment,
  executablePath,
  resultDirectory,
  spawnPackagedApp = runPackagedApp,
  timeoutMs,
}) {
  await spawnPackagedApp(
    executablePath,
    packagedManualWorkflowProofEnvironment(environment, resultDirectory, 'write', buildIdentity),
    timeoutMs,
  )
  const write = readPhaseResult(resultDirectory, 'write')
  assertWriteResult(write, buildIdentity)

  await spawnPackagedApp(
    executablePath,
    packagedManualWorkflowProofEnvironment(environment, resultDirectory, 'verify', buildIdentity),
    timeoutMs,
  )
  const verify = readPhaseResult(resultDirectory, 'verify')
  assertVerifyResult(verify, buildIdentity)

  return {
    schemaVersion: 'packaged-manual-workflow-proof@1',
    build: { identity: buildIdentity },
    fixture: write.fixtures,
    phases: { write, verify },
  }
}

/** Every Job in a workspace holds exactly one Company assignment. */
function oneAssignmentPerJob(workspace) {
  return Number.isInteger(workspace?.assignmentCount)
    && Number.isInteger(workspace?.jobCount)
    && workspace.assignmentCount === workspace.jobCount
}

function freshWorkspaceCounted(workspace) {
  return Number.isInteger(workspace?.companyCount)
    && Number.isInteger(workspace?.completedCaptureCount)
}

function assertWriteResult(result, buildIdentity) {
  if (
    result?.buildIdentity !== buildIdentity
    || result?.phase !== 'write'
    || !freshWorkspaceCounted(result?.workspace?.fresh)
    || !oneAssignmentPerJob(result?.workspace?.second)
    || result?.observables?.companyAliasAndNotesEdited !== true
    || result?.observables?.destinationResolved !== true
    || result?.observables?.jobrightIntermediaryRecorded !== true
    || result?.observables?.jobrightRecordedDetailResolverUsed !== true
    || result?.observables?.initialCompanyAssignmentCreated !== true
    || result?.observables?.secondWorkspaceJobCompanyEstablishedOnCreate !== true
    || result?.observables?.duplicateJobRecoveryAttached !== true
    || result?.observables?.companyAssignmentRecoveryAttached !== true
    || result?.observables?.companyArchiveAndRestoreRevisioned !== true
    || result?.observables?.companyReassignmentCompleted !== true
    || result?.observables?.duplicateReviewMarkedDistinct !== true
    || result?.observables?.companyMergePreservedHistory !== true
    || result?.observables?.companyMergeReassignedJobToCanonical !== true
    || result?.observables?.captureApiDefaultMatchesAll !== true
    || result?.observables?.captureNeedsAttentionFilterExercised !== true
    || result?.observables?.companyApiDefaultMatchesAll !== true
    || result?.observables?.secondWorkspaceCompanyWriteAvailableAtOpen !== true
  ) {
    throw new Error('Packaged app returned an incomplete manual workflow write proof')
  }
}

function assertVerifyResult(result, buildIdentity) {
  if (
    result?.buildIdentity !== buildIdentity
    || result?.phase !== 'verify'
    || !freshWorkspaceCounted(result?.workspace?.fresh)
    || !oneAssignmentPerJob(result?.workspace?.second)
    || result?.observables?.completedCapturePersistedAcrossRestart !== true
    || result?.observables?.companyHistoryPersistedAcrossRestart !== true
    || result?.observables?.companyMergeAssignmentPersistedAcrossRestart !== true
    || result?.observables?.freshOneAssignmentPerJobAfterRestart !== true
    || result?.observables?.secondWorkspaceOneAssignmentPerJobAfterRestart !== true
  ) {
    throw new Error('Packaged app returned an incomplete manual workflow restart proof')
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function packagedApplicationPayloadIdentity(resourcesDirectory) {
  const appAsarPath = path.join(resourcesDirectory, 'app.asar')
  if (!fs.existsSync(appAsarPath)) {
    throw new Error(`Packaged application payload is missing ${appAsarPath}`)
  }
  const payloadHash = createHash('sha256')
  hashPayloadEntry(payloadHash, resourcesDirectory, appAsarPath)
  const unpackedPath = path.join(resourcesDirectory, 'app.asar.unpacked')
  if (fs.existsSync(unpackedPath)) {
    for (const filePath of payloadFiles(unpackedPath)) {
      hashPayloadEntry(payloadHash, resourcesDirectory, filePath)
    }
  }
  return `app-payload-sha256:${payloadHash.digest('hex')}`
}

function hashPayloadEntry(hash, resourcesDirectory, filePath) {
  hash.update(path.relative(resourcesDirectory, filePath).split(path.sep).join('/'))
  hash.update('\0')
  hash.update(fs.readFileSync(filePath))
  hash.update('\0')
}

function payloadFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return payloadFiles(entryPath)
      if (entry.isFile()) return [entryPath]
      return []
    })
    .sort((left, right) => left.localeCompare(right))
}

async function run() {
  const releaseRoot = path.resolve(readArgument('--release-root') ?? 'release')
  const executablePath = path.resolve(
    readArgument('--app') ?? findPackagedAppExecutable(releaseRoot),
  )
  const timeoutMs = Number(readArgument('--timeout-ms') ?? 120_000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer')
  }
  const resourcesDirectory = resolvePackagedResourcesDirectory(executablePath)
  const artifactProblems = inspectPgliteRuntimeArtifactLayout(resourcesDirectory)
  if (artifactProblems.length > 0) {
    throw new Error(`Packaged PGlite asset inspection failed:\n${artifactProblems.join('\n')}`)
  }

  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-manual-workflow-proof-'))
  try {
    const evidence = await runPackagedManualWorkflowRestartProof({
      buildIdentity: packagedApplicationPayloadIdentity(resourcesDirectory),
      environment: process.env,
      executablePath,
      resultDirectory,
      timeoutMs,
    })
    const evidencePath = readArgument('--evidence-path')
    if (evidencePath) {
      const outputPath = path.resolve(evidencePath)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
      process.stdout.write(`Packaged manual workflow evidence: ${outputPath}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(evidence)}\n`)
    }
  } finally {
    fs.rmSync(resultDirectory, { force: true, recursive: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
