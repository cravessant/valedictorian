/**
 * In-process lifecycle facade (#304, task 4).
 *
 * `createLocalLifecycleMethods(database, { workspaceId, now })` is the single in-process
 * transport that mirrors sparxie's `createLifecycleHttpMethods`. Both the local HTTP routes
 * (server side) and the rewired local client (in-process) compose it. Each method:
 *   1. validates the contract input via the sparxie input schema,
 *   2. composes the Stage-2 service / removal orchestration (writes) or the read-model (reads),
 *   3. maps the result through the Stage-3 DTOs into the strict sparxie contract shape.
 *
 * It owns NO policy and reimplements no aggregate write. Reads populate presentation-only fields
 * (e.g. a blocked removal's `dependentIds`) — the ownership scanner tracks writes, not reads.
 *
 * Result convention (mirrors the typed HTTP client):
 *   - reads return the contract value; `get` returns null on a miss;
 *   - a policy block returns a 200 `blocked` contract body;
 *   - existence/concurrency/validation failures raise `LifecycleHttpError` (404/409/400) exactly
 *     as the typed HTTP client raises `ValedictorianHttpError`. The routes render `{status, body}`
 *     from it; the in-process client lets it propagate.
 *
 * Aggregate coverage grows per the ratified sequencing: captures first, then jobs, then
 * opportunities/applications and the promotions.
 */
import { and, eq, isNull } from 'drizzle-orm'
import {
  addJobExternalIdentityInputSchema,
  captureListInputSchema,
  correctCaptureInputSchema,
  correctJobFactsInputSchema,
  createCaptureInputSchema,
  createJobInputSchema,
  historyListInputSchema,
  jobHistoryInputSchema,
  jobListInputSchema,
  createOpportunityInputSchema,
  opportunityHistoryInputSchema,
  opportunityListInputSchema,
  promoteCaptureToJobInputSchema,
  promoteJobToOpportunityInputSchema,
  promoteOpportunityToApplicationInputSchema,
  updateOpportunityDispositionInputSchema,
  updateOpportunityEvaluationInputSchema,
  removalInputSchema,
  removeJobExternalIdentityInputSchema,
  removeJobInputSchema,
  restoreInputSchema,
  restoreJobInputSchema,
  updateJobAvailabilityInputSchema,
  createApplicationInputSchema,
  lifecycleApplicationListInputSchema,
  updateApplicationCompanyInputSchema,
  updateApplicationSourceInputSchema,
  updatePursuitApplicationStatusInputSchema,
  createPursuitLinkInputSchema,
  updatePursuitLinkInputSchema,
  removePursuitLinkInputSchema,
  refreshApplicationSnapshotInputSchema,
  applicationTechnicalListInputSchema,
  type Capture,
  type CaptureHistoryResult,
  type CaptureListResult,
  type CaptureMutationResult,
  type Job,
  type JobHistoryResult,
  type JobListResult,
  type JobMutationResult,
  type LifecycleWorkspaceClient,
  type Application,
  type ApplicationMutationResult,
  type ApplicationAttemptsListResult,
  type ApplicationEventsListResult,
  type LifecycleApplicationHistoryResult,
  type LifecycleApplicationListResult,
  type Opportunity,
  type OpportunityHistoryResult,
  type OpportunityListResult,
  type OpportunityMutationResult,
  type PromoteCaptureToJobResult,
  type PromoteJobToOpportunityResult,
  type PromoteOpportunityToApplicationResult,
  type RemovalResult,
  type RestoreResult,
} from 'sparxie'
import type { PgliteDatabase } from '../db/pglite'
import {
  createPgliteCaptureService,
  type AcceptCaptureInput,
  type CaptureActor,
  type CaptureFailure,
  type CorrectCaptureInput as ServiceCorrectCaptureInput,
  type JsonValue,
} from '../modules/capture/capture.service'
import { createPgliteCaptureReadModel } from '../modules/capture/capture.read-model'
import { createPgliteJobService } from '../modules/job/job.service'
import { createPgliteJobReadModel } from '../modules/job/job.read-model'
import { createPgliteJobIdentityService } from '../modules/job/job.identity'
import { createLifecycleJobOrchestration, type JobWriteFailure } from '../modules/lifecycle/job.orchestration'
import { createLifecycleApplicationOrchestration, type ApplicationWriteFailure } from '../modules/lifecycle/application.orchestration'
import { createPgliteJobPromotion } from '../modules/lifecycle/capture-to-job.promotion'
import { createPgliteJobToOpportunityPromotion } from '../modules/lifecycle/job-to-opportunity.promotion'
import { createPgliteOpportunityService } from '../modules/opportunity/opportunity.service'
import { createPgliteOpportunityReadModel } from '../modules/opportunity/opportunity.read-model'
import { createPgliteApplicationAggregateService } from '../modules/applications/application.aggregate.service'
import { createPgliteApplicationReadModel } from '../modules/applications/application.read-model'
import { createPgliteOpportunityToApplicationPromotion } from '../modules/lifecycle/opportunity-to-application.promotion'
import {
  createLifecycleRemovalOrchestration,
  type LifecycleActor,
  type RemoveLifecycleResult,
  type RestoreLifecycleResult,
} from '../modules/lifecycle/removal.orchestration'
import { toContractActor } from '../modules/lifecycle/lifecycle-audit.dto'
import {
  classifyMutationFailure,
  toBlockedMutationResult,
  toSucceededMutationResult,
} from '../modules/lifecycle/mutation.dto'
import {
  classifyRemovalFailure,
  toBlockedRemovalResult,
  toBlockedRestoreResult,
  toRemovedResult,
  toRestoredResult,
} from '../modules/lifecycle/removal.dto'
import {
  classifyPromotionFailure,
  toBlockedPromotionResult,
  toPromotedResult,
} from '../modules/lifecycle/promotion.dto'
import type { MutationBlocked } from '../modules/lifecycle/mutation.dto'
import { jobs as jobRows, jobCaptureEvidenceReferences } from '../modules/job/job.schema'
import { opportunities as opportunityRows } from '../modules/opportunity/opportunity.schema'
import {
  applications as applicationRows,
  pursuitLinks,
  applicationEventRecords,
  applicationAttemptRecords,
} from '../modules/application/application.schema'

