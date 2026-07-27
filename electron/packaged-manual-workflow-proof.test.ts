import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPackagedManualWorkflowProof } from './packaged-manual-workflow-proof'

describe.sequential('packaged manual workflow proof', () => {
  it('proves Company assignment across two workspaces through a restart-safe local client', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-manual-workflow-proof-'))
    try {
      const write = await runPackagedManualWorkflowProof({ dataDirectory, phase: 'write' })
      expect(write).toMatchObject({
        phase: 'write',
        workspace: {
          second: { assignmentCount: 1, jobCount: 1 },
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
          secondWorkspaceCompanyWriteAvailableAtOpen: true,
          secondWorkspaceJobCompanyEstablishedOnCreate: true,
        },
      })

      const verify = await runPackagedManualWorkflowProof({ dataDirectory, phase: 'verify' })
      expect(verify).toMatchObject({
        phase: 'verify',
        workspace: {
          second: { assignmentCount: 1, jobCount: 1 },
        },
        observables: {
          companyHistoryPersistedAcrossRestart: true,
          completedCapturePersistedAcrossRestart: true,
          freshOneAssignmentPerJobAfterRestart: true,
          secondWorkspaceOneAssignmentPerJobAfterRestart: true,
        },
      })
    } finally {
      fs.rmSync(dataDirectory, { force: true, recursive: true })
    }
  })
})
