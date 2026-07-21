/**
 * Opportunity aggregate — the user-controlled canonical module contract (issue #301).
 *
 * Users create, read/list, correct rank/fit facts, re-evaluate (policy rerun),
 * set an explicit disposition, remove/restore, and inspect history through this
 * service, which writes the canonical `lifecycle_opportunities` and append-only
 * `opportunity_history` tables (Opportunity-owned; see opportunity.repository.ts).
 *
 * Identity is a NORMALIZED relational key — the workspace-scoped Job reference plus
 * the partial unique index `(workspace_id, job_id) WHERE removed_at IS NULL` — so
 * one active Opportunity exists per Job with NO JSON alias scan (AC2/AC3). The
 * database workspace-ownership trigger enforces that the Job and Opportunity share a
 * workspace; this service pre-checks lineage so a foreign/absent Job returns a typed
 * `missing_lineage` rather than a raw trigger error.
 *
 * `revision` is a single monotonic version: every mutation increments it and appends
 * an `opportunity_history` row at that revision. The conditional head update
 * `WHERE revision = <pre-read>` is the optimistic concurrency guard; the history
 * `(opportunity_id, revision)` primary key is the backstop for a race. Policy
 * re-evaluation touches only fit/rank/cutoff and NEVER the disposition, so an
 * explicit user decision is never silently overwritten (AC1). An explicit
 * disposition persists actor, rationale, prior + default disposition, and the
 * resulting state in `override_json` (AC5).
 *
 * The Job→Opportunity promotion (job-to-opportunity.promotion.ts) composes `createOn`
 * on its own transaction executor so the boundary write is one atomic, idempotent,
 * replayable operation.
 */
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7'
import { lifecycleJobs } from '../job/job.schema'
import { lifecycleOpportunities, opportunityHistory } from './opportunity.schema'
import {
  insertLifecycleOpportunities,
  insertOpportunityHistory,
  updateLifecycleOpportunities,
} from './opportunity.repository'
import {
  type JsonValue,
  type OpportunityActor,
  type OpportunityActorType,
  type OpportunityCutoff,
  type OpportunityDisposition,
  type OpportunityFailure,
  type OpportunityFit,
  OpportunityInputError,
  WORKSPACE_MAX,
  OVERRIDE_MAX,
  RATIONALE_MAX,
  auditJson,
  boundedJson,
  fail,
  isUniqueViolation,
  optionalRank,
  requireActor,
  requireOneOf,
  requireText,
  safeParse,
} from './opportunity.validation'
import { opportunityCutoffStates, opportunityDispositions, opportunityFitStates } from '../../db/lifecycle-vocabulary'

export type {
  JsonValue,
  OpportunityActor,
  OpportunityActorType,
  OpportunityCutoff,
  OpportunityDisposition,
  OpportunityFailure,
  OpportunityFailureCode,
  OpportunityFit,
} from './opportunity.validation'

export type OpportunityHistoryKind =
  | 'created'
  | 'evaluation_changed'
  | 'disposition_changed'
  | 'removed'
  | 'restored'

const DEFAULT_FIT: OpportunityFit = 'unknown'
const DEFAULT_CUTOFF: OpportunityCutoff = 'not_evaluated'
const DEFAULT_DISPOSITION: OpportunityDisposition = 'reviewing'

export interface OpportunityEvaluationInput {
  readonly fit?: OpportunityFit
  readonly rank?: number | null
  readonly cutoff?: OpportunityCutoff
}

export interface CreateOpportunityInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly evaluation?: OpportunityEvaluationInput
  readonly disposition?: OpportunityDisposition
  readonly actor: OpportunityActor
}

export interface ChangeEvaluationInput {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly fit?: OpportunityFit
  readonly rank?: number | null
  readonly cutoff?: OpportunityCutoff
  readonly actor: OpportunityActor
  readonly expectedRevision?: number
}