/**
 * A composition-boundary transport error. The routes map it to an HTTP `{status, body}`; the
 * in-process client lets it propagate (matching the typed HTTP client's `ValedictorianHttpError`).
 * Bodies are fixed and generic so no internal detail leaks across the boundary.
 */
export class LifecycleHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`lifecycle_http_error_${status}`)
    this.name = 'LifecycleHttpError'
  }
}

const VALIDATION_BODY = Object.freeze({ message: 'The request is invalid.' })
const NOT_FOUND_BODY = Object.freeze({ message: 'The requested resource was not found.' })
const CONFLICT_BODY = Object.freeze({ message: 'The request conflicts with the current state.' })
const INTERNAL_BODY = Object.freeze({ message: 'The request could not be completed.' })

/** The synthesized actor for adapter-driven capture ingestion (the contract create carries none). */
const SYSTEM_ACTOR: CaptureActor = { type: 'system' }

function errorBodyFor(status: number): unknown {
  if (status === 404) return NOT_FOUND_BODY
  if (status === 409) return CONFLICT_BODY
  return VALIDATION_BODY
}

/** Parse a contract input via its sparxie schema; a malformed input is a typed 400. */
function parseInput<T>(schema: { parse(value: unknown): T }, input: unknown): T {
  try {
    return schema.parse(input)
  } catch {
    throw new LifecycleHttpError(400, VALIDATION_BODY)
  }
}

export interface LocalLifecycleMethodsOptions {
  readonly workspaceId: string
  readonly now?: () => Date
}

/** The aggregate surface implemented so far (captures + jobs + opportunities + applications). */
export type LocalLifecycleMethods = Pick<LifecycleWorkspaceClient, 'captures' | 'jobs' | 'opportunities' | 'applications'>

