/**
 * Opportunity → Application promotion orchestration (issue #302).
 *
 * The explicit, idempotent, concurrency-safe lifecycle command that turns an
 * Opportunity into an Application. It owns ONE transaction per promotion and
 * COMPOSES the aggregates' public write conversations — `applicationService.createOn`
 * / `addLinkOn` / `recordEventOn`, and for the manual chain the Capture `acceptOn`,
 * Job `createOn`, the Job-owned lineage conversation, and Opportunity `createOn`.
 * This file issues no inline `.insert(table)`, so the state-ownership scanner
 * attributes every lifecycle write to its owning module; the orchestration holds no
 * aggregate ownership itself.
 *
 * Atomic single transaction (AC5): the Application row plus its initial links, event,
 * workflow state (status), and both lineage directions (Opportunity + Job references)
 * are one transaction — a typed inner failure rolls the whole thing back leaving no
 * partial Application and no orphaned links/events.
 *
 * Idempotency + duplicates (AC6): a re-promote short-circuits to the existing
 * Application via the `(workspace, opportunity)` partial unique key (attach, not a
 * new row); a cross-transaction race that loses the unique key is retried and the
 * retry attaches. Policy judgments (fit/cutoff/disposition) NEVER block promotion —
 * the promotion reads no policy state as a gate.
 *
 * Serialization: concurrent promotions of the SAME Opportunity are serialized by a
 * `SELECT ... FOR UPDATE` row lock on the Opportunity plus the unique key.
 *
 * Manual chain (AC4): `createManualApplication` atomically mints the whole
 * Capture→Job→Opportunity→Application chain by composing the #299/#300/#301 tx cores
 * inside one transaction (it duplicates none of their logic); any failure leaves no
 * partial chain.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7'
import { lifecycleOpportunities } from '../opportunity/opportunity.schema'
import { lifecycleApplications } from '../application/application.schema'
import { insertJobCaptureEvidenceReferences } from '../job/job.repository'
import type { CaptureEvidenceInput, CaptureService } from '../capture/capture.service'
import type { JobService } from '../job/job.service'
import type { OpportunityService } from '../opportunity/opportunity.service'
import type {
  AddLinkInput,
  ApplicationAggregateService,
  ApplicationActor,
  ApplicationFailure,
  ApplicationFailureCode,
  ApplicationLinkInput,
  JsonValue,
} from '../applications/application.aggregate.service'
import {
  WORKSPACE_MAX,
  fail,
  isUniqueViolation,
  requireActor,
  requireText,
  ApplicationInputError,
} from '../applications/application.aggregate.validation'

export interface OpportunityToApplicationDeps {
  readonly captureService: CaptureService
  readonly jobService: JobService
  readonly opportunityService: OpportunityService
  readonly applicationService: ApplicationAggregateService
}

export interface PromotionEventInput {
  readonly type: string
  readonly summary: string
  readonly occurredAt?: string
}

export interface PromoteOpportunityInput {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly actor: ApplicationActor
  readonly companyName?: string
  readonly sourceName?: string
  readonly scores?: JsonValue
  readonly links?: readonly ApplicationLinkInput[]
  readonly event?: PromotionEventInput
}

export interface CreateManualApplicationInput {
  readonly workspaceId: string
  readonly actor: ApplicationActor
  readonly jobFacts: JsonValue
  readonly capture: {
    readonly evidence: readonly CaptureEvidenceInput[]
    readonly evidenceMode?: 'reported' | 'ats_details_provided'
    readonly adapterId?: string
  }
  readonly companyName?: string
  readonly sourceName?: string
  readonly links?: readonly ApplicationLinkInput[]
  readonly event?: PromotionEventInput
}

export type PromotionResult =
  | {
      readonly ok: true
      readonly applicationId: string
      readonly opportunityId: string
      readonly jobId: string
      readonly attached: boolean
      readonly created: boolean
    }
  | ApplicationFailure

export type ManualApplicationResult =
  | {
      readonly ok: true
      readonly applicationId: string
      readonly opportunityId: string
      readonly jobId: string
      readonly captureId: string
    }
  | ApplicationFailure

export interface OpportunityToApplicationPromotionService {
  promoteOpportunity(input: PromoteOpportunityInput): Promise<PromotionResult>
  createManualApplication(input: CreateManualApplicationInput): Promise<ManualApplicationResult>
}

export interface OpportunityToApplicationPromotionOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

/** Thrown inside a promotion transaction to roll it back and surface a typed failure. */
class PromotionAbort extends Error {
  constructor(readonly failure: ApplicationFailure) {
    super(failure.message)
    this.name = 'PromotionAbort'
  }
}

const FAILURE_PASSTHROUGH: readonly string[] = [
  'invalid_input',
  'bounded_data_violation',
  'security_violation',
  'not_found',
  'revision_conflict',
  'missing_lineage',
  'deterministic_duplicate',
]

/** Remap an upstream aggregate's typed failure onto an Application failure code. */
function mapForeignFailure(failure: { code: string; message: string }): ApplicationFailure {
  const code: ApplicationFailureCode = FAILURE_PASSTHROUGH.includes(failure.code) ? (failure.code as ApplicationFailureCode) : 'invalid_input'
  return fail(code, failure.message)
}

