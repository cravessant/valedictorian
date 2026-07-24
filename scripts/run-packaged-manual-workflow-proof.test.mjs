import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import {
  packagedManualWorkflowProofEnvironment,
  packagedApplicationPayloadIdentity,
  runPackagedManualWorkflowRestartProof,
} from './run-packaged-manual-workflow-proof.mjs'

function phaseResult(phase) {
  return {
    buildIdentity: 'fixture-build',
    fixtures: { adapter: 'jobright.resolver@fixture', destinationHost: 'careers.fixture.dev' },
    observables: phase === 'write'
      ? {
          companyAliasAndNotesEdited: true,
          companyArchiveAndRestoreRevisioned: true,
          companyMergePreservedHistory: true,
          companyMergeReassignedJobToCanonical: true,
          companyAssignmentRecoveryAttached: true,
          companyReassignmentCompleted: true,
          captureApiDefaultMatchesAll: true,
          captureNeedsAttentionFilterExercised: true,
          companyApiDefaultMatchesAll: true,
          destinationResolved: true,
          duplicateJobRecoveryAttached: true,
          duplicateReviewMarkedDistinct: true,
          initialCompanyAssignmentCreated: true,
          jobrightIntermediaryRecorded: true,
          jobrightRecordedDetailResolverUsed: true,
          migratedOneAssignmentPerJob: true,
          migratedWriteAvailableAfterBackfill: true,
          migratedWriteRejectedBeforeBackfill: true,
          migratedWorkspaceReady: true,
        }
      : {
          completedCapturePersistedAcrossRestart: true,
          companyHistoryPersistedAcrossRestart: true,
          companyMergeAssignmentPersistedAcrossRestart: true,
          freshOneAssignmentPerJobAfterRestart: true,
          migratedOneAssignmentPerJobAfterRestart: true,
        },
    phase,
    workspace: {
      fresh: {
        companyCapability: 'ready',
        companyCount: 5,
        completedCaptureCount: 3,
      },
      migrated: {
        assignmentCount: 1,
        companyCapability: 'ready',
        completed: 1,
        total: 1,
      },
    },
  }
}

it('creates an isolated packaged-proof environment without Electron run-as-node', () => {
  const environment = packagedManualWorkflowProofEnvironment(
    { ELECTRON_RUN_AS_NODE: '1', EXISTING: 'kept' },
    '/tmp/package-proof',
    'write',
    'fixture-build',
  )

  expect(environment.EXISTING).toBe('kept')
  expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined()
  expect(environment.VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_BUILD_IDENTITY).toBe('fixture-build')
  expect(environment.VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_PROOF_PATH).toBe('/tmp/package-proof')
  expect(environment.VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_PROOF_PHASE).toBe('write')
})

it('identifies the packaged application payload, including unpacked runtime files', () => {
  const resourcesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-proof-payload-'))
  try {
    fs.writeFileSync(path.join(resourcesDirectory, 'app.asar'), 'application-one')
    const unpackedDirectory = path.join(resourcesDirectory, 'app.asar.unpacked', 'native')
    fs.mkdirSync(unpackedDirectory, { recursive: true })
    const unpackedFile = path.join(unpackedDirectory, 'runtime.node')
    fs.writeFileSync(unpackedFile, 'runtime-one')
    const initial = packagedApplicationPayloadIdentity(resourcesDirectory)

    fs.writeFileSync(path.join(resourcesDirectory, 'app.asar'), 'application-two')
    const changedAsar = packagedApplicationPayloadIdentity(resourcesDirectory)
    fs.writeFileSync(unpackedFile, 'runtime-two')
    const changedUnpacked = packagedApplicationPayloadIdentity(resourcesDirectory)

    expect(initial).toMatch(/^app-payload-sha256:[a-f0-9]{64}$/)
    expect(changedAsar).not.toBe(initial)
    expect(changedUnpacked).not.toBe(changedAsar)
  } finally {
    fs.rmSync(resourcesDirectory, { force: true, recursive: true })
  }
})

it('records bounded write and restart evidence from separate packaged processes', async () => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-proof-runner-'))
  const phases = []
  try {
    const spawnPackagedApp = async (_executablePath, environment) => {
      const phase = environment.VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_PROOF_PHASE
      phases.push(phase)
      fs.writeFileSync(
        path.join(resultDirectory, `${phase}.json`),
        `${JSON.stringify(phaseResult(phase))}\n`,
      )
    }
    const evidence = await runPackagedManualWorkflowRestartProof({
      buildIdentity: 'fixture-build',
      environment: { EXISTING: 'kept' },
      executablePath: '/Applications/Valedictorian',
      resultDirectory,
      spawnPackagedApp,
      timeoutMs: 1_000,
    })

    expect(phases).toEqual(['write', 'verify'])
    expect(evidence).toMatchObject({
      schemaVersion: 'packaged-manual-workflow-proof@1',
      build: { identity: 'fixture-build' },
      fixture: { adapter: 'jobright.resolver@fixture' },
      phases: {
        write: { phase: 'write' },
        verify: { phase: 'verify' },
      },
    })
  } finally {
    fs.rmSync(resultDirectory, { force: true, recursive: true })
  }
})

it('rejects a write proof that omits an accepted recovery observable', async () => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-proof-incomplete-'))
  try {
    fs.writeFileSync(
      path.join(resultDirectory, 'write.json'),
      `${JSON.stringify({
        ...phaseResult('write'),
        observables: { destinationResolved: true },
      })}\n`,
    )
    await expect(runPackagedManualWorkflowRestartProof({
      buildIdentity: 'fixture-build',
      environment: {},
      executablePath: '/Applications/Valedictorian',
      resultDirectory,
      spawnPackagedApp: async () => undefined,
      timeoutMs: 1_000,
    })).rejects.toThrow('incomplete manual workflow write proof')
  } finally {
    fs.rmSync(resultDirectory, { force: true, recursive: true })
  }
})
