/**
 * Lifecycle removal orchestration (issue #304, stage 2).
 *
 * The explicit, atomic command that removes (tombstones) — or restores — any of the
 * four lifecycle aggregates under the released contract's FULL four-choice dependent
 * matrix, without narrowing:
 *
 *  - reject_if_dependents      — refuse when active dependents exist; otherwise tombstone.
 *  - preserve_historical_lineage — tombstone the target only; leave dependents active.
 *  - unlink_dependents         — sever severable dependents (capture→job evidence
 *                                references) OR tombstone the IMMEDIATE non-severable
 *                                dependent (job→opportunity, opportunity→application),
 *                                never cascading past that first hop.
 *  - cascade_tombstone         — tombstone the target AND every transitive dependent.
 *
 * The orchestration owns ONE transaction and COMPOSES the owning modules' public write
 * conversations — each aggregate's `removeOn` core and the Job-owned
 * `deleteJobCaptureEvidenceReferences` sever helper. It issues no inline `.insert`/
 * `.update`/`.delete` against an aggregate table, so the state-ownership scanner
 * attributes every write to its owning module; the orchestration holds no aggregate
 * ownership itself. A typed inner failure rolls the whole transaction back.
 *
 * Dependent shape (see drizzle schema):
 *  - capture → jobs, SEVERABLE via `job_capture_evidence_references` (a job may bear
 *    several captures; unlink deletes only the reference rows).
 *  - job → opportunities and opportunity → applications, NOT NULL FKs, NOT severable →
 *    unlink tombstones the immediate dependent.
 *  - application → its own links/events/attempts (leaf children), mapped to the
 *    Application aggregate's existing cascade|preserve dependent choice.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { captures } from '../capture/capture.schema'
import { jobCaptureEvidenceReferences, jobs } from '../job/job.schema'
import { opportunities } from '../opportunity/opportunity.schema'
import { applicationAttemptRecords, applicationEventRecords, applications, pursuitLinks } from '../application/application.schema'
import { deleteJobCaptureEvidenceReferences } from '../job/job.repository'
import type { CaptureService } from '../capture/capture.service'
import type { JobService } from '../job/job.service'
import type { OpportunityService } from '../opportunity/opportunity.service'
import type { ApplicationAggregateService, ApplicationDeleteExec } from '../applications/application.aggregate.service'

export type RemovalChoice =
  | 'reject_if_dependents'
  | 'preserve_historical_lineage'
  | 'unlink_dependents'
  | 'cascade_tombstone'

export type LifecycleAggregate = 'capture' | 'job' | 'opportunity' | 'application'
const AGGREGATES: readonly LifecycleAggregate[] = ['capture', 'job', 'opportunity', 'application']
const CHOICES: readonly RemovalChoice[] = ['reject_if_dependents', 'preserve_historical_lineage', 'unlink_dependents', 'cascade_tombstone']

export interface LifecycleActor {
  readonly type: 'user' | 'agent' | 'system'
  readonly id?: string | null
}

export interface RemoveLifecycleInput {
  readonly workspaceId: string
  readonly aggregate: LifecycleAggregate
  readonly resourceId: string
  readonly choice: RemovalChoice
  readonly actor: LifecycleActor
}

export interface RestoreLifecycleInput {
  readonly workspaceId: string
  readonly aggregate: LifecycleAggregate
  readonly resourceId: string
  readonly actor: LifecycleActor
}

export interface AggregateRef {
  readonly aggregate: LifecycleAggregate
  readonly id: string
}

export type RemovalFailureCode =
  | 'invalid_input'
  | 'not_found'
  | 'dependents_present'
  | 'dependent_choice_required'
  | 'revision_conflict'
  | 'deterministic_duplicate'
  | 'bounded_data_violation'

export interface RemovalFailure {
  readonly ok: false
  readonly code: RemovalFailureCode
  readonly message: string
}

export type RemoveLifecycleResult =
  | {
      readonly ok: true
      readonly aggregate: LifecycleAggregate
      readonly resourceId: string
      readonly choice: RemovalChoice
      /** Aggregates tombstoned (the target first, then any cascaded/unlinked dependents). */
      readonly tombstoned: readonly AggregateRef[]
      /** Severable dependents whose link was deleted (capture→job references). */
      readonly unlinked: readonly AggregateRef[]
    }
  | RemovalFailure