export interface SetDispositionInput {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly disposition: OpportunityDisposition
  readonly rationale?: string | null
  readonly actor: OpportunityActor
  readonly expectedRevision?: number
}

export interface OpportunityMutationInput {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly actor: OpportunityActor
}

export interface OpportunityListQuery {
  readonly includeRemoved?: boolean
  readonly limit?: number
}

export interface OpportunityOverride {
  readonly actor: { readonly type: OpportunityActorType; readonly id: string | null }
  readonly rationale: string | null
  readonly priorDisposition: OpportunityDisposition
  readonly defaultDisposition: OpportunityDisposition
  readonly resultingDisposition: OpportunityDisposition
  readonly at: string
}

export interface OpportunityRecord {
  readonly id: string
  readonly workspaceId: string
  readonly jobId: string
  readonly revision: number
  readonly fit: OpportunityFit
  readonly rank: number | null
  readonly cutoff: OpportunityCutoff
  readonly disposition: OpportunityDisposition
  readonly override: OpportunityOverride | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

export interface OpportunityHistoryEntry {
  readonly revision: number
  readonly kind: OpportunityHistoryKind
  readonly actor: OpportunityActor
  readonly createdAt: string
}

export type CreateOpportunityResult = { readonly ok: true; readonly opportunity: OpportunityRecord } | OpportunityFailure
export type MutateOpportunityResult = { readonly ok: true; readonly opportunity: OpportunityRecord } | OpportunityFailure

/** A read+write executor — the workspace database OR an open transaction. */
export type OpportunityExec = Pick<PgliteDatabase, 'select' | 'insert' | 'update'>

export interface OpportunityService {
  create(input: CreateOpportunityInput): Promise<CreateOpportunityResult>
  /**
   * Composable core: mint an Opportunity on the caller's transaction executor (no
   * internal transaction) so the Job→Opportunity promotion composes the boundary
   * write atomically. Same validation as `create` (one shared implementation). Lets
   * a `(workspace, job)` unique violation PROPAGATE so the caller's transaction
   * boundary maps it (deterministic_duplicate for `create`, an attach retry for the
   * promotion).
   */
  createOn(exec: OpportunityExec, input: CreateOpportunityInput): Promise<CreateOpportunityResult>
  get(workspaceId: string, opportunityId: string): Promise<OpportunityRecord | null>
  list(workspaceId: string, query?: OpportunityListQuery): Promise<readonly OpportunityRecord[]>
  correct(input: ChangeEvaluationInput): Promise<MutateOpportunityResult>
  reevaluate(input: ChangeEvaluationInput): Promise<MutateOpportunityResult>
  setDisposition(input: SetDispositionInput): Promise<MutateOpportunityResult>
  remove(input: OpportunityMutationInput): Promise<MutateOpportunityResult>
  restore(input: OpportunityMutationInput): Promise<MutateOpportunityResult>
  history(workspaceId: string, opportunityId: string): Promise<readonly OpportunityHistoryEntry[]>
}

export interface OpportunityServiceOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

interface OpportunityRow {
  id: string
  workspaceId: string
  jobId: string
  revision: number
  fit: string
  rank: number | null
  cutoff: string
  disposition: string
  overrideJson: string | null
  createdAt: string
  updatedAt: string
  removedAt: string | null
}

function toRecord(row: OpportunityRow): OpportunityRecord {
  const override = row.overrideJson ? (safeParse(row.overrideJson) as unknown as OpportunityOverride) : null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    jobId: row.jobId,
    revision: row.revision,
    fit: row.fit as OpportunityFit,
    rank: row.rank,
    cutoff: row.cutoff as OpportunityCutoff,
    disposition: row.disposition as OpportunityDisposition,
    override,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    removedAt: row.removedAt,
  }
}

type HeadUpdate = Partial<Pick<OpportunityRow, 'fit' | 'rank' | 'cutoff' | 'disposition' | 'overrideJson' | 'removedAt'>>

