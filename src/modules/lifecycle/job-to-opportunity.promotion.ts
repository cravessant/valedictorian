/**
 * Job → Opportunity promotion orchestration (issue #301).
 *
 * The explicit, idempotent, concurrency-safe lifecycle command that projects a Job
 * into an Opportunity. It owns ONE transaction per promotion and COMPOSES the
 * Opportunity module's public write conversation (`opportunityService.createOn`) —
 * this file issues no inline `.insert(table)`, so the state-ownership scanner
 * attributes every lifecycle write to its owning module and the orchestration holds
 * no aggregate ownership itself.
 *
 * Idempotency (AC4): the promotion accepts EVERY structurally valid Job and produces
 * exactly one Opportunity per `(workspace, job)`. A re-promote short-circuits to the
 * existing Opportunity BEFORE the policy port fires — a re-promote never re-runs
 * policy or mints a duplicate.
 *
 * Serialization (AC3/AC6): concurrent promotions of the SAME Job are serialized by a
 * `SELECT ... FOR UPDATE` row lock on the Job at transaction start plus the
 * `(workspace, job)` partial unique index; a cross-transaction race that loses the
 * unique index is retried, and the retry attaches the winner's Opportunity. Only
 * typed deterministic failures (absent/removed Job, bounded-data/validation) are
 * terminal; a transient inner failure rolls the whole transaction back leaving no
 * partial Opportunity, and a later retry converges without duplicates.
 *
 * Warnings, never blocks (AC4): fit, cutoff, missing optional facts, third-party
 * destination, and weak possible match are surfaced as WARNINGS / durable defaults —
 * the promotion never hard-blocks on a policy judgment. Policy communicates through
 * the narrow `OpportunityEvaluationPort` contract (AC8); with no port wired the
 * promotion applies durable defaults and a `missing_optional_facts` warning.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock } from '../../db/uuidv7'
import { lifecycleJobs } from '../job/job.schema'
import { lifecycleOpportunities } from '../opportunity/opportunity.schema'
import type {
  DuplicateResolutionInput,
  OpportunityActor,
  OpportunityCutoff,
  OpportunityDisposition,
  OpportunityFailure,
  OpportunityFit,
  OpportunityService,
  WarningOverrideInput,
} from '../opportunity/opportunity.service'
import {
  WORKSPACE_MAX,
  fail,
  isUniqueViolation,
  requireActor,
  requireText,
  OpportunityInputError,
} from '../opportunity/opportunity.validation'

/** Warning taxonomy — the lifecycle warning codes surfaced by a Job→Opportunity promotion. */
export type PromotionWarningCode =
  | 'fit'
  | 'rank'
  | 'cutoff'
  | 'missing_optional_facts'
  | 'third_party_destination'
  | 'weak_possible_match'

export interface PromotionWarning {
  readonly code: PromotionWarningCode
  readonly message: string
}

/** Narrow policy/scoring contract (AC8): opaque Job facts in, evaluation + signals out. */
export interface OpportunityEvaluationPort {
  evaluate(input: { workspaceId: string; jobId: string; facts: unknown }): Promise<OpportunityEvaluation>
}

export interface OpportunityEvaluation {
  readonly fit: OpportunityFit
  readonly rank?: number | null
  readonly cutoff: OpportunityCutoff
  /** Overridable policy judgments surfaced as warnings — never promotion blockers. */
  readonly signals: readonly PromotionWarningCode[]
}

export interface PromoteJobInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly actor: OpportunityActor
  /** #304: create-dedup key threaded onto the minted Opportunity (a keyed re-promote converges). */
  readonly idempotencyKey?: string
  /**
   * #304: the caller-supplied evaluation projected onto the minted Opportunity. The
   * HTTP contract is caller-driven — the promoter states the fit/rank/cutoff and the
   * initial disposition — so a provided evaluation is authoritative and bypasses the
   * (automation-only) policy port. Omitted, the port or durable defaults apply.
   */
  readonly evaluation?: {
    readonly fit: OpportunityFit
    readonly rank: number | null
    readonly cutoff: OpportunityCutoff
    readonly disposition: OpportunityDisposition
  }
  /** #304: optimistic lineage guard — the Job facts revision the caller evaluated against. */
  readonly expectedJobFactsRevision?: number
  /** #304: warning override recorded on the minted Opportunity's resource. */
  readonly override?: WarningOverrideInput | null
  /** #304: attach/merge onto the active Opportunity when (workspace, job) collides. */
  readonly duplicateResolution?: DuplicateResolutionInput
}