export function createLocalLifecycleMethods(
  database: PgliteDatabase,
  options: LocalLifecycleMethodsOptions,
): LocalLifecycleMethods {
  const { workspaceId } = options
  const now = options.now ?? (() => new Date())
  const nowIso = () => now().toISOString()

  const captureService = createPgliteCaptureService(database, { now })
  const jobService = createPgliteJobService(database, { now })
  const jobIdentityService = createPgliteJobIdentityService(database, { now })
  const opportunityService = createPgliteOpportunityService(database, { now })
  const applicationService = createPgliteApplicationAggregateService(database, { now })
  const captureReadModel = createPgliteCaptureReadModel(database)
  const jobReadModel = createPgliteJobReadModel(database)
  const opportunityReadModel = createPgliteOpportunityReadModel(database)
  const applicationReadModel = createPgliteApplicationReadModel(database)
  const jobOrchestration = createLifecycleJobOrchestration(database, { jobService, jobIdentityService, now })
  const applicationOrchestration = createLifecycleApplicationOrchestration(database, { applicationService }, { now })
  const capturePromotion = createPgliteJobPromotion(database, captureService, jobService, { now, jobIdentityService })
  const jobPromotion = createPgliteJobToOpportunityPromotion(database, opportunityService, { now })
  const opportunityPromotion = createPgliteOpportunityToApplicationPromotion(database, {
    captureService,
    jobService,
    opportunityService,
    applicationService,
  }, { now })
  const orchestration = createLifecycleRemovalOrchestration(database, {
    captureService,
    jobService,
    opportunityService,
    applicationService,
  })

  /** The contract actor carries an optional displayName; the domain write path uses type+id. */
  function toDomainActor(actor: { id: string; type: LifecycleActor['type'] }): { type: LifecycleActor['type']; id: string } {
    return { type: actor.type, id: actor.id }
  }

  function toOrchestrationActor(actor: { id: string; type: LifecycleActor['type'] }): LifecycleActor {
    return { type: actor.type, id: actor.id }
  }

  /** Map a Stage-2 mutation failure onto the contract surface: a policy block is a 200 body;
   * existence/concurrency/validation failures raise a typed HTTP error. */
  function mutationFailureToBlockedOrThrow(failure: CaptureFailure): CaptureMutationResult {
    const classified = classifyMutationFailure(failure.code)
    if (classified.surface === 'blocked') {
      return toBlockedMutationResult({ code: classified.code, message: failure.message })
    }
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  /** Active immediate dependents of a capture (jobs whose evidence references it). Read-only. */
  async function activeDependentJobIds(captureId: string): Promise<string[]> {
    const rows = await database
      .select({ jobId: jobCaptureEvidenceReferences.jobId })
      .from(jobCaptureEvidenceReferences)
      .innerJoin(jobRows, eq(jobRows.id, jobCaptureEvidenceReferences.jobId))
      .where(and(eq(jobCaptureEvidenceReferences.captureId, captureId), isNull(jobRows.removedAt)))
    return [...new Set(rows.map((row) => row.jobId))]
  }

  async function renderCaptureRemoval(
    result: RemoveLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RemovalResult> {
    if (result.ok) {
      const head = await captureReadModel.getCapture(workspaceId, id)
      return toRemovedResult(result, { removedAt: head?.removedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') {
      return toBlockedRemovalResult({
        id,
        message: 'removal blocked by active dependents',
        dependentIds: await activeDependentJobIds(id),
      })
    }
    if (classified.surface === 'not_found') {
      throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    }
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  async function renderCaptureRestore(
    result: RestoreLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RestoreResult> {
    if (result.ok) {
      const head = await captureReadModel.getCapture(workspaceId, id)
      return toRestoredResult(result, { restoredAt: head?.updatedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') {
      return toBlockedRestoreResult({ id, message: 'restore blocked' })
    }
    if (classified.surface === 'not_found') {
      throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    }
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  /** Active immediate dependents of a job (opportunities projecting it). Read-only. */
  async function activeDependentOpportunityIds(jobId: string): Promise<string[]> {
    const rows = await database
      .select({ id: opportunityRows.id })
      .from(opportunityRows)
      .where(and(eq(opportunityRows.jobId, jobId), isNull(opportunityRows.removedAt)))
    return [...new Set(rows.map((row) => row.id))]
  }

  async function renderJobRemoval(
    result: RemoveLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RemovalResult> {
    if (result.ok) {
      const head = await jobReadModel.getJob(workspaceId, id)
      return toRemovedResult(result, { removedAt: head?.removedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') {
      return toBlockedRemovalResult({
        id,
        message: 'removal blocked by active dependents',
        dependentIds: await activeDependentOpportunityIds(id),
      })
    }
    if (classified.surface === 'not_found') throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  async function renderJobRestore(
    result: RestoreLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RestoreResult> {
    if (result.ok) {
      const head = await jobReadModel.getJob(workspaceId, id)
      return toRestoredResult(result, { restoredAt: head?.updatedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') return toBlockedRestoreResult({ id, message: 'restore blocked' })
    if (classified.surface === 'not_found') throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  /** Map a Job write-orchestration failure onto the mutation surface: a policy block is a 200
   * blocked body; existence/concurrency raise a typed HTTP error (never reached on success). */
  function jobWriteFailureToBlockedOrThrow(failure: JobWriteFailure): JobMutationResult {
    const classified = classifyMutationFailure(failure.code)
    if (classified.surface === 'blocked') {
      return toBlockedMutationResult({
        code: classified.code,
        message: failure.message,
        field: failure.field,
        conflictingResourceId: failure.conflictingResourceId,
        allowedDuplicateResolutions: failure.allowedDuplicateResolutions,
      })
    }
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  /** Read the just-written Job resource; a missing resource after a successful write is internal. */
  async function requireJobResource(jobId: string): Promise<Job> {
    const resource = await jobReadModel.getJob(workspaceId, jobId)
    if (!resource) throw new LifecycleHttpError(500, INTERNAL_BODY)
    return resource
  }

  async function requireApplicationResource(applicationId: string): Promise<Application> {
    const resource = await applicationReadModel.getApplication(workspaceId, applicationId)
    if (!resource) throw new LifecycleHttpError(500, INTERNAL_BODY)
    return resource
  }

  /** Active immediate dependents of an opportunity (applications pursuing it). Read-only. */
  async function activeDependentApplicationIds(opportunityId: string): Promise<string[]> {
    const rows = await database
      .select({ id: applicationRows.id })
      .from(applicationRows)
      .where(and(eq(applicationRows.opportunityId, opportunityId), isNull(applicationRows.removedAt)))
    return [...new Set(rows.map((row) => row.id))]
  }

  /** The active opportunity for a job (the deterministic-duplicate conflict target on create). */
  async function activeOpportunityForJob(jobId: string): Promise<string | null> {
    const [row] = await database
      .select({ id: opportunityRows.id })
      .from(opportunityRows)
      .where(and(eq(opportunityRows.jobId, jobId), isNull(opportunityRows.removedAt)))
      .limit(1)
    return row?.id ?? null
  }

  async function renderOpportunityRemoval(
    result: RemoveLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RemovalResult> {
    if (result.ok) {
      const head = await opportunityReadModel.getOpportunity(workspaceId, id)
      return toRemovedResult(result, { removedAt: head?.removedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') {
      return toBlockedRemovalResult({
        id,
        message: 'removal blocked by active dependents',
        dependentIds: await activeDependentApplicationIds(id),
      })
    }
    if (classified.surface === 'not_found') throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  async function renderOpportunityRestore(
    result: RestoreLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RestoreResult> {
    if (result.ok) {
      const head = await opportunityReadModel.getOpportunity(workspaceId, id)
      return toRestoredResult(result, { restoredAt: head?.updatedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') return toBlockedRestoreResult({ id, message: 'restore blocked' })
    if (classified.surface === 'not_found') throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  /**
   * Map an Opportunity write failure onto the mutation surface. A `deterministic_duplicate`
   * carries the conflicting opportunity id + the attach/merge resolutions the blocker schema
   * requires; every other blocker code is a plain 200 blocked body; existence/concurrency raise.
   */
  async function opportunityWriteFailureToBlockedOrThrow(
    failure: { code: string; message: string },
    context: { jobId?: string } = {},
  ): Promise<OpportunityMutationResult> {
    const classified = classifyMutationFailure(failure.code)
    if (classified.surface === 'blocked') {
      if (classified.code === 'deterministic_duplicate') {
        const conflicting = context.jobId ? (await activeOpportunityForJob(context.jobId)) ?? undefined : undefined
        return toBlockedMutationResult({
          code: 'deterministic_duplicate',
          message: failure.message,
          conflictingResourceId: conflicting,
          allowedDuplicateResolutions: ['attach', 'merge'],
        })
      }
      return toBlockedMutationResult({ code: classified.code, message: failure.message })
    }
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  const captures: LocalLifecycleMethods['captures'] = {
    async list(input = {}): Promise<CaptureListResult> {
      return captureReadModel.listCaptures(workspaceId, parseInput(captureListInputSchema, input))
    },

    async get(captureId): Promise<Capture | null> {
      return captureReadModel.getCapture(workspaceId, captureId)
    },

    async create(input): Promise<CaptureMutationResult> {
      const parsed = parseInput(createCaptureInputSchema, input)
      const accept: AcceptCaptureInput = {
        workspaceId,
        provenance: {
          adapterId: parsed.adapter.id,
          adapterKind: parsed.adapter.kind,
          adapterVersion: parsed.adapter.version,
          providerRecordId: parsed.providerRecordId,
          providerSchema: parsed.providerSchema,
          observedAt: parsed.observedAt,
        },
        evidenceMode: parsed.evidenceMode,
        evidence: parsed.evidence as AcceptCaptureInput['evidence'],
        payload: parsed.payload as JsonValue | null,
        actor: SYSTEM_ACTOR,
      }
      const result = await captureService.accept(accept)
      if (!result.ok) return mutationFailureToBlockedOrThrow(result)
      const resource = await captureReadModel.getCapture(workspaceId, result.capture.id)
      if (!resource) throw new LifecycleHttpError(500, INTERNAL_BODY)
      return toSucceededMutationResult(resource, {
        actor: SYSTEM_ACTOR,
        timestamp: result.capture.updatedAt,
      })
    },

    async correct(input): Promise<CaptureMutationResult> {
      const parsed = parseInput(correctCaptureInputSchema, input)
      const correct: ServiceCorrectCaptureInput = {
        workspaceId,
        captureId: parsed.captureId,
        correction: parsed.correction as JsonValue,
        actor: { type: parsed.actor.type, id: parsed.actor.id },
        expectedRevision: parsed.expectedRevision,
      }
      const result = await captureService.correct(correct)
      if (!result.ok) return mutationFailureToBlockedOrThrow(result)
      const resource = await captureReadModel.getCapture(workspaceId, parsed.captureId)
      if (!resource) throw new LifecycleHttpError(500, INTERNAL_BODY)
      return toSucceededMutationResult(resource, {
        actor: { type: parsed.actor.type, id: parsed.actor.id, displayName: parsed.actor.displayName },
        timestamp: result.capture.updatedAt,
      })
    },

    async remove(input): Promise<RemovalResult> {
      const parsed = parseInput(removalInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.remove({
        workspaceId,
        aggregate: 'capture',
        resourceId: parsed.id,
        choice: parsed.choice,
        actor,
      })
      return renderCaptureRemoval(result, parsed.id, actor)
    },

    async restore(input): Promise<RestoreResult> {
      const parsed = parseInput(restoreInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.restore({
        workspaceId,
        aggregate: 'capture',
        resourceId: parsed.id,
        actor,
      })
      return renderCaptureRestore(result, parsed.id, actor)
    },

    async history(input): Promise<CaptureHistoryResult> {
      return captureReadModel.historyCaptures(workspaceId, parseInput(historyListInputSchema, input))
    },

    async promoteToJob(input): Promise<PromoteCaptureToJobResult> {
      const parsed = parseInput(promoteCaptureToJobInputSchema, input)
      const result = await capturePromotion.promoteCapture({
        workspaceId,
        captureId: parsed.captureId,
        actor: toDomainActor(parsed.actor),
        idempotencyKey: parsed.idempotencyKey,
        selectedFacts: parsed.selectedFacts as unknown as JsonValue,
        captureRevision: parsed.captureRevision,
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution,
      })
      if (!('ok' in result) || !result.ok) {
        return promotionFailureToBlockedOrThrow(result)
      }
      const resource = await requireJobResource(result.jobId)
      return toPromotedResult(resource, {
        created: result.created,
        actor: parsed.actor,
        timestamp: nowIso(),
        warnings: result.warnings,
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution ?? null,
      })
    },
  }

  /** Map a promotion domain failure onto the shared `blocked` body (or a typed HTTP error). The
   * blocked branch is identical across all promotion results, so it satisfies each result type. */
  function promotionFailureToBlockedOrThrow(failure: { code: string; message: string }): MutationBlocked {
    const classified = classifyPromotionFailure(failure.code)
    if (classified.surface === 'blocked') {
      return toBlockedPromotionResult({ code: classified.code, message: failure.message })
    }
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  const jobs: LocalLifecycleMethods['jobs'] = {
    async list(input = {}): Promise<JobListResult> {
      return jobReadModel.listJobs(workspaceId, parseInput(jobListInputSchema, input))
    },

    async get(jobId): Promise<Job | null> {
      return jobReadModel.getJob(workspaceId, jobId)
    },

    async create(input): Promise<JobMutationResult> {
      const parsed = parseInput(createJobInputSchema, input)
      const outcome = await jobOrchestration.createJob({
        workspaceId,
        actor: toDomainActor(parsed.actor),
        facts: parsed.facts as unknown as JsonValue,
        availability: parsed.availability,
        idempotencyKey: parsed.idempotencyKey,
        evidenceReferences: parsed.evidenceReferences,
        externalIdentities: parsed.externalIdentities,
        duplicateResolution: parsed.duplicateResolution,
      })
      if (!outcome.ok) return jobWriteFailureToBlockedOrThrow(outcome.failure)
      const resource = await requireJobResource(outcome.jobId)
      return toSucceededMutationResult(resource, {
        actor: parsed.actor,
        timestamp: outcome.timestamp,
        duplicateResolution: parsed.duplicateResolution ?? null,
        audit: parsed.override ? { override: parsed.override } : undefined,
      })
    },

    async correctFacts(input): Promise<JobMutationResult> {
      const parsed = parseInput(correctJobFactsInputSchema, input)
      const outcome = await jobOrchestration.correctFacts({
        workspaceId,
        jobId: parsed.jobId,
        actor: toDomainActor(parsed.actor),
        facts: parsed.facts as unknown as JsonValue,
        expectedFactsRevision: parsed.expectedFactsRevision,
        evidenceReferences: parsed.evidenceReferences,
      })
      if (!outcome.ok) return jobWriteFailureToBlockedOrThrow(outcome.failure)
      return toSucceededMutationResult(await requireJobResource(outcome.jobId), {
        actor: parsed.actor,
        timestamp: outcome.timestamp,
      })
    },

    async updateAvailability(input): Promise<JobMutationResult> {
      const parsed = parseInput(updateJobAvailabilityInputSchema, input)
      const outcome = await jobOrchestration.updateAvailability({
        workspaceId,
        jobId: parsed.jobId,
        actor: toDomainActor(parsed.actor),
        state: parsed.availability.state,
        observedAt: parsed.availability.observedAt,
        expectedAvailabilityRevision: parsed.expectedAvailabilityRevision,
        evidenceReferences: parsed.evidenceReferences,
      })
      if (!outcome.ok) return jobWriteFailureToBlockedOrThrow(outcome.failure)
      return toSucceededMutationResult(await requireJobResource(outcome.jobId), {
        actor: parsed.actor,
        timestamp: outcome.timestamp,
      })
    },

    externalIdentities: {
      async add(input): Promise<JobMutationResult> {
        const parsed = parseInput(addJobExternalIdentityInputSchema, input)
        const outcome = await jobOrchestration.addExternalIdentity({
          workspaceId,
          jobId: parsed.jobId,
          actor: toDomainActor(parsed.actor),
          identity: parsed.identity,
        })
        if (!outcome.ok) return jobWriteFailureToBlockedOrThrow(outcome.failure)
        return toSucceededMutationResult(await requireJobResource(outcome.jobId), {
          actor: parsed.actor,
          timestamp: outcome.timestamp,
        })
      },

      async remove(input): Promise<JobMutationResult> {
        const parsed = parseInput(removeJobExternalIdentityInputSchema, input)
        const outcome = await jobOrchestration.removeExternalIdentity({
          workspaceId,
          jobId: parsed.jobId,
          actor: toDomainActor(parsed.actor),
          identity: parsed.identity,
        })
        if (!outcome.ok) return jobWriteFailureToBlockedOrThrow(outcome.failure)
        return toSucceededMutationResult(await requireJobResource(outcome.jobId), {
          actor: parsed.actor,
          timestamp: outcome.timestamp,
        })
      },
    },

    async remove(input): Promise<RemovalResult> {
      const parsed = parseInput(removeJobInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.remove({
        workspaceId,
        aggregate: 'job',
        resourceId: parsed.id,
        choice: parsed.choice,
        actor,
      })
      return renderJobRemoval(result, parsed.id, actor)
    },

    async restore(input): Promise<RestoreResult> {
      const parsed = parseInput(restoreJobInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.restore({
        workspaceId,
        aggregate: 'job',
        resourceId: parsed.id,
        actor,
      })
      return renderJobRestore(result, parsed.id, actor)
    },

    async history(input): Promise<JobHistoryResult> {
      const parsed = parseInput(jobHistoryInputSchema, input)
      return jobReadModel.historyJobs(workspaceId, { id: parsed.id, limit: parsed.limit, cursor: parsed.cursor })
    },

    async promoteToOpportunity(input): Promise<PromoteJobToOpportunityResult> {
      const parsed = parseInput(promoteJobToOpportunityInputSchema, input)
      const result = await jobPromotion.promoteJob({
        workspaceId,
        jobId: parsed.jobId,
        actor: toDomainActor(parsed.actor),
        idempotencyKey: parsed.idempotencyKey,
        evaluation: {
          fit: parsed.evaluation.fit,
          rank: parsed.evaluation.rank,
          cutoff: parsed.evaluation.cutoff,
          disposition: parsed.evaluation.disposition,
        },
        expectedJobFactsRevision: parsed.expectedFactsRevision,
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution,
      })
      if (!('ok' in result) || !result.ok) {
        return promotionFailureToBlockedOrThrow(result)
      }
      const resource = await requireOpportunityResource(result.opportunityId)
      return toPromotedResult(resource, {
        created: result.created,
        actor: parsed.actor,
        timestamp: nowIso(),
        warnings: result.warnings,
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution ?? null,
      })
    },
  }

  async function requireOpportunityResource(opportunityId: string): Promise<Opportunity> {
    const resource = await opportunityReadModel.getOpportunity(workspaceId, opportunityId)
    if (!resource) throw new LifecycleHttpError(500, INTERNAL_BODY)
    return resource
  }

  const opportunities: LocalLifecycleMethods['opportunities'] = {
    async list(input = {}): Promise<OpportunityListResult> {
      return opportunityReadModel.listOpportunities(workspaceId, parseInput(opportunityListInputSchema, input))
    },

    async get(opportunityId): Promise<Opportunity | null> {
      return opportunityReadModel.getOpportunity(workspaceId, opportunityId)
    },

    async create(input): Promise<OpportunityMutationResult> {
      const parsed = parseInput(createOpportunityInputSchema, input)
      const result = await opportunityService.create({
        workspaceId,
        jobId: parsed.jobId,
        evaluation: { fit: parsed.fit, rank: parsed.rank, cutoff: parsed.cutoff },
        disposition: parsed.disposition,
        actor: toDomainActor(parsed.actor),
        idempotencyKey: parsed.idempotencyKey,
        expectedJobFactsRevision: parsed.expectedJobFactsRevision,
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution,
      })
      if (!result.ok) return opportunityWriteFailureToBlockedOrThrow(result, { jobId: parsed.jobId })
      return toSucceededMutationResult(await requireOpportunityResource(result.opportunity.id), {
        actor: parsed.actor,
        timestamp: result.opportunity.updatedAt,
        duplicateResolution: parsed.duplicateResolution ?? null,
        audit: parsed.override ? { override: parsed.override } : undefined,
      })
    },

    async updateEvaluation(input): Promise<OpportunityMutationResult> {
      const parsed = parseInput(updateOpportunityEvaluationInputSchema, input)
      const result = await opportunityService.correct({
        workspaceId,
        opportunityId: parsed.opportunityId,
        fit: parsed.fit,
        rank: parsed.rank,
        cutoff: parsed.cutoff,
        actor: toDomainActor(parsed.actor),
        expectedRevision: parsed.expectedRevision,
        override: parsed.override,
      })
      if (!result.ok) return opportunityWriteFailureToBlockedOrThrow(result)
      return toSucceededMutationResult(await requireOpportunityResource(result.opportunity.id), {
        actor: parsed.actor,
        timestamp: result.opportunity.updatedAt,
        audit: parsed.override ? { override: parsed.override } : undefined,
      })
    },

    async updateDisposition(input): Promise<OpportunityMutationResult> {
      const parsed = parseInput(updateOpportunityDispositionInputSchema, input)
      const result = await opportunityService.setDisposition({
        workspaceId,
        opportunityId: parsed.opportunityId,
        disposition: parsed.disposition,
        rationale: parsed.rationale,
        actor: toDomainActor(parsed.actor),
        expectedRevision: parsed.expectedRevision,
        override: parsed.override,
      })
      if (!result.ok) return opportunityWriteFailureToBlockedOrThrow(result)
      return toSucceededMutationResult(await requireOpportunityResource(result.opportunity.id), {
        actor: parsed.actor,
        timestamp: result.opportunity.updatedAt,
        audit: parsed.override ? { override: parsed.override } : undefined,
      })
    },

    async remove(input): Promise<RemovalResult> {
      const parsed = parseInput(removalInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.remove({ workspaceId, aggregate: 'opportunity', resourceId: parsed.id, choice: parsed.choice, actor })
      return renderOpportunityRemoval(result, parsed.id, actor)
    },

    async restore(input): Promise<RestoreResult> {
      const parsed = parseInput(restoreInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.restore({ workspaceId, aggregate: 'opportunity', resourceId: parsed.id, actor })
      return renderOpportunityRestore(result, parsed.id, actor)
    },

    async history(input): Promise<OpportunityHistoryResult> {
      const parsed = parseInput(opportunityHistoryInputSchema, input)
      return opportunityReadModel.historyOpportunities(workspaceId, { id: parsed.id, limit: parsed.limit, cursor: parsed.cursor })
    },

    async promoteToApplication(input): Promise<PromoteOpportunityToApplicationResult> {
      const parsed = parseInput(promoteOpportunityToApplicationInputSchema, input)
      const result = await opportunityPromotion.promoteOpportunity({
        workspaceId,
        opportunityId: parsed.opportunityId,
        actor: toDomainActor(parsed.actor),
        idempotencyKey: parsed.idempotencyKey,
        expectedJobId: parsed.expectedJobId,
        links: parsed.initialLinks?.map((link) => ({ kind: link.kind, label: link.label, url: link.url, isPrimary: false })),
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution,
      })
      if (!('ok' in result) || !result.ok) {
        return promotionFailureToBlockedOrThrow(result)
      }
      return toPromotedResult(await requireApplicationResource(result.applicationId), {
        created: result.created,
        actor: parsed.actor,
        timestamp: nowIso(),
        warnings: result.warnings,
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution ?? null,
      })
    },
  }

  // --- Applications vertical (#304, item 3c) ---

  /** Active immediate child dependents of an application (its own links/events/attempts). Read-only. */
  async function activeDependentChildIds(applicationId: string): Promise<string[]> {
    const [links, events, attempts] = await Promise.all([
      database.select({ id: pursuitLinks.id }).from(pursuitLinks).where(eq(pursuitLinks.applicationId, applicationId)),
      database.select({ id: applicationEventRecords.id }).from(applicationEventRecords).where(eq(applicationEventRecords.applicationId, applicationId)),
      database.select({ id: applicationAttemptRecords.id }).from(applicationAttemptRecords).where(eq(applicationAttemptRecords.applicationId, applicationId)),
    ])
    return [...links, ...events, ...attempts].map((row) => row.id)
  }

  /** The active application for an opportunity (the deterministic-duplicate conflict target on create). */
  async function activeApplicationForOpportunity(opportunityId: string): Promise<string | null> {
    const [row] = await database
      .select({ id: applicationRows.id })
      .from(applicationRows)
      .where(and(eq(applicationRows.opportunityId, opportunityId), isNull(applicationRows.removedAt)))
      .limit(1)
    return row?.id ?? null
  }

  async function renderApplicationRemoval(
    result: RemoveLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RemovalResult> {
    if (result.ok) {
      const head = await applicationReadModel.getApplication(workspaceId, id)
      return toRemovedResult(result, { removedAt: head?.removedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') {
      return toBlockedRemovalResult({
        id,
        message: 'removal blocked by active dependents',
        dependentIds: await activeDependentChildIds(id),
      })
    }
    if (classified.surface === 'not_found') throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  async function renderApplicationRestore(
    result: RestoreLifecycleResult,
    id: string,
    actor: LifecycleActor,
  ): Promise<RestoreResult> {
    if (result.ok) {
      const head = await applicationReadModel.getApplication(workspaceId, id)
      return toRestoredResult(result, { restoredAt: head?.updatedAt ?? nowIso(), actor: toContractActor(actor) })
    }
    const classified = classifyRemovalFailure(result)
    if (classified.surface === 'blocked') return toBlockedRestoreResult({ id, message: 'restore blocked' })
    if (classified.surface === 'not_found') throw new LifecycleHttpError(404, NOT_FOUND_BODY)
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  /**
   * Map an Application create failure onto the mutation surface. A `deterministic_duplicate`
   * carries the conflicting application id + the attach/merge resolutions; every other blocker
   * code is a plain 200 blocked body; existence/concurrency raise a typed HTTP error.
   */
  async function applicationWriteFailureToBlockedOrThrow(
    failure: ApplicationWriteFailure,
    context: { opportunityId?: string } = {},
  ): Promise<ApplicationMutationResult> {
    const classified = classifyMutationFailure(failure.code)
    if (classified.surface === 'blocked') {
      if (classified.code === 'deterministic_duplicate') {
        const conflicting = context.opportunityId ? (await activeApplicationForOpportunity(context.opportunityId)) ?? undefined : undefined
        return toBlockedMutationResult({
          code: 'deterministic_duplicate',
          message: failure.message,
          conflictingResourceId: conflicting,
          allowedDuplicateResolutions: ['attach', 'merge'],
        })
      }
      return toBlockedMutationResult({ code: classified.code, message: failure.message })
    }
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  /** Map an Application edit/status/link/refresh failure onto the mutation surface. */
  function applicationMutateFailureToBlockedOrThrow(failure: { code: string; message: string }): ApplicationMutationResult {
    const classified = classifyMutationFailure(failure.code)
    if (classified.surface === 'blocked') return toBlockedMutationResult({ code: classified.code, message: failure.message })
    throw new LifecycleHttpError(classified.status, errorBodyFor(classified.status))
  }

  const applications: LocalLifecycleMethods['applications'] = {
    async list(input = {}): Promise<LifecycleApplicationListResult> {
      return applicationReadModel.listApplications(workspaceId, parseInput(lifecycleApplicationListInputSchema, input))
    },

    async get(applicationId): Promise<Application | null> {
      return applicationReadModel.getApplication(workspaceId, applicationId)
    },

    async create(input): Promise<ApplicationMutationResult> {
      const parsed = parseInput(createApplicationInputSchema, input)
      const outcome = await applicationOrchestration.createApplication({
        workspaceId,
        actor: toDomainActor(parsed.actor),
        opportunityId: parsed.opportunityId,
        // Ruling 3c: the contract's create `jobId` maps to the domain's `expectedJobId` lineage guard.
        expectedJobId: parsed.jobId,
        expectedJobFactsRevision: parsed.expectedJobFactsRevision,
        idempotencyKey: parsed.idempotencyKey,
        initialLinks: parsed.initialLinks,
        override: parsed.override,
        duplicateResolution: parsed.duplicateResolution,
      })
      if (!outcome.ok) return applicationWriteFailureToBlockedOrThrow(outcome.failure, { opportunityId: parsed.opportunityId })
      return toSucceededMutationResult(await requireApplicationResource(outcome.applicationId), {
        actor: parsed.actor,
        timestamp: outcome.timestamp,
        duplicateResolution: parsed.duplicateResolution ?? null,
        audit: parsed.override ? { override: parsed.override } : undefined,
      })
    },

    async updateStatus(input): Promise<ApplicationMutationResult> {
      const parsed = parseInput(updatePursuitApplicationStatusInputSchema, input)
      // `rationale` has no domain slot on a status transition (the audit records the actor); dropped, no protocol echo.
      const result = await applicationService.transitionStatus({
        workspaceId,
        applicationId: parsed.applicationId,
        status: parsed.status,
        actor: toDomainActor(parsed.actor),
        expectedRevision: parsed.expectedRevision,
      })
      if (!result.ok) return applicationMutateFailureToBlockedOrThrow(result)
      return toSucceededMutationResult(await requireApplicationResource(result.application.id), {
        actor: parsed.actor,
        timestamp: result.application.updatedAt,
      })
    },

    async updateCompany(input): Promise<ApplicationMutationResult> {
      const parsed = parseInput(updateApplicationCompanyInputSchema, input)
      // `rationale` has no domain slot on editCompany; dropped, no protocol echo.
      const result = await applicationService.editCompany({
        workspaceId,
        applicationId: parsed.applicationId,
        companyName: parsed.companyName,
        actor: toDomainActor(parsed.actor),
        expectedRevision: parsed.expectedRevision,
      })
      if (!result.ok) return applicationMutateFailureToBlockedOrThrow(result)
      return toSucceededMutationResult(await requireApplicationResource(result.application.id), {
        actor: parsed.actor,
        timestamp: result.application.updatedAt,
      })
    },

    async updateSource(input): Promise<ApplicationMutationResult> {
      const parsed = parseInput(updateApplicationSourceInputSchema, input)
      // `rationale` has no domain slot on editSource; dropped, no protocol echo.
      const result = await applicationService.editSource({
        workspaceId,
        applicationId: parsed.applicationId,
        sourceName: parsed.sourceName,
        actor: toDomainActor(parsed.actor),
        expectedRevision: parsed.expectedRevision,
      })
      if (!result.ok) return applicationMutateFailureToBlockedOrThrow(result)
      return toSucceededMutationResult(await requireApplicationResource(result.application.id), {
        actor: parsed.actor,
        timestamp: result.application.updatedAt,
      })
    },

    links: {
      async create(input): Promise<ApplicationMutationResult> {
        const parsed = parseInput(createPursuitLinkInputSchema, input)
        // `expectedRevision` has no domain slot on the additive link core (self-consistent
        // revision bump); dropped, documented scoped reading.
        const result = await applicationService.addLink({
          workspaceId,
          applicationId: parsed.applicationId,
          link: { kind: parsed.link.kind, label: parsed.link.label, url: parsed.link.url, isPrimary: parsed.primary },
          actor: toDomainActor(parsed.actor),
        })
        if (!result.ok) return applicationMutateFailureToBlockedOrThrow(result)
        return toSucceededMutationResult(await requireApplicationResource(result.application.id), {
          actor: parsed.actor,
          timestamp: result.application.updatedAt,
        })
      },

      async update(input): Promise<ApplicationMutationResult> {
        const parsed = parseInput(updatePursuitLinkInputSchema, input)
        const result = await applicationService.updateLink({
          workspaceId,
          applicationId: parsed.applicationId,
          linkId: parsed.linkId,
          patch: { kind: parsed.link.kind, label: parsed.link.label, url: parsed.link.url, isPrimary: parsed.primary },
          actor: toDomainActor(parsed.actor),
        })
        if (!result.ok) return applicationMutateFailureToBlockedOrThrow(result)
        return toSucceededMutationResult(await requireApplicationResource(result.application.id), {
          actor: parsed.actor,
          timestamp: result.application.updatedAt,
        })
      },

      async remove(input): Promise<ApplicationMutationResult> {
        const parsed = parseInput(removePursuitLinkInputSchema, input)
        // `rationale`/`expectedRevision` have no domain slot on removeLink; dropped.
        const result = await applicationService.removeLink({
          workspaceId,
          applicationId: parsed.applicationId,
          linkId: parsed.linkId,
          actor: toDomainActor(parsed.actor),
        })
        if (!result.ok) return applicationMutateFailureToBlockedOrThrow(result)
        return toSucceededMutationResult(await requireApplicationResource(result.application.id), {
          actor: parsed.actor,
          timestamp: result.application.updatedAt,
        })
      },
    },

    async refreshSnapshot(input): Promise<ApplicationMutationResult> {
      const parsed = parseInput(refreshApplicationSnapshotInputSchema, input)
      // `rationale` has no domain slot on refreshSnapshot; dropped. The preserve flags are
      // threaded into the service (red-first extension, caller-driven reconciliation).
      const result = await applicationService.refreshSnapshot({
        workspaceId,
        applicationId: parsed.applicationId,
        actor: toDomainActor(parsed.actor),
        expectedRevision: parsed.expectedRevision,
        expectedJobFactsRevision: parsed.expectedJobFactsRevision,
        preserveCompanyEdit: parsed.preserveCompanyEdit,
        preserveSourceEdit: parsed.preserveSourceEdit,
        preserveLinkEdits: parsed.preserveLinkEdits,
      })
      if (!result.ok) return applicationMutateFailureToBlockedOrThrow(result)
      return toSucceededMutationResult(await requireApplicationResource(result.application.id), {
        actor: parsed.actor,
        timestamp: result.application.updatedAt,
      })
    },

    async remove(input): Promise<RemovalResult> {
      const parsed = parseInput(removalInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.remove({ workspaceId, aggregate: 'application', resourceId: parsed.id, choice: parsed.choice, actor })
      return renderApplicationRemoval(result, parsed.id, actor)
    },

    async restore(input): Promise<RestoreResult> {
      const parsed = parseInput(restoreInputSchema, input)
      const actor = toOrchestrationActor(parsed.actor)
      const result = await orchestration.restore({ workspaceId, aggregate: 'application', resourceId: parsed.id, actor })
      return renderApplicationRestore(result, parsed.id, actor)
    },

    async history(input): Promise<LifecycleApplicationHistoryResult> {
      const parsed = parseInput(historyListInputSchema, input)
      return applicationReadModel.historyApplications(workspaceId, { id: parsed.id, limit: parsed.limit, cursor: parsed.cursor })
    },

    attempts: {
      async list(input): Promise<ApplicationAttemptsListResult> {
        const parsed = parseInput(applicationTechnicalListInputSchema, input)
        return applicationReadModel.listAttempts(workspaceId, { applicationId: parsed.applicationId, limit: parsed.limit, cursor: parsed.cursor })
      },
    },

    events: {
      async list(input): Promise<ApplicationEventsListResult> {
        const parsed = parseInput(applicationTechnicalListInputSchema, input)
        return applicationReadModel.listEvents(workspaceId, { applicationId: parsed.applicationId, limit: parsed.limit, cursor: parsed.cursor })
      },
    },
  }

  return { captures, jobs, opportunities, applications }
}

/** Re-exported so the domain actor type is available to callers assembling audit context. */
export type { LifecycleActor }
