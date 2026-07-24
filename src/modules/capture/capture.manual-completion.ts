/**
 * Atomic manual Capture completion.
 *
 * This is deliberately a lifecycle orchestrator rather than another public Job
 * creation route. It owns one transaction and composes the Capture, Job, and
 * Company owner conversations so a selected Company is the initial assignment
 * at commit time (never a baseline Company that is immediately rewritten).
 */
import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  completeCaptureManuallyInputSchema,
  completeCaptureManuallyResultSchema,
  processingIssueSchema,
  type CompleteCaptureManuallyInput,
  type CompleteCaptureManuallyResult,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { createUuidV7Generator, type Clock, type UuidV7Generator } from '../../db/uuidv7'
import {
  appendCompanyHistory,
  lockCompanyWorkspace,
  updateCompanyHead,
  type CompanyTx,
} from '../company/company.command-support'
import { assignInitialCompanyOn } from '../company/company.assignment.service'
import { createInlineCompanyOn } from '../company/company.commands'
import {
  companyCapabilityState,
  jobCompanyAssignments,
  workspaceCompanies,
} from '../company/company.schema'
import {
  captureEvidenceItems,
  captureResolutionCommandReceipts,
  captureResolutionGenerations,
  captureResolutionStageResults,
  captureRevisions,
  captures,
} from './capture.schema'
import {
  jobCaptureEvidenceReferences,
  jobExternalIdentities,
  jobs,
} from '../job/job.schema'
import type { JobIdentityService } from '../job/job.identity'
import type { JobService } from '../job/job.service'
import type { JobPromotionService } from '../lifecycle/capture-to-job.promotion'

type Tx = CompanyTx
type Request = ReturnType<typeof completeCaptureManuallyInputSchema.parse>

interface ExistingJob {
  readonly jobId: string
  readonly createdAt: string
  readonly factsJson: string
  readonly factsRevision: number
  readonly companyId: string
  readonly companyRevision: number
  readonly assignmentRevision: number
}

export interface ManualCaptureCompletionService {
  complete(input: CompleteCaptureManuallyInput): Promise<CompleteCaptureManuallyResult>
}