export type PromotionResult =
  | {
      readonly ok: true
      readonly opportunityId: string
      readonly jobId: string
      readonly attached: boolean
      readonly created: boolean
      readonly warnings: readonly PromotionWarning[]
    }
  | OpportunityFailure

export interface JobToOpportunityPromotionService {
  promoteJob(input: PromoteJobInput): Promise<PromotionResult>
}

export interface JobToOpportunityPromotionOptions {
  readonly now?: Clock
  readonly evaluationPort?: OpportunityEvaluationPort
}

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

/** Thrown inside a promotion transaction to roll it back and surface a typed failure. */
class PromotionAbort extends Error {
  constructor(readonly failure: OpportunityFailure) {
    super(failure.message)
    this.name = 'PromotionAbort'
  }
}

const WARNING_MESSAGES: Record<PromotionWarningCode, string> = {
  fit: 'policy judged the role fit below a preferred threshold',
  rank: 'policy did not assign the opportunity a rank',
  cutoff: 'policy placed the opportunity below the ranking cutoff',
  missing_optional_facts: 'the job is missing optional facts; defaults were applied',
  third_party_destination: 'the resolved destination is a third-party posting',
  weak_possible_match: 'policy found only a weak possible match',
}

function evaluationSignals(evaluation: Pick<OpportunityEvaluation, 'fit' | 'rank' | 'cutoff'>): PromotionWarningCode[] {
  const signals: PromotionWarningCode[] = []
  if (evaluation.fit !== 'fit') signals.push('fit')
  if (evaluation.fit === 'possible') signals.push('weak_possible_match')
  if (evaluation.rank === null || evaluation.rank === undefined) signals.push('rank')
  if (evaluation.cutoff !== 'above') signals.push('cutoff')
  return signals
}

function validateOverrideWarnings(
  override: WarningOverrideInput | null | undefined,
  warnings: readonly PromotionWarning[],
): OpportunityFailure | null {
  if (!override) return null
  const warningCodes = new Set(warnings.map((warning) => warning.code))
  const absent = override.warningCodes.find((code) => !warningCodes.has(code))
  return absent === undefined
    ? null
    : fail('invalid_input', `override warning code ${absent} is not present in the promotion warnings`)
}

function toWarnings(codes: readonly PromotionWarningCode[]): PromotionWarning[] {
  const seen = new Set<PromotionWarningCode>()
  const warnings: PromotionWarning[] = []
  for (const code of codes) {
    if (seen.has(code)) continue
    seen.add(code)
    warnings.push({ code, message: WARNING_MESSAGES[code] })
  }
  return warnings
}