export type RestoreLifecycleResult =
  | {
      readonly ok: true
      readonly aggregate: LifecycleAggregate
      readonly resourceId: string
      /** The target aggregate — always restored. */
      readonly restored: AggregateRef
      /**
       * Immediate dependents STILL tombstoned after the target's restore. Restore is
       * target-only: a dependent tombstoned by a prior cascade/unlink stays tombstoned
       * (it must be restored explicitly) — reported here so the caller sees the gap.
       */
      readonly remainedTombstoned: readonly AggregateRef[]
    }
  | RemovalFailure

export interface LifecycleRemovalDeps {
  readonly captureService: CaptureService
  readonly jobService: JobService
  readonly opportunityService: OpportunityService
  readonly applicationService: ApplicationAggregateService
}

export interface LifecycleRemovalOrchestration {
  remove(input: RemoveLifecycleInput): Promise<RemoveLifecycleResult>
  restore(input: RestoreLifecycleInput): Promise<RestoreLifecycleResult>
}

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]
type MutateFailure = { readonly ok: false; readonly code: string; readonly message: string }

/** Thrown inside the transaction to roll it back and surface a typed failure. */
class RemovalAbort extends Error {
  constructor(readonly failure: RemovalFailure) {
    super(failure.message)
    this.name = 'RemovalAbort'
  }
}

const PASSTHROUGH_CODES: readonly string[] = [
  'invalid_input',
  'not_found',
  'revision_conflict',
  'deterministic_duplicate',
  'bounded_data_violation',
  'dependent_choice_required',
]

function mapFailure(failure: MutateFailure): RemovalFailure {
  const code = PASSTHROUGH_CODES.includes(failure.code) ? (failure.code as RemovalFailureCode) : 'invalid_input'
  return { ok: false, code, message: failure.message }
}

const MAX_ID = 200
function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new RemovalAbort({ ok: false, code: 'invalid_input', message: `${field} is required` })
  if (value.trim().length > MAX_ID) throw new RemovalAbort({ ok: false, code: 'bounded_data_violation', message: `${field} exceeds ${MAX_ID} characters` })
  return value.trim()
}

