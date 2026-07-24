import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPackagedManualWorkflowProof } from './packaged-manual-workflow-proof'

describe.sequential('packaged manual workflow proof', () => {
  it('proves fresh and migrated Company coverage through a restart-safe local client', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-manual-workflow-proof-'))
    try {
      const write = await runPackagedManualWorkflowProof({ dataDirectory, phase: 'write' })
      expect(write).toMatchObject({
        phase: 'write',
        workspace: {
          fresh: { companyCapability: 'ready' },
          migrated: { assignmentCount: 1, companyCapability: 'ready', completed: 1, total: 1 },
        },
        observables: {
          companyArchiveAndRestoreRevisioned: true,
          companyAssignmentRecoveryAttached: true,
          companyMergePreservedHistory: true,
          companyReassignmentCompleted: true,
          captureApiDefaultMatchesAll: true,
          captureNeedsAttentionFilterExercised: true,
          companyApiDefaultMatchesAll: true,
          destinationResolved: true,
          duplicateJobRecoveryAttached: true,
          duplicateReviewMarkedDistinct: true,
          jobrightIntermediaryRecorded: true,
          jobrightRecordedDetailResolverUsed: true,
          migratedOneAssignmentPerJob: true,
          migratedWriteAvailableAfterBackfill: true,
          migratedWriteRejectedBeforeBackfill: true,
        },
      })

      const verify = await runPackagedManualWorkflowProof({ dataDirectory, phase: 'verify' })
      expect(verify).toMatchObject({
        phase: 'verify',
        workspace: {
          fresh: { companyCapability: 'ready' },
          migrated: { assignmentCount: 1, companyCapability: 'ready', completed: 1, total: 1 },
        },
        observables: {
          companyHistoryPersistedAcrossRestart: true,
          completedCapturePersistedAcrossRestart: true,
          freshOneAssignmentPerJobAfterRestart: true,
          migratedOneAssignmentPerJobAfterRestart: true,
        },
      })
    } finally {
      fs.rmSync(dataDirectory, { force: true, recursive: true })
    }
  })
})