/** Resolve fit/rank/cutoff overrides against a base row (undefined = unchanged). */
function evaluationUpdate(input: ChangeEvaluationInput): { update: HeadUpdate; snapshot: Record<string, JsonValue> } {
  const update: HeadUpdate = {}
  const snapshot: Record<string, JsonValue> = {}
  if (input.fit !== undefined) {
    update.fit = requireOneOf(input.fit, opportunityFitStates, 'fit')
    snapshot.fit = update.fit
  }
  if (input.cutoff !== undefined) {
    update.cutoff = requireOneOf(input.cutoff, opportunityCutoffStates, 'cutoff')
    snapshot.cutoff = update.cutoff
  }
  if (input.rank !== undefined) {
    update.rank = optionalRank(input.rank, 'rank')
    snapshot.rank = update.rank
  }
  if (Object.keys(update).length === 0) {
    throw new OpportunityInputError('invalid_input', 'at least one of fit, rank, or cutoff is required')
  }
  return { update, snapshot }
}

export function createPgliteOpportunityService(
  database: PgliteDatabase,
  options: OpportunityServiceOptions = {},
): OpportunityService {
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const newId = options.newId ?? createUuidV7Generator(clock)

  async function selectById(workspaceId: string, opportunityId: string): Promise<OpportunityRow | null> {
    const [row] = await database
      .select()
      .from(lifecycleOpportunities)
      .where(and(eq(lifecycleOpportunities.workspaceId, workspaceId), eq(lifecycleOpportunities.id, opportunityId)))
      .limit(1)
    return (row as OpportunityRow | undefined) ?? null
  }

  async function jobInWorkspace(exec: Pick<PgliteDatabase, 'select'>, workspaceId: string, jobId: string): Promise<boolean> {
    const [row] = await exec
      .select({ id: lifecycleJobs.id })
      .from(lifecycleJobs)
      .where(and(eq(lifecycleJobs.workspaceId, workspaceId), eq(lifecycleJobs.id, jobId)))
      .limit(1)
    return Boolean(row)
  }

  async function appendHistory(
    tx: OpportunityExec,
    opportunityId: string,
    revision: number,
    kind: OpportunityHistoryKind,
    snapshot: JsonValue,
    actor: OpportunityActor,
    createdAt: string,
  ) {
    await insertOpportunityHistory(tx).values({
      opportunityId,
      revision,
      kind,
      snapshotJson: boundedJson(snapshot, 'snapshot', 262_144),
      auditJson: auditJson(actor),
      createdAt,
    })
  }

  async function commit(
    row: OpportunityRow,
    actor: OpportunityActor,
    kind: OpportunityHistoryKind,
    snapshot: JsonValue,
    headUpdate: HeadUpdate,
    guard: SQL,
    onUnique: 'revision_conflict' | 'deterministic_duplicate',
  ): Promise<MutateOpportunityResult> {
    const createdAt = nowIso()
    const nextRevision = row.revision + 1
    try {
      return await database.transaction(async (tx) => {
        const updated = await updateLifecycleOpportunities(tx)
          .set({ ...headUpdate, revision: nextRevision, updatedAt: createdAt })
          .where(and(eq(lifecycleOpportunities.id, row.id), guard))
          .returning({ id: lifecycleOpportunities.id })
        if (updated.length === 0) return fail('revision_conflict', 'opportunity was modified concurrently')
        await appendHistory(tx, row.id, nextRevision, kind, snapshot, actor, createdAt)
        return { ok: true as const, opportunity: toRecord({ ...row, ...headUpdate, revision: nextRevision, updatedAt: createdAt }) }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return onUnique === 'deterministic_duplicate'
          ? fail('deterministic_duplicate', 'an active opportunity already exists for this job')
          : fail('revision_conflict', 'opportunity was modified concurrently')
      }
      throw error
    }
  }

  async function changeEvaluation(input: ChangeEvaluationInput): Promise<MutateOpportunityResult> {
    let ids: { workspaceId: string; opportunityId: string; actor: OpportunityActor }
    let resolved: { update: HeadUpdate; snapshot: Record<string, JsonValue> }
    try {
      ids = {
        workspaceId: requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX),
        opportunityId: requireText(input.opportunityId, 'opportunityId', 1, WORKSPACE_MAX),
        actor: requireActor(input.actor),
      }
      resolved = evaluationUpdate(input)
    } catch (error) {
      if (error instanceof OpportunityInputError) return fail(error.code, error.message)
      throw error
    }
    const row = await selectById(ids.workspaceId, ids.opportunityId)
    if (!row) return fail('not_found', 'opportunity not found in this workspace')
    if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
      return fail('revision_conflict', 'opportunity was modified concurrently')
    }
    return commit(
      row,
      ids.actor,
      'evaluation_changed',
      resolved.snapshot,
      resolved.update,
      eq(lifecycleOpportunities.revision, row.revision),
      'revision_conflict',
    )
  }

  return {
    async createOn(exec, input) {
      let workspaceId: string
      let jobId: string
      let actor: OpportunityActor
      let fit: OpportunityFit
      let cutoff: OpportunityCutoff
      let rank: number | null
      let disposition: OpportunityDisposition
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        jobId = requireText(input.jobId, 'jobId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
        fit = input.evaluation?.fit === undefined ? DEFAULT_FIT : requireOneOf(input.evaluation.fit, opportunityFitStates, 'fit')
        cutoff = input.evaluation?.cutoff === undefined ? DEFAULT_CUTOFF : requireOneOf(input.evaluation.cutoff, opportunityCutoffStates, 'cutoff')
        rank = optionalRank(input.evaluation?.rank, 'rank')
        disposition = input.disposition === undefined ? DEFAULT_DISPOSITION : requireOneOf(input.disposition, opportunityDispositions, 'disposition')
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        throw error
      }
      if (!(await jobInWorkspace(exec, workspaceId, jobId))) {
        return fail('missing_lineage', 'job not found in this workspace')
      }
      const createdAt = nowIso()
      const row: OpportunityRow = {
        id: newId(),
        workspaceId,
        jobId,
        revision: 1,
        fit,
        rank,
        cutoff,
        disposition,
        overrideJson: null,
        createdAt,
        updatedAt: createdAt,
        removedAt: null,
      }
      await insertLifecycleOpportunities(exec).values(row)
      await appendHistory(exec, row.id, 1, 'created', { fit, rank, cutoff, disposition }, actor, createdAt)
      return { ok: true, opportunity: toRecord(row) }
    },

    async create(input) {
      try {
        return await database.transaction((tx) => this.createOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('deterministic_duplicate', 'an active opportunity already exists for this job')
        throw error
      }
    },

    async get(workspaceId, opportunityId) {
      const row = await selectById(workspaceId, opportunityId)
      return row ? toRecord(row) : null
    },

    async list(workspaceId, query) {
      const rows = await database
        .select()
        .from(lifecycleOpportunities)
        .where(
          query?.includeRemoved
            ? eq(lifecycleOpportunities.workspaceId, workspaceId)
            : and(eq(lifecycleOpportunities.workspaceId, workspaceId), sql`${lifecycleOpportunities.removedAt} is null`),
        )
        .orderBy(desc(lifecycleOpportunities.createdAt), asc(lifecycleOpportunities.id))
        .limit(query?.limit ?? 200)
      return (rows as OpportunityRow[]).map(toRecord)
    },

    correct(input) {
      return changeEvaluation(input)
    },

    reevaluate(input) {
      // Policy rerun: identical write path to `correct` but semantically a fresh
      // evaluation. It touches only fit/rank/cutoff and never the disposition, so an
      // explicit user decision is never silently overwritten (AC1).
      return changeEvaluation(input)
    },

    async setDisposition(input) {
      let ids: { workspaceId: string; opportunityId: string; actor: OpportunityActor }
      let disposition: OpportunityDisposition
      let rationale: string | null
      try {
        ids = {
          workspaceId: requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX),
          opportunityId: requireText(input.opportunityId, 'opportunityId', 1, WORKSPACE_MAX),
          actor: requireActor(input.actor),
        }
        disposition = requireOneOf(input.disposition, opportunityDispositions, 'disposition')
        rationale = input.rationale === undefined || input.rationale === null
          ? null
          : requireText(input.rationale, 'rationale', 1, RATIONALE_MAX)
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(ids.workspaceId, ids.opportunityId)
      if (!row) return fail('not_found', 'opportunity not found in this workspace')
      if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
        return fail('revision_conflict', 'opportunity was modified concurrently')
      }
      const override: OpportunityOverride = {
        actor: { type: ids.actor.type, id: ids.actor.id ?? null },
        rationale,
        priorDisposition: row.disposition as OpportunityDisposition,
        defaultDisposition: DEFAULT_DISPOSITION,
        resultingDisposition: disposition,
        at: nowIso(),
      }
      let overrideJson: string
      try {
        overrideJson = boundedJson(override as unknown as JsonValue, 'override', OVERRIDE_MAX)
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        throw error
      }
      return commit(
        row,
        ids.actor,
        'disposition_changed',
        { disposition, priorDisposition: row.disposition },
        { disposition, overrideJson },
        eq(lifecycleOpportunities.revision, row.revision),
        'revision_conflict',
      )
    },

    async remove(input) {
      let ids: { workspaceId: string; opportunityId: string; actor: OpportunityActor }
      try {
        ids = {
          workspaceId: requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX),
          opportunityId: requireText(input.opportunityId, 'opportunityId', 1, WORKSPACE_MAX),
          actor: requireActor(input.actor),
        }
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(ids.workspaceId, ids.opportunityId)
      if (!row) return fail('not_found', 'opportunity not found in this workspace')
      if (row.removedAt !== null) return { ok: true, opportunity: toRecord(row) }
      return commit(
        row,
        ids.actor,
        'removed',
        { kind: 'removed', priorRevision: row.revision },
        { removedAt: nowIso() },
        sql`${lifecycleOpportunities.removedAt} is null`,
        'revision_conflict',
      )
    },

    async restore(input) {
      let ids: { workspaceId: string; opportunityId: string; actor: OpportunityActor }
      try {
        ids = {
          workspaceId: requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX),
          opportunityId: requireText(input.opportunityId, 'opportunityId', 1, WORKSPACE_MAX),
          actor: requireActor(input.actor),
        }
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(ids.workspaceId, ids.opportunityId)
      if (!row) return fail('not_found', 'opportunity not found in this workspace')
      if (row.removedAt === null) return { ok: true, opportunity: toRecord(row) }
      // The (workspace, job) partial unique index is the deterministic duplicate
      // guard: restoring while another active Opportunity owns the Job raises a
      // unique violation, mapped here to a typed deterministic_duplicate.
      return commit(
        row,
        ids.actor,
        'restored',
        { kind: 'restored', priorRevision: row.revision },
        { removedAt: null },
        sql`${lifecycleOpportunities.removedAt} is not null`,
        'deterministic_duplicate',
      )
    },

    async history(workspaceId, opportunityId) {
      const row = await selectById(workspaceId, opportunityId)
      if (!row) return []
      const rows = await database
        .select()
        .from(opportunityHistory)
        .where(eq(opportunityHistory.opportunityId, opportunityId))
        .orderBy(asc(opportunityHistory.revision))
      return rows.map((entry) => {
        const audit = safeParse(entry.auditJson)
        const actor = (audit as { actor?: { type?: string; id?: string | null } }).actor
        return {
          revision: entry.revision,
          kind: entry.kind as OpportunityHistoryKind,
          actor: { type: (actor?.type ?? 'system') as OpportunityActorType, id: actor?.id ?? null },
          createdAt: entry.createdAt,
        }
      })
    },
  }
}