export function createLifecycleRemovalOrchestration(
  database: PgliteDatabase,
  deps: LifecycleRemovalDeps,
): LifecycleRemovalOrchestration {
  const { captureService, jobService, opportunityService, applicationService } = deps

  // --- Active immediate-dependent discovery (reads; the scanner tracks writes only). ---

  async function activeJobsForCapture(tx: Tx, captureId: string): Promise<string[]> {
    const rows = await tx
      .select({ jobId: jobCaptureEvidenceReferences.jobId })
      .from(jobCaptureEvidenceReferences)
      .innerJoin(jobs, eq(jobs.id, jobCaptureEvidenceReferences.jobId))
      .where(and(eq(jobCaptureEvidenceReferences.captureId, captureId), isNull(jobs.removedAt)))
    return [...new Set(rows.map((r) => r.jobId))]
  }

  async function activeOpportunitiesForJob(tx: Tx, workspaceId: string, jobId: string): Promise<string[]> {
    const rows = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.jobId, jobId), isNull(opportunities.removedAt)))
    return rows.map((r) => r.id)
  }

  async function activeApplicationsForOpportunity(tx: Tx, workspaceId: string, opportunityId: string): Promise<string[]> {
    const rows = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.workspaceId, workspaceId), eq(applications.opportunityId, opportunityId), isNull(applications.removedAt)))
    return rows.map((r) => r.id)
  }

  async function applicationChildCount(tx: Tx, applicationId: string): Promise<number> {
    const [{ n }] = await tx
      .select({ n: sql<number>`
        (select count(*) from ${pursuitLinks} where ${pursuitLinks.applicationId} = ${applicationId})
        + (select count(*) from ${applicationEventRecords} where ${applicationEventRecords.applicationId} = ${applicationId})
        + (select count(*) from ${applicationAttemptRecords} where ${applicationAttemptRecords.applicationId} = ${applicationId})` })
      .from(applications)
      .where(eq(applications.id, applicationId))
    return Number(n)
  }

  // --- Composed tombstones (each delegates to the owning module's removeOn core). ---

  async function tombstoneCapture(tx: Tx, workspaceId: string, id: string, actor: LifecycleActor) {
    const r = await captureService.removeOn(tx, { workspaceId, captureId: id, actor })
    if (!r.ok) throw new RemovalAbort(mapFailure(r))
  }
  async function tombstoneJob(tx: Tx, workspaceId: string, id: string, actor: LifecycleActor) {
    const r = await jobService.removeOn(tx, { workspaceId, jobId: id, actor })
    if (!r.ok) throw new RemovalAbort(mapFailure(r))
  }
  async function tombstoneOpportunity(tx: Tx, workspaceId: string, id: string, actor: LifecycleActor) {
    const r = await opportunityService.removeOn(tx, { workspaceId, opportunityId: id, actor })
    if (!r.ok) throw new RemovalAbort(mapFailure(r))
  }
  async function tombstoneApplication(tx: Tx, workspaceId: string, id: string, actor: LifecycleActor, dependents: 'cascade' | 'preserve' | undefined) {
    const r = await applicationService.removeOn(tx as ApplicationDeleteExec, { workspaceId, applicationId: id, actor, dependents })
    if (!r.ok) throw new RemovalAbort(mapFailure(r))
  }

  // --- Recursive cascade: tombstone an aggregate and every transitive dependent. ---

  async function cascade(tx: Tx, workspaceId: string, aggregate: LifecycleAggregate, id: string, actor: LifecycleActor, out: AggregateRef[]) {
    if (aggregate === 'capture') {
      await tombstoneCapture(tx, workspaceId, id, actor)
      out.push({ aggregate: 'capture', id })
      for (const jobId of await activeJobsForCapture(tx, id)) await cascade(tx, workspaceId, 'job', jobId, actor, out)
    } else if (aggregate === 'job') {
      await tombstoneJob(tx, workspaceId, id, actor)
      out.push({ aggregate: 'job', id })
      for (const oppId of await activeOpportunitiesForJob(tx, workspaceId, id)) await cascade(tx, workspaceId, 'opportunity', oppId, actor, out)
    } else if (aggregate === 'opportunity') {
      await tombstoneOpportunity(tx, workspaceId, id, actor)
      out.push({ aggregate: 'opportunity', id })
      for (const appId of await activeApplicationsForOpportunity(tx, workspaceId, id)) await cascade(tx, workspaceId, 'application', appId, actor, out)
    } else {
      const children = await applicationChildCount(tx, id)
      await tombstoneApplication(tx, workspaceId, id, actor, children > 0 ? 'cascade' : undefined)
      out.push({ aggregate: 'application', id })
    }
  }

  // --- Immediate active dependents of a target (for reject/unlink), plus severability. ---

  async function immediateDependents(tx: Tx, workspaceId: string, aggregate: LifecycleAggregate, id: string): Promise<{ severable: boolean; refs: AggregateRef[]; childCount: number }> {
    if (aggregate === 'capture') {
      return { severable: true, refs: (await activeJobsForCapture(tx, id)).map((jid) => ({ aggregate: 'job' as const, id: jid })), childCount: 0 }
    }
    if (aggregate === 'job') {
      return { severable: false, refs: (await activeOpportunitiesForJob(tx, workspaceId, id)).map((oid) => ({ aggregate: 'opportunity' as const, id: oid })), childCount: 0 }
    }
    if (aggregate === 'opportunity') {
      return { severable: false, refs: (await activeApplicationsForOpportunity(tx, workspaceId, id)).map((aid) => ({ aggregate: 'application' as const, id: aid })), childCount: 0 }
    }
    return { severable: false, refs: [], childCount: await applicationChildCount(tx, id) }
  }

  /** Confirm the target aggregate exists in the workspace; returns its removed state. */
  async function targetRemovedAt(tx: Tx, workspaceId: string, aggregate: LifecycleAggregate, id: string): Promise<string | null | undefined> {
    const table = aggregate === 'capture' ? captures : aggregate === 'job' ? jobs : aggregate === 'opportunity' ? opportunities : applications
    const [row] = await tx.select({ removedAt: table.removedAt }).from(table).where(and(eq(table.workspaceId, workspaceId), eq(table.id, id))).limit(1)
    return row ? row.removedAt : undefined
  }

  /** Immediate dependents of a target that are STILL tombstoned (for the restore gap report). */
  async function tombstonedImmediateDependents(tx: Tx, workspaceId: string, aggregate: LifecycleAggregate, id: string): Promise<AggregateRef[]> {
    if (aggregate === 'job') {
      const rows = await tx.select({ id: opportunities.id }).from(opportunities)
        .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.jobId, id), sql`${opportunities.removedAt} is not null`))
      return rows.map((r) => ({ aggregate: 'opportunity' as const, id: r.id }))
    }
    if (aggregate === 'opportunity') {
      const rows = await tx.select({ id: applications.id }).from(applications)
        .where(and(eq(applications.workspaceId, workspaceId), eq(applications.opportunityId, id), sql`${applications.removedAt} is not null`))
      return rows.map((r) => ({ aggregate: 'application' as const, id: r.id }))
    }
    if (aggregate === 'capture') {
      const rows = await tx.select({ jobId: jobCaptureEvidenceReferences.jobId }).from(jobCaptureEvidenceReferences)
        .innerJoin(jobs, eq(jobs.id, jobCaptureEvidenceReferences.jobId))
        .where(and(eq(jobCaptureEvidenceReferences.captureId, id), sql`${jobs.removedAt} is not null`))
      return [...new Set(rows.map((r) => r.jobId))].map((jid) => ({ aggregate: 'job' as const, id: jid }))
    }
    return []
  }

  return {
    async remove(input) {
      let workspaceId: string
      let resourceId: string
      let aggregate: LifecycleAggregate
      let choice: RemovalChoice
      try {
        if (!AGGREGATES.includes(input.aggregate)) throw new RemovalAbort({ ok: false, code: 'invalid_input', message: 'aggregate is invalid' })
        if (!CHOICES.includes(input.choice)) throw new RemovalAbort({ ok: false, code: 'invalid_input', message: 'choice is invalid' })
        workspaceId = requireId(input.workspaceId, 'workspaceId')
        resourceId = requireId(input.resourceId, 'resourceId')
        aggregate = input.aggregate
        choice = input.choice
      } catch (error) {
        if (error instanceof RemovalAbort) return error.failure
        throw error
      }
      const actor = input.actor
      try {
        return await database.transaction(async (tx) => {
          const removedAt = await targetRemovedAt(tx, workspaceId, aggregate, resourceId)
          if (removedAt === undefined) return { ok: false as const, code: 'not_found' as const, message: `${aggregate} not found in this workspace` }

          const tombstoned: AggregateRef[] = []
          const unlinked: AggregateRef[] = []
          const dependents = await immediateDependents(tx, workspaceId, aggregate, resourceId)

          if (choice === 'reject_if_dependents') {
            if (dependents.refs.length > 0 || dependents.childCount > 0) {
              throw new RemovalAbort({ ok: false, code: 'dependents_present', message: `${aggregate} has active dependents; choose another removal strategy` })
            }
            await cascade(tx, workspaceId, aggregate, resourceId, actor, tombstoned) // no dependents → tombstones target only
          } else if (choice === 'preserve_historical_lineage') {
            // Tombstone the target only, leaving dependents active. For an application,
            // preserve its leaf children.
            if (aggregate === 'application') {
              await tombstoneApplication(tx, workspaceId, resourceId, actor, dependents.childCount > 0 ? 'preserve' : undefined)
            } else if (aggregate === 'capture') {
              await tombstoneCapture(tx, workspaceId, resourceId, actor)
            } else if (aggregate === 'job') {
              await tombstoneJob(tx, workspaceId, resourceId, actor)
            } else {
              await tombstoneOpportunity(tx, workspaceId, resourceId, actor)
            }
            tombstoned.push({ aggregate, id: resourceId })
          } else if (choice === 'unlink_dependents') {
            if (aggregate === 'capture') {
              // Severable: delete the evidence references (job-owned helper), tombstone
              // the capture; the jobs stay fully active.
              await deleteJobCaptureEvidenceReferences(tx).where(eq(jobCaptureEvidenceReferences.captureId, resourceId))
              await tombstoneCapture(tx, workspaceId, resourceId, actor)
              tombstoned.push({ aggregate: 'capture', id: resourceId })
              unlinked.push(...dependents.refs)
            } else if (aggregate === 'application') {
              // The application's leaf children have no aggregate identity to unlink →
              // sever them (delete) as the application's cascade choice.
              await tombstoneApplication(tx, workspaceId, resourceId, actor, dependents.childCount > 0 ? 'cascade' : undefined)
              tombstoned.push({ aggregate: 'application', id: resourceId })
            } else {
              // NOT severable: tombstone the target AND its IMMEDIATE dependents only
              // (never cascading past the first hop).
              if (aggregate === 'job') await tombstoneJob(tx, workspaceId, resourceId, actor)
              else await tombstoneOpportunity(tx, workspaceId, resourceId, actor)
              tombstoned.push({ aggregate, id: resourceId })
              for (const ref of dependents.refs) {
                if (ref.aggregate === 'opportunity') await tombstoneOpportunity(tx, workspaceId, ref.id, actor)
                else await tombstoneApplication(tx, workspaceId, ref.id, actor, 'preserve')
                tombstoned.push(ref)
              }
            }
          } else {
            // cascade_tombstone
            await cascade(tx, workspaceId, aggregate, resourceId, actor, tombstoned)
          }

          return { ok: true as const, aggregate, resourceId, choice, tombstoned, unlinked }
        })
      } catch (error) {
        if (error instanceof RemovalAbort) return error.failure
        throw error
      }
    },

    async restore(input) {
      let workspaceId: string
      let resourceId: string
      let aggregate: LifecycleAggregate
      try {
        if (!AGGREGATES.includes(input.aggregate)) throw new RemovalAbort({ ok: false, code: 'invalid_input', message: 'aggregate is invalid' })
        workspaceId = requireId(input.workspaceId, 'workspaceId')
        resourceId = requireId(input.resourceId, 'resourceId')
        aggregate = input.aggregate
      } catch (error) {
        if (error instanceof RemovalAbort) return error.failure
        throw error
      }
      const actor = input.actor
      try {
        return await database.transaction(async (tx) => {
          const removedAt = await targetRemovedAt(tx, workspaceId, aggregate, resourceId)
          if (removedAt === undefined) return { ok: false as const, code: 'not_found' as const, message: `${aggregate} not found in this workspace` }

          const restore =
            aggregate === 'capture' ? await captureService.restoreOn(tx, { workspaceId, captureId: resourceId, actor })
            : aggregate === 'job' ? await jobService.restoreOn(tx, { workspaceId, jobId: resourceId, actor })
            : aggregate === 'opportunity' ? await opportunityService.restoreOn(tx, { workspaceId, opportunityId: resourceId, actor })
            : await applicationService.restoreOn(tx, { workspaceId, applicationId: resourceId, actor })
          if (!restore.ok) throw new RemovalAbort(mapFailure(restore))

          // Restore is target-only: report immediate dependents that stayed tombstoned
          // (a prior cascade/unlink tombstoned them; they must be restored explicitly).
          const remainedTombstoned = await tombstonedImmediateDependents(tx, workspaceId, aggregate, resourceId)
          return { ok: true as const, aggregate, resourceId, restored: { aggregate, id: resourceId }, remainedTombstoned }
        })
      } catch (error) {
        if (error instanceof RemovalAbort) return error.failure
        throw error
      }
    },
  }
}