export function createPgliteOpportunityToApplicationPromotion(
  database: PgliteDatabase,
  deps: OpportunityToApplicationDeps,
  options: OpportunityToApplicationPromotionOptions = {},
): OpportunityToApplicationPromotionService {
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const newId = options.newId ?? createUuidV7Generator(clock)
  const { captureService, jobService, opportunityService, applicationService } = deps

  async function existingApplication(exec: Tx, workspaceId: string, opportunityId: string): Promise<string | null> {
    const [row] = await exec
      .select({ id: lifecycleApplications.id })
      .from(lifecycleApplications)
      .where(and(
        eq(lifecycleApplications.workspaceId, workspaceId),
        eq(lifecycleApplications.opportunityId, opportunityId),
        isNull(lifecycleApplications.removedAt),
      ))
      .limit(1)
    return row?.id ?? null
  }

  async function addInitialDependents(
    tx: Tx,
    workspaceId: string,
    applicationId: string,
    actor: ApplicationActor,
    links: readonly ApplicationLinkInput[] | undefined,
    event: PromotionEventInput | undefined,
  ) {
    for (const link of links ?? []) {
      const input: AddLinkInput = { workspaceId, applicationId, link, actor }
      const added = await applicationService.addLinkOn(tx, input)
      if (!added.ok) throw new PromotionAbort(added)
    }
    if (event) {
      const recorded = await applicationService.recordEventOn(tx, { workspaceId, applicationId, event, actor })
      if (!recorded.ok) throw new PromotionAbort(recorded)
    }
  }

  return {
    async promoteOpportunity(input) {
      let workspaceId: string
      let opportunityId: string
      let actor: ApplicationActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        opportunityId = requireText(input.opportunityId, 'opportunityId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        return fail('invalid_input', error instanceof Error ? error.message : 'invalid input')
      }
      const opportunity = await opportunityService.get(workspaceId, opportunityId)
      if (!opportunity) return fail('not_found', 'opportunity not found in this workspace')
      if (opportunity.removedAt !== null) return fail('invalid_input', 'opportunity is removed; restore it before promotion')

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await database.transaction(async (tx) => {
            // Serialize concurrent promotions of THIS opportunity on real Postgres.
            await tx.select({ id: lifecycleOpportunities.id }).from(lifecycleOpportunities)
              .where(and(eq(lifecycleOpportunities.workspaceId, workspaceId), eq(lifecycleOpportunities.id, opportunityId)))
              .for('update')
            const linked = await existingApplication(tx, workspaceId, opportunityId)
            if (linked) {
              return { ok: true as const, applicationId: linked, opportunityId, jobId: opportunity.jobId, attached: true, created: false }
            }
            const created = await applicationService.createOn(tx, {
              workspaceId,
              opportunityId,
              companyName: input.companyName,
              sourceName: input.sourceName,
              scores: input.scores,
              actor,
            })
            if (!created.ok) throw new PromotionAbort(created)
            await addInitialDependents(tx, workspaceId, created.application.id, actor, input.links, input.event)
            return { ok: true as const, applicationId: created.application.id, opportunityId, jobId: created.application.jobId, attached: false, created: true }
          })
        } catch (error) {
          if (error instanceof PromotionAbort) return error.failure
          if (isUniqueViolation(error)) continue
          throw error
        }
      }
      return fail('revision_conflict', 'promotion could not converge under contention')
    },

    async createManualApplication(input) {
      let workspaceId: string
      let actor: ApplicationActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        return fail('invalid_input', error instanceof Error ? error.message : 'invalid input')
      }
      const adapter = input.capture.adapterId ?? 'manual'
      const observedAt = nowIso()
      try {
        return await database.transaction(async (tx) => {
          // 1. Capture (compose #299 acceptOn core).
          const accepted = await captureService.acceptOn(tx, {
            workspaceId,
            provenance: { adapterId: adapter, adapterKind: 'manual', adapterVersion: '1.0.0', providerRecordId: null, providerSchema: null, observedAt },
            evidenceMode: input.capture.evidenceMode ?? 'reported',
            evidence: input.capture.evidence,
            actor,
          })
          if (!accepted.ok) throw new PromotionAbort(mapForeignFailure(accepted))
          // 2. Job (compose #300 createOn core) + capture→job lineage (Job-owned conversation).
          const job = await jobService.createOn(tx, { workspaceId, facts: input.jobFacts, actor })
          if (!job.ok) throw new PromotionAbort(mapForeignFailure(job))
          await insertJobCaptureEvidenceReferences(tx).values({
            id: newId(),
            jobId: job.job.id,
            captureId: accepted.capture.id,
            captureRevision: accepted.capture.revision,
            evidenceIndexesJson: JSON.stringify(input.capture.evidence.map((_, index) => index)),
            createdAt: observedAt,
          })
          // 3. Opportunity (compose #301 createOn core).
          const opportunity = await opportunityService.createOn(tx, { workspaceId, jobId: job.job.id, actor })
          if (!opportunity.ok) throw new PromotionAbort(mapForeignFailure(opportunity))
          // 4. Application (this leaf's createOn core) + initial dependents.
          const application = await applicationService.createOn(tx, {
            workspaceId,
            opportunityId: opportunity.opportunity.id,
            companyName: input.companyName,
            sourceName: input.sourceName,
            actor,
          })
          if (!application.ok) throw new PromotionAbort(application)
          await addInitialDependents(tx, workspaceId, application.application.id, actor, input.links, input.event)
          return {
            ok: true as const,
            applicationId: application.application.id,
            opportunityId: opportunity.opportunity.id,
            jobId: job.job.id,
            captureId: accepted.capture.id,
          }
        })
      } catch (error) {
        if (error instanceof PromotionAbort) return error.failure
        if (isUniqueViolation(error)) return fail('revision_conflict', 'manual application creation raced concurrently')
        throw error
      }
    },
  }
}