export function createPgliteJobToOpportunityPromotion(
  database: PgliteDatabase,
  opportunityService: OpportunityService,
  options: JobToOpportunityPromotionOptions = {},
): JobToOpportunityPromotionService {
  const evaluationPort = options.evaluationPort

  async function loadJob(workspaceId: string, jobId: string) {
    const [row] = await database
      .select({ id: lifecycleJobs.id, facts: lifecycleJobs.factsJson, removedAt: lifecycleJobs.removedAt })
      .from(lifecycleJobs)
      .where(and(eq(lifecycleJobs.workspaceId, workspaceId), eq(lifecycleJobs.id, jobId)))
      .limit(1)
    return row ?? null
  }

  async function existingOpportunity(exec: Tx, workspaceId: string, jobId: string) {
    const [row] = await exec
      .select({
        id: lifecycleOpportunities.id,
        fit: lifecycleOpportunities.fit,
        rank: lifecycleOpportunities.rank,
        cutoff: lifecycleOpportunities.cutoff,
      })
      .from(lifecycleOpportunities)
      .where(and(
        eq(lifecycleOpportunities.workspaceId, workspaceId),
        eq(lifecycleOpportunities.jobId, jobId),
        isNull(lifecycleOpportunities.removedAt),
      ))
      .limit(1)
    return row ?? null
  }

  return {
    async promoteJob(input) {
      let workspaceId: string
      let jobId: string
      let actor: OpportunityActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        jobId = requireText(input.jobId, 'jobId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        return fail('invalid_input', error instanceof Error ? error.message : 'invalid input')
      }
      const job = await loadJob(workspaceId, jobId)
      if (!job) return fail('not_found', 'job not found in this workspace')
      if (job.removedAt !== null) return fail('invalid_input', 'job is removed; restore it before promotion')

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await database.transaction(async (tx) => {
            // Serialize concurrent promotions of THIS job on real Postgres.
            await tx.select({ id: lifecycleJobs.id }).from(lifecycleJobs)
              .where(and(eq(lifecycleJobs.workspaceId, workspaceId), eq(lifecycleJobs.id, jobId)))
              .for('update')
            // Idempotency BEFORE any policy evaluation.
            const linked = await existingOpportunity(tx, workspaceId, jobId)
            if (linked) {
              if (input.duplicateResolution && input.duplicateResolution.targetResourceId !== linked.id) {
                throw new PromotionAbort(fail('invalid_input', 'duplicateResolution.targetResourceId does not match the existing opportunity for this job'))
              }
              const warnings = toWarnings(evaluationSignals({
                fit: linked.fit as OpportunityFit,
                rank: linked.rank,
                cutoff: linked.cutoff as OpportunityCutoff,
              }))
              const invalidOverride = validateOverrideWarnings(input.override, warnings)
              if (invalidOverride) throw new PromotionAbort(invalidOverride)
              return { ok: true as const, opportunityId: linked.id, jobId, attached: true, created: false, warnings }
            }

            // A caller-supplied evaluation is authoritative (caller-driven HTTP contract);
            // otherwise the automation policy port, then durable defaults, apply.
            let evaluation: OpportunityEvaluation
            let disposition: OpportunityDisposition | undefined
            if (input.evaluation) {
              evaluation = {
                fit: input.evaluation.fit,
                rank: input.evaluation.rank,
                cutoff: input.evaluation.cutoff,
                signals: evaluationSignals(input.evaluation),
              }
              disposition = input.evaluation.disposition
            } else if (evaluationPort) {
              evaluation = await evaluationPort.evaluate({ workspaceId, jobId, facts: safeFacts(job.facts) })
            } else {
              evaluation = { fit: 'unknown', rank: null, cutoff: 'not_evaluated', signals: ['missing_optional_facts'] }
            }
            const warnings = toWarnings([...evaluation.signals, ...evaluationSignals(evaluation)])
            const invalidOverride = validateOverrideWarnings(input.override, warnings)
            if (invalidOverride) throw new PromotionAbort(invalidOverride)

            const created = await opportunityService.createOn(tx, {
              workspaceId,
              jobId,
              evaluation: { fit: evaluation.fit, rank: evaluation.rank ?? null, cutoff: evaluation.cutoff },
              disposition,
              actor,
              idempotencyKey: input.idempotencyKey,
              expectedJobFactsRevision: input.expectedJobFactsRevision,
              override: input.override,
              duplicateResolution: input.duplicateResolution,
            })
            if (!created.ok) throw new PromotionAbort(created)
            return { ok: true as const, opportunityId: created.opportunity.id, jobId, attached: false, created: true, warnings }
          })
        } catch (error) {
          if (error instanceof PromotionAbort) return error.failure
          // Cross-transaction race: another promotion claimed the (workspace, job)
          // unique key first. Retry — the idempotency short-circuit attaches the winner.
          if (isUniqueViolation(error)) continue
          throw error
        }
      }
      return fail('revision_conflict', 'promotion could not converge under contention')
    },
  }
}

function safeFacts(factsJson: string): unknown {
  try {
    return JSON.parse(factsJson)
  } catch {
    return null
  }
}