export interface ManualCaptureCompletionOptions {
  readonly workspaceId: string
  readonly jobService: JobService
  readonly promotion: JobPromotionService
  readonly jobIdentityService: JobIdentityService
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

class CompletionAbort extends Error {
  constructor(readonly result: CompleteCaptureManuallyResult) {
    super('Manual Capture completion blocked.')
    this.name = 'CompletionAbort'
  }
}

export function createManualCaptureCompletionService(
  database: PgliteDatabase,
  options: ManualCaptureCompletionOptions,
): ManualCaptureCompletionService {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(now)
  const nowIso = () => now().toISOString()

  async function complete(rawInput: CompleteCaptureManuallyInput): Promise<CompleteCaptureManuallyResult> {
    const request = completeCaptureManuallyInputSchema.parse(rawInput)
    const requestFingerprint = fingerprint({ operation: 'complete', request })
    return database.transaction(async (tx) => {
      // The workspace lock is intentionally first: Company identity operations
      // serialize before Capture/receipt and dependent Job locks.
      await lockCompanyWorkspace(tx, options.workspaceId)
      const receipt = await readReceipt(tx, options.workspaceId, 'complete', request.idempotencyKey)
      if (receipt) {
        if (receipt.requestFingerprint === requestFingerprint) return parseResult(receipt.resultJson)
        return lifecycleBlocked('invalid_input', 'This idempotency key was already used for a different request.')
      }

      let result = await companyCapabilityFailureOn(tx)
      if (!result) result = unsafeDestinationFailure(request)
      if (!result) {
        try {
          // A typed failure after a lifecycle write must roll the inner work back,
          // while the outer Company workspace lock remains held until its immutable
          // blocked receipt is stored.
          result = await tx.transaction((savepoint) => completeOn(savepoint, request))
        } catch (error) {
          if (!(error instanceof CompletionAbort)) throw error
          result = error.result
        }
      }
      await writeReceipt(tx, options.workspaceId, request, requestFingerprint, result, nowIso())
      return result
    })
  }

  async function companyCapabilityFailureOn(
    tx: Tx,
  ): Promise<CompleteCaptureManuallyResult | null> {
    const [state] = await tx.select({
      status: companyCapabilityState.status,
      message: companyCapabilityState.message,
    }).from(companyCapabilityState)
      .where(eq(companyCapabilityState.workspaceId, options.workspaceId))
      .limit(1)
    if (state?.status === 'ready') return null
    return lifecycleBlocked(
      'impossible_state',
      state?.status === 'blocked'
        ? state.message ?? 'Workspace Companies are unavailable.'
        : 'Workspace Companies are still being prepared.',
    )
  }

  async function completeOn(tx: Tx, request: Request): Promise<CompleteCaptureManuallyResult> {
    const [capture] = await tx.select({
      id: captures.id,
      revision: captures.revision,
      removedAt: captures.removedAt,
    }).from(captures).where(and(
      eq(captures.workspaceId, options.workspaceId),
      eq(captures.id, request.captureId),
    )).limit(1).for('update')
    if (!capture || capture.removedAt) {
      return lifecycleBlocked('invalid_input', 'The Capture does not exist in this workspace.')
    }

    const [generation] = await tx.select({
      id: captureResolutionGenerations.id,
      status: captureResolutionGenerations.status,
      processingSummary: captureResolutionGenerations.processingSummary,
    }).from(captureResolutionGenerations).where(and(
      eq(captureResolutionGenerations.workspaceId, options.workspaceId),
      eq(captureResolutionGenerations.captureId, request.captureId),
      eq(captureResolutionGenerations.captureRevision, capture.revision),
      inArray(captureResolutionGenerations.status, ['active', 'promoted']),
    )).orderBy(desc(captureResolutionGenerations.ordinal)).limit(1).for('update')

    const staleGuards: Array<{
      kind: 'capture_revision' | 'generation'
      expectedRevision?: number
      currentRevision?: number
      expectedGenerationId?: string | null
      currentGenerationId?: string | null
    }> = []
    if (capture.revision !== request.expectedCaptureRevision) {
      staleGuards.push({
        kind: 'capture_revision',
        expectedRevision: request.expectedCaptureRevision,
        currentRevision: capture.revision,
      })
    }
    if (request.expectedGenerationId !== null && (generation?.id ?? null) !== request.expectedGenerationId) {
      staleGuards.push({
        kind: 'generation',
        expectedGenerationId: request.expectedGenerationId,
        currentGenerationId: generation?.id ?? null,
      })
    }
    if (staleGuards.length > 0) return stale(staleGuards)
    if (generation?.status === 'promoted') {
      return lifecycleBlocked('impossible_state', 'This Capture has already been promoted.')
    }
    if (generation && !(await generationCanComplete(tx, generation.id))) {
      return lifecycleBlocked('impossible_state', 'The active Capture generation is not ready for manual completion.')
    }

    const referencesFailure = await validateEvidenceReferences(tx, request)
    if (referencesFailure) return referencesFailure

    const linkedOwners = await lineageJobs(tx, request.captureId)
    const strongOwners = await strongIdentityOwners(tx, request)
    const owners = exactOwners(linkedOwners, strongOwners)
    if (owners.length > 0) {
      const conflictCode = linkedOwners.length > 0 && owners.length > 1
        ? 'deterministic_duplicate'
        : 'strong_identity_conflict'
      const selected = await resolveExistingOwner(tx, request, owners, conflictCode)
      if ('result' in selected) {
        await persistCompletionBlocker(tx, request, generation?.id ?? null, selected.result, owners.length)
        return selected.result
      }
      const companyConflict = await companyForExistingJob(tx, request, selected.job)
      if (companyConflict) {
        await persistCompletionBlocker(tx, request, generation?.id ?? null, companyConflict)
        return companyConflict
      }
      const finalizationIdentities = await identitiesForExistingTarget(tx, request, selected.job.jobId)
      const finalized = await options.promotion.promoteCaptureOn(tx, promotionInput(
        options.workspaceId,
        request,
        selected.job.jobId,
        finalizationIdentities,
      ))
      if (!finalized.ok) throw new CompletionAbort(lifecycleBlocked('strong_identity_conflict', finalized.message))
      await promoteGeneration(tx, request, generation?.id ?? null, selected.job.jobId)
      return completeCaptureManuallyResultSchema.parse({
        status: 'created',
        jobId: selected.job.jobId,
        companyId: selected.job.companyId,
        createdJob: false,
        existingJobComparison: sameFacts(selected.job.factsJson, request.jobFacts) ? 'equivalent' : 'different',
      })
    }
    if (request.duplicateResolution) {
      return lifecycleBlocked('invalid_input', 'The selected duplicate Job is no longer a current conflict.')
    }

    const company = await resolveCompanyForCreation(tx, request)
    if ('result' in company) return company.result
    if (!company.row) return lifecycleBlocked('invalid_input', 'A Company selection is required.')
    const timestamp = nowIso()
    const created = await options.jobService.createForCompanyAssignmentOn(tx, {
      workspaceId: options.workspaceId,
      selectedCompanyId: company.row.id,
      facts: request.jobFacts,
      actor: request.actor,
      idempotencyKey: `completion:${fingerprint({ captureId: request.captureId, idempotencyKey: request.idempotencyKey })}`,
      establishInitialAssignment: ({ jobId, workspaceId, companyId }) => assignInitialCompanyOn(tx, {
        workspaceId,
        jobId,
        companyId,
        actor: request.actor,
        rationale: 'Selected while completing a Capture into a Job.',
        now: timestamp,
        newId,
      }),
    })
    if (!created.ok) throw new CompletionAbort(lifecycleBlocked('invalid_input', created.message))
    if (!created.created) {
      const existing = await jobById(tx, created.job.id)
      if (!existing) throw new Error('Idempotent Job has no Company assignment.')
      const finalized = await options.promotion.promoteCaptureOn(tx, promotionInput(options.workspaceId, request, existing.jobId))
      if (!finalized.ok) throw new CompletionAbort(lifecycleBlocked('strong_identity_conflict', finalized.message))
      await promoteGeneration(tx, request, generation?.id ?? null, existing.jobId)
      return completeCaptureManuallyResultSchema.parse({
        status: 'created', jobId: existing.jobId, companyId: existing.companyId,
        createdJob: false, existingJobComparison: sameFacts(existing.factsJson, request.jobFacts) ? 'equivalent' : 'different',
      })
    }
    const finalized = await options.promotion.promoteCaptureOn(tx, promotionInput(options.workspaceId, request, created.job.id))
    if (!finalized.ok) throw new CompletionAbort(lifecycleBlocked('strong_identity_conflict', finalized.message))
    await promoteGeneration(tx, request, generation?.id ?? null, created.job.id)
    return completeCaptureManuallyResultSchema.parse({
      status: 'created', jobId: created.job.id, companyId: company.row.id,
      createdJob: true, existingJobComparison: 'not_compared',
    })
  }

  async function selectedExistingCompany(
    tx: Tx,
    request: Request,
  ): Promise<{ row: typeof workspaceCompanies.$inferSelect | null } | { result: CompleteCaptureManuallyResult }> {
    if (request.companyResolution.action === 'create_local') return { row: null }
    const [row] = await tx.select().from(workspaceCompanies).where(and(
      eq(workspaceCompanies.workspaceId, options.workspaceId),
      eq(workspaceCompanies.id, request.companyResolution.companyId),
    )).limit(1).for('update')
    if (!row) return { result: lifecycleBlocked('invalid_input', 'The selected Company does not exist.') }
    if (row.revision !== request.companyResolution.expectedCompanyRevision) {
      return { result: stale([{
        kind: 'company_revision', companyId: row.id,
        expectedRevision: request.companyResolution.expectedCompanyRevision,
        currentRevision: row.revision,
      }]) }
    }
    if (row.status === 'merged') return { result: lifecycleBlocked('impossible_state', 'Select the active canonical Company.') }
    if (row.status === 'archived' && !request.companyResolution.restoreIfArchived) {
      return { result: lifecycleBlocked('impossible_state', 'Restore the archived Company before assigning it.') }
    }
    return { row }
  }

  async function resolveCompanyForCreation(
    tx: Tx,
    request: Request,
  ): Promise<{ row: typeof workspaceCompanies.$inferSelect } | { result: CompleteCaptureManuallyResult }> {
    if (request.companyResolution.action === 'create_local') {
      return {
        row: await createInlineCompanyOn(tx, {
          workspaceId: options.workspaceId,
          displayName: request.companyResolution.displayName,
          ...(request.companyResolution.websiteUrl ? { websiteUrl: request.companyResolution.websiteUrl } : {}),
          actor: request.actor,
          rationale: 'Created while completing a Capture into a Job.',
          now: nowIso(),
          newId,
        }),
      }
    }
    const selected = await selectedExistingCompany(tx, request)
    if ('result' in selected) return selected
    if (!selected.row) return { result: lifecycleBlocked('invalid_input', 'A Company selection is required.') }
    if (selected.row.status === 'archived') {
      const restored = await updateCompanyHead(tx, selected.row, { status: 'active' }, nowIso())
      await appendCompanyHistory(tx, {
        newId,
        row: restored,
        kind: 'restored',
        changedFields: ['status'],
        actor: request.actor,
        rationale: 'Restored while completing a Capture into a Job.',
        occurredAt: nowIso(),
      })
      return { row: restored }
    }
    return { row: selected.row }
  }

  async function validateEvidenceReferences(tx: Tx, request: Request) {
    if (request.evidenceReferences.length === 0) {
      return lifecycleBlocked('missing_lineage', 'Manual completion requires at least one evidence reference.')
    }
    for (const reference of request.evidenceReferences) {
      if (reference.captureId !== request.captureId) {
        return lifecycleBlocked('foreign_lineage', 'Evidence references must belong to the Capture being completed.')
      }
      const [revision] = await tx.select({ revision: captureRevisions.revision }).from(captureRevisions)
        .where(and(eq(captureRevisions.captureId, reference.captureId), eq(captureRevisions.revision, reference.captureRevision))).limit(1)
      if (!revision) return lifecycleBlocked('missing_lineage', 'An evidence reference names an unknown Capture revision.')
      if (reference.evidenceIndexes.length === 0) {
        return lifecycleBlocked('missing_lineage', 'An evidence reference must name at least one evidence item.')
      }
      const indexes = await tx.select({ index: captureEvidenceItems.evidenceIndex }).from(captureEvidenceItems)
        .where(and(eq(captureEvidenceItems.captureId, reference.captureId), eq(captureEvidenceItems.captureRevision, reference.captureRevision)))
      const available = new Set(indexes.map((row) => row.index))
      const requested = new Set<number>()
      for (const index of reference.evidenceIndexes) {
        if (!Number.isSafeInteger(index) || index < 0 || !available.has(index) || requested.has(index)) {
          return lifecycleBlocked('missing_lineage', 'An evidence reference names an unknown or repeated evidence item.')
        }
        requested.add(index)
      }
    }
    return null
  }

  async function generationCanComplete(tx: Tx, generationId: string): Promise<boolean> {
    const rows = await tx.select({ stage: captureResolutionStageResults.stage, status: captureResolutionStageResults.status, issueJson: captureResolutionStageResults.issueJson })
      .from(captureResolutionStageResults).where(eq(captureResolutionStageResults.generationId, generationId))
    const information = rows.find((row) => row.stage === 'information')
    if (information?.status === 'awaiting_manual') return true
    const destination = rows.find((row) => row.stage === 'destination')
    return destination?.status !== 'blocked'
      && completionAction(destination?.issueJson)
  }

  async function lineageJobs(tx: Tx, captureId: string): Promise<ExistingJob[]> {
    return tx.select({ jobId: jobs.id, createdAt: jobs.createdAt, factsJson: jobs.factsJson, factsRevision: jobs.factsRevision, companyId: jobCompanyAssignments.companyId, companyRevision: workspaceCompanies.revision, assignmentRevision: jobCompanyAssignments.revision })
      .from(jobCaptureEvidenceReferences)
      .innerJoin(jobs, and(eq(jobs.id, jobCaptureEvidenceReferences.jobId), isNull(jobs.removedAt)))
      .innerJoin(jobCompanyAssignments, eq(jobCompanyAssignments.jobId, jobs.id))
      .innerJoin(workspaceCompanies, and(eq(workspaceCompanies.id, jobCompanyAssignments.companyId), eq(workspaceCompanies.workspaceId, options.workspaceId)))
      .where(eq(jobCaptureEvidenceReferences.captureId, captureId)).orderBy(asc(jobs.id)).for('update')
  }

  async function jobById(tx: Tx, jobId: string): Promise<ExistingJob | null> {
    const [row] = await tx.select({ jobId: jobs.id, createdAt: jobs.createdAt, factsJson: jobs.factsJson, factsRevision: jobs.factsRevision, companyId: jobCompanyAssignments.companyId, companyRevision: workspaceCompanies.revision, assignmentRevision: jobCompanyAssignments.revision })
      .from(jobs).innerJoin(jobCompanyAssignments, eq(jobCompanyAssignments.jobId, jobs.id))
      .innerJoin(workspaceCompanies, and(eq(workspaceCompanies.id, jobCompanyAssignments.companyId), eq(workspaceCompanies.workspaceId, options.workspaceId)))
      .where(and(eq(jobs.workspaceId, options.workspaceId), eq(jobs.id, jobId), isNull(jobs.removedAt))).limit(1).for('update')
    return row ?? null
  }

  async function strongIdentityOwners(tx: Tx, request: Request): Promise<ExistingJob[]> {
    const owners = new Map<string, ExistingJob>()
    for (const identity of effectiveIdentities(request)) {
      if (identity.strength !== 'strong') continue
      const rows = await tx.select({ jobId: jobs.id, createdAt: jobs.createdAt, factsJson: jobs.factsJson, factsRevision: jobs.factsRevision, companyId: jobCompanyAssignments.companyId, companyRevision: workspaceCompanies.revision, assignmentRevision: jobCompanyAssignments.revision })
        .from(jobExternalIdentities).innerJoin(jobs, and(eq(jobs.id, jobExternalIdentities.jobId), isNull(jobs.removedAt)))
        .innerJoin(jobCompanyAssignments, eq(jobCompanyAssignments.jobId, jobs.id))
        .innerJoin(workspaceCompanies, and(eq(workspaceCompanies.id, jobCompanyAssignments.companyId), eq(workspaceCompanies.workspaceId, options.workspaceId)))
        .where(and(
          eq(jobs.workspaceId, options.workspaceId),
          eq(jobExternalIdentities.kind, identity.kind),
          eq(jobExternalIdentities.provider, identity.provider),
          sql`coalesce(${jobExternalIdentities.account}, '') = ${identity.account ?? ''}`,
          eq(jobExternalIdentities.value, identity.value),
          eq(jobExternalIdentities.strength, 'strong'),
          isNull(jobExternalIdentities.removedAt),
        )).orderBy(asc(jobs.id)).for('update')
      for (const row of rows) owners.set(row.jobId, row)
    }
    return [...owners.values()].sort((left, right) => left.jobId.localeCompare(right.jobId))
  }

  async function resolveExistingOwner(
    tx: Tx,
    request: Request,
    owners: readonly ExistingJob[],
    blockerCode: 'deterministic_duplicate' | 'strong_identity_conflict',
  ): Promise<{ job: ExistingJob } | { result: CompleteCaptureManuallyResult }> {
    const decision = request.duplicateResolution
    const allowedDecisions: readonly ('attach' | 'merge')[] = owners.length > 1
      ? ['attach', 'merge']
      : ['attach']
    if (!decision) {
      return owners.length === 1
        ? { job: owners[0]! }
        : { result: duplicateBlocked(blockerCode, owners, allowedDecisions) }
    }
    const target = owners.find((owner) => owner.jobId === decision.targetJobId)
    if (!target) return { result: duplicateBlocked(blockerCode, owners, allowedDecisions) }
    if (target.factsRevision !== decision.expectedJobFactsRevision) {
      return { result: duplicateBlocked(blockerCode, owners, allowedDecisions) }
    }
    if (target.assignmentRevision !== decision.expectedAssignmentRevision) {
      return { result: stale([{
        kind: 'assignment_revision',
        jobId: target.jobId,
        expectedRevision: decision.expectedAssignmentRevision,
        currentRevision: target.assignmentRevision,
      }]) }
    }
    if (decision.action === 'attach') return { job: target }
    if (owners.length < 2) {
      return { result: lifecycleBlocked('invalid_input', 'Merge requires at least two current exact Job owners.') }
    }

    const expectedWinner = mergeWinner(owners)
    const companyConflict = await companyForExistingJob(tx, request, expectedWinner)
    if (companyConflict) return { result: companyConflict }

    let winnerJobId = target.jobId
    const remainingOwners = owners.filter((owner) => owner.jobId !== target.jobId)
    for (const owner of remainingOwners) {
      const merged = await options.jobIdentityService.mergeOn(tx, {
        workspaceId: options.workspaceId,
        jobIdA: winnerJobId,
        jobIdB: owner.jobId,
        actor: request.actor,
      })
      if (!merged.ok) {
        throw new CompletionAbort(lifecycleBlocked('strong_identity_conflict', merged.message))
      }
      winnerJobId = merged.winnerJobId
    }
    const winner = await jobById(tx, winnerJobId)
    if (!winner) throw new CompletionAbort(lifecycleBlocked('impossible_state', 'The merged Job has no active Company assignment.'))
    return { job: winner }
  }

  async function companyForExistingJob(
    tx: Tx,
    request: Request,
    job: ExistingJob,
  ): Promise<CompleteCaptureManuallyResult | null> {
    const selected = await selectedExistingCompany(tx, request)
    if ('result' in selected) return selected.result
    if (!selected.row || selected.row.id !== job.companyId) {
      return completeCaptureManuallyResultSchema.parse({
        status: 'company_assignment_blocked',
        blockerCode: 'invalid_input',
        existingJobId: job.jobId,
        currentCompanyId: job.companyId,
        currentCompanyRevision: job.companyRevision,
        assignmentRevision: job.assignmentRevision,
        allowedRecovery: ['reassign_company', 'use_existing_company'],
      })
    }
    if (selected.row.status === 'archived') {
      const restored = await updateCompanyHead(tx, selected.row, { status: 'active' }, nowIso())
      await appendCompanyHistory(tx, {
        newId,
        row: restored,
        kind: 'restored',
        changedFields: ['status'],
        actor: request.actor,
        rationale: 'Restored while completing a Capture into an existing Job.',
        occurredAt: nowIso(),
      })
    }
    return null
  }

  async function identitiesForExistingTarget(
    tx: Tx,
    request: Request,
    targetJobId: string,
  ): Promise<Array<Request['externalIdentities'][number]>> {
    const identities: Array<Request['externalIdentities'][number]> = []
    for (const identity of effectiveIdentities(request)) {
      if (identity.strength !== 'strong') {
        identities.push(identity)
        continue
      }
      const [owner] = await tx.select({ jobId: jobExternalIdentities.jobId })
        .from(jobExternalIdentities)
        .where(and(
          eq(jobExternalIdentities.kind, identity.kind),
          eq(jobExternalIdentities.provider, identity.provider),
          sql`coalesce(${jobExternalIdentities.account}, '') = ${identity.account ?? ''}`,
          eq(jobExternalIdentities.value, identity.value),
          eq(jobExternalIdentities.strength, 'strong'),
          isNull(jobExternalIdentities.removedAt),
        )).limit(1)
      if (!owner || owner.jobId === targetJobId) identities.push(identity)
    }
    return identities
  }

  async function promoteGeneration(tx: Tx, request: Request, generationId: string | null, jobId: string) {
    let targetGenerationId = generationId
    if (generationId) {
      const [destination] = await tx.select({ status: captureResolutionStageResults.status, issueJson: captureResolutionStageResults.issueJson })
        .from(captureResolutionStageResults).where(and(eq(captureResolutionStageResults.generationId, generationId), eq(captureResolutionStageResults.stage, 'destination'))).limit(1)
      const needsManualSuccessor = destination?.status !== 'blocked'
        && completionAction(destination?.issueJson)
      if (needsManualSuccessor) {
        await supersedeGeneration(tx, generationId)
        targetGenerationId = await createManualGeneration(tx, request)
      }
    } else {
      targetGenerationId = await createManualGeneration(tx, request)
    }
    if (!targetGenerationId) throw new Error('Manual completion has no generation to promote.')
    const timestamp = nowIso()
    await tx.update(captureResolutionGenerations).set({ status: 'promoted', processingSummary: 'promoted', linkedJobId: jobId, updatedAt: timestamp })
      .where(eq(captureResolutionGenerations.id, targetGenerationId))
    await tx.update(captureResolutionStageResults).set({ status: 'resolved', issueJson: null, resultJson: JSON.stringify({ jobId }), nextAttemptAt: null, updatedAt: timestamp })
      .where(and(eq(captureResolutionStageResults.generationId, targetGenerationId), eq(captureResolutionStageResults.stage, 'information')))
    await tx.update(captureResolutionStageResults).set({ status: 'promoted', issueJson: null, resultJson: JSON.stringify({ jobId }), nextAttemptAt: null, updatedAt: timestamp })
      .where(and(eq(captureResolutionStageResults.generationId, targetGenerationId), eq(captureResolutionStageResults.stage, 'promotion')))
  }

  /**
   * Surface recoverable manual-completion conflicts on the durable Capture
   * projection before the enclosing command receipt commits. The result body is
   * retained on the promotion stage for the read-model; the ProcessingIssue
   * keeps only a bounded summary suitable for list/detail projection.
   */
  async function persistCompletionBlocker(
    tx: Tx,
    request: Request,
    generationId: string | null,
    result: CompleteCaptureManuallyResult,
    duplicateOwnerCount?: number,
  ) {
    if (result.status !== 'duplicate_blocked' && result.status !== 'company_assignment_blocked') return
    const targetGenerationId = generationId ?? await createManualGeneration(tx, request)
    const timestamp = nowIso()
    const issue = result.status === 'duplicate_blocked'
      ? processingIssueSchema.parse({
        stage: 'promotion',
        code: 'duplicate_job_conflict',
        action: 'resolve_duplicate_job',
        causedBy: null,
        message: 'Multiple current Jobs match this Capture. Choose a supported duplicate resolution.',
        details: {
          conflictingJobCount: duplicateOwnerCount ?? result.conflictingJobs.length,
          listedJobCount: result.conflictingJobs.length,
        },
      })
      : processingIssueSchema.parse({
        stage: 'promotion',
        code: 'company_assignment_conflict',
        action: 'resolve_company_assignment',
        causedBy: null,
        message: 'The selected existing Job has a different Company assignment.',
        details: {
          existingJobId: result.existingJobId,
          currentCompanyId: result.currentCompanyId,
        },
      })
    await tx.update(captureResolutionGenerations).set({
      processingSummary: 'blocked',
      updatedAt: timestamp,
    }).where(eq(captureResolutionGenerations.id, targetGenerationId))
    await tx.update(captureResolutionStageResults).set({
      status: 'blocked',
      issueJson: JSON.stringify(issue),
      resultJson: JSON.stringify(result),
      nextAttemptAt: null,
      updatedAt: timestamp,
    }).where(and(
      eq(captureResolutionStageResults.generationId, targetGenerationId),
      eq(captureResolutionStageResults.stage, 'promotion'),
    ))
  }

  async function supersedeGeneration(tx: Tx, generationId: string) {
    const timestamp = nowIso()
    await tx.update(captureResolutionGenerations).set({ status: 'superseded', processingSummary: 'stopped', updatedAt: timestamp })
      .where(eq(captureResolutionGenerations.id, generationId))
    await tx.update(captureResolutionStageResults).set({ status: 'superseded', nextAttemptAt: null, updatedAt: timestamp })
      .where(eq(captureResolutionStageResults.generationId, generationId))
  }

  async function createManualGeneration(tx: Tx, request: Request): Promise<string> {
    const [ordinal] = await tx.select({ ordinal: captureResolutionGenerations.ordinal }).from(captureResolutionGenerations)
      .where(eq(captureResolutionGenerations.captureId, request.captureId)).orderBy(desc(captureResolutionGenerations.ordinal)).limit(1)
    const id = newId()
    const timestamp = nowIso()
    await tx.insert(captureResolutionGenerations).values({
      id, workspaceId: options.workspaceId, captureId: request.captureId,
      captureRevision: request.expectedCaptureRevision, ordinal: (ordinal?.ordinal ?? 0) + 1,
      trigger: 'manual_completion', status: 'active', processingSummary: 'awaiting_information',
      inputFingerprint: fingerprint({ captureId: request.captureId, captureRevision: request.expectedCaptureRevision }),
      retryPolicyId: 'manual-completion', retryPolicySnapshotJson: '{}', resolverSelectionSnapshotJson: '{}',
      createdByActorJson: JSON.stringify(request.actor), linkedJobId: null, createdAt: timestamp, updatedAt: timestamp,
    })
    await tx.insert(captureResolutionStageResults).values([
      { generationId: id, stage: 'destination', captureRevision: request.expectedCaptureRevision, status: request.destination ? 'resolved' : 'not_required', attemptCount: 0, issueJson: null, resultJson: request.destination ? JSON.stringify({ url: request.destination.url, method: 'manual' }) : '{}', nextAttemptAt: null, resolverId: null, resolverVersion: null, remoteOperationId: null, updatedAt: timestamp },
      { generationId: id, stage: 'information', captureRevision: request.expectedCaptureRevision, status: 'awaiting_manual', attemptCount: 0, issueJson: null, resultJson: '{}', nextAttemptAt: null, resolverId: null, resolverVersion: null, remoteOperationId: null, updatedAt: timestamp },
      { generationId: id, stage: 'promotion', captureRevision: request.expectedCaptureRevision, status: 'not_ready', attemptCount: 0, issueJson: null, resultJson: '{}', nextAttemptAt: null, resolverId: null, resolverVersion: null, remoteOperationId: null, updatedAt: timestamp },
    ])
    return id
  }

  return { complete }
}

function exactOwners(
  lineageOwners: readonly ExistingJob[],
  strongOwners: readonly ExistingJob[],
): ExistingJob[] {
  const owners = new Map<string, ExistingJob>()
  for (const owner of lineageOwners) owners.set(owner.jobId, owner)
  for (const owner of strongOwners) owners.set(owner.jobId, owner)
  return [...owners.values()].sort((left, right) => left.jobId.localeCompare(right.jobId))
}

function mergeWinner(owners: readonly ExistingJob[]): ExistingJob {
  return owners.reduce((winner, candidate) => (
    candidate.createdAt < winner.createdAt
      || (candidate.createdAt === winner.createdAt && candidate.jobId < winner.jobId)
      ? candidate
      : winner
  ))
}

function duplicateBlocked(
  code: 'deterministic_duplicate' | 'strong_identity_conflict',
  jobsList: readonly ExistingJob[],
  allowedDecisions: readonly ('attach' | 'merge')[],
): CompleteCaptureManuallyResult {
  return completeCaptureManuallyResultSchema.parse({
    status: 'duplicate_blocked', blockerCode: code,
    conflictingJobs: jobsList.slice(0, 20).map((job) => ({ jobId: job.jobId, jobFactsRevision: job.factsRevision, companyId: job.companyId, companyRevision: job.companyRevision, assignmentRevision: job.assignmentRevision })),
    allowedDecisions,
  })
}

function stale(guards: readonly Record<string, unknown>[]): CompleteCaptureManuallyResult {
  return completeCaptureManuallyResultSchema.parse({
    status: 'blocked',
    failure: {
      kind: 'stale_guard', blocker: { code: 'impossible_state', message: 'The Capture, Company, or Job changed. Refresh and submit again.' },
      recovery: { action: 'refresh_and_resubmit', guards },
    },
  })
}

function lifecycleBlocked(code: 'invalid_input' | 'impossible_state' | 'missing_lineage' | 'foreign_lineage' | 'strong_identity_conflict' | 'deterministic_duplicate' | 'security_violation', message: string): CompleteCaptureManuallyResult {
  return completeCaptureManuallyResultSchema.parse({
    status: 'blocked', failure: { kind: 'lifecycle_failure', blocker: { code, message } },
  })
}

function unsafeDestinationFailure(request: Request): CompleteCaptureManuallyResult | null {
  if (!request.destination) return null
  let url: URL
  try {
    url = new URL(request.destination.url)
  } catch {
    return lifecycleBlocked('security_violation', 'Destination URL parsing failed.')
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
    return lifecycleBlocked('security_violation', 'Destination URLs must not contain credentials, query parameters, or fragments.')
  }
  return null
}

async function writeReceipt(
  tx: Tx,
  workspaceId: string,
  request: Request,
  requestFingerprint: string,
  result: CompleteCaptureManuallyResult,
  createdAt: string,
) {
  await tx.insert(captureResolutionCommandReceipts).values({
    workspaceId,
    idempotencyKey: request.idempotencyKey,
    operation: 'complete',
    requestFingerprint,
    requestSnapshotJson: receiptSnapshot(request, requestFingerprint),
    resultJson: JSON.stringify(result),
    createdAt,
  })
}

async function readReceipt(tx: Tx, workspaceId: string, operation: 'complete', idempotencyKey: string) {
  const [row] = await tx.select().from(captureResolutionCommandReceipts).where(and(
    eq(captureResolutionCommandReceipts.workspaceId, workspaceId),
    eq(captureResolutionCommandReceipts.operation, operation),
    eq(captureResolutionCommandReceipts.idempotencyKey, idempotencyKey),
  )).limit(1)
  return row
}

function parseResult(value: string): CompleteCaptureManuallyResult {
  return completeCaptureManuallyResultSchema.parse(JSON.parse(value))
}

function effectiveIdentities(request: Request): Array<Request['externalIdentities'][number]> {
  const identities = [...request.externalIdentities]
  if (request.destination?.class !== 'employer_or_ats') return identities
  const destination = new URL(request.destination.url)
  const canonical = destination.toString()
  const hasCanonical = identities.some((identity) =>
    identity.kind === 'canonical_destination' && identity.value === canonical)
  if (!hasCanonical) {
    identities.push({
      kind: 'canonical_destination', provider: destination.host.toLowerCase(),
      account: destination.host.toLowerCase(), value: canonical, strength: 'strong',
    })
  }
  return identities
}

function promotionInput(
  workspaceId: string,
  request: Request,
  jobId: string,
  externalIdentities = effectiveIdentities(request),
) {
  return {
    workspaceId,
    captureId: request.captureId,
    jobId,
    actor: request.actor,
    evidenceReferences: request.evidenceReferences,
    externalIdentities,
  }
}

function receiptSnapshot(request: Request, requestFingerprint: string): string {
  const companyResolution = request.companyResolution.action === 'create_local'
    ? {
      action: 'create_local',
      displayName: request.companyResolution.displayName,
      websiteUrl: redactUrl(request.companyResolution.websiteUrl ?? null),
    }
    : {
      action: 'use_local', companyId: request.companyResolution.companyId,
      expectedCompanyRevision: request.companyResolution.expectedCompanyRevision,
      restoreIfArchived: request.companyResolution.restoreIfArchived,
    }
  return JSON.stringify({
    captureId: request.captureId,
    expectedCaptureRevision: request.expectedCaptureRevision,
    expectedGenerationId: request.expectedGenerationId,
    companyResolution,
    destination: request.destination ? {
      class: request.destination.class, url: redactUrl(request.destination.url),
    } : null,
    requestFingerprint,
  })
}

function redactUrl(value: string | null): string | null {
  if (!value) return null
  const url = new URL(value)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.toString()
}

function completionAction(issueJson: string | null | undefined): boolean {
  if (!issueJson || issueJson.length > 4_096) return false
  try {
    const issue = processingIssueSchema.safeParse(JSON.parse(issueJson))
    return issue.success && issue.data.action === 'complete_job_information'
  } catch {
    return false
  }
}

function sameFacts(existing: string, request: unknown) {
  try { return stableJson(JSON.parse(existing)) === stableJson(request) } catch { return false }
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
