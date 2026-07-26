/**
 * Opportunity aggregate — the user-controlled canonical module contract (issue #301).
 *
 * Users create, read/list, correct rank/fit facts, re-evaluate (policy rerun),
 * set an explicit disposition, remove/restore, and inspect history through this
 * service, which writes the canonical `opportunities` and append-only
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
import { jobs } from '../job/job.schema'
import { opportunities, opportunityHistory } from './opportunity.schema'
import {
  insertOpportunities,
  insertOpportunityHistory,
  updateOpportunities,
} from './opportunity.repository'
import {
  type AdmittedCommandActor,
  type BoundedJson,
  type LifecycleId,
  requireId,
  type JsonValue,
  type OpportunityActor,
  type OpportunityActorType,
  type OpportunityCutoff,
  type OpportunityDisposition,
  type OpportunityFailure,
  type OpportunityFit,
  OpportunityInputError,
  SNAPSHOT_MAX,
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
import { lifecycleWarningCodes, opportunityCutoffStates, opportunityDispositions, opportunityFitStates } from '../../db/lifecycle-vocabulary'

export type OpportunityWarningCode = (typeof lifecycleWarningCodes)[number]

/** The contract warning-override input: actor attribution + rationale + overridden codes. */
export interface WarningOverrideInput {
  readonly actor: { readonly id: string; readonly type: OpportunityActorType; readonly displayName?: string }
  readonly rationale: string
  readonly warningCodes: readonly OpportunityWarningCode[]
}

/** Applied duplicate resolution: attach or merge onto an explicit target. */
export interface DuplicateResolutionInput {
  readonly action: 'attach' | 'merge'
  readonly targetResourceId: string
}

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
  /** #304: create-dedup key (see Job) — a keyed re-create converges (created:false). */
  readonly idempotencyKey?: string
  /**
   * #304: optimistic lineage guard — the Job facts revision the caller evaluated
   * against. A mismatch (the Job's facts advanced concurrently) is a typed conflict.
   */
  readonly expectedJobFactsRevision?: number
  /** #304: warning override recorded on the resource ({actor, rationale, warningCodes}). */
  readonly override?: WarningOverrideInput | null
  /** #304: attach/merge onto an existing Opportunity when (workspace, job) collides. */
  readonly duplicateResolution?: DuplicateResolutionInput
}

export interface ChangeEvaluationInput {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly fit?: OpportunityFit
  readonly rank?: number | null
  readonly cutoff?: OpportunityCutoff
  readonly actor: OpportunityActor
  readonly expectedRevision?: number
  /** #304: optional warning override recorded on the resource alongside the evaluation. */
  readonly override?: WarningOverrideInput | null
}

export interface SetDispositionInput {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly disposition: OpportunityDisposition
  readonly rationale?: string | null
  readonly actor: OpportunityActor
  readonly expectedRevision?: number
  /** #304: optional warning override recorded on the resource alongside the disposition. */
  readonly override?: WarningOverrideInput | null
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

/**
 * #304: the contract warning override persisted on the resource. Replaces the #301
 * disposition-override shape (prior/default/resulting) — a disposition change's
 * rationale now lives in the append-only history audit, while this override records
 * which policy warnings an actor consciously overrode.
 */
export interface OpportunityOverride {
  readonly actor: { readonly id: string; readonly type: OpportunityActorType; readonly displayName?: string }
  readonly rationale: string
  readonly warningCodes: readonly OpportunityWarningCode[]
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

export type CreateOpportunityResult = { readonly ok: true; readonly opportunity: OpportunityRecord; readonly created: boolean } | OpportunityFailure
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
  /** Composable tombstone core: run a single Opportunity tombstone on the caller's transaction executor (no internal tx). */
  removeOn(exec: OpportunityExec, input: OpportunityMutationInput): Promise<MutateOpportunityResult>
  restore(input: OpportunityMutationInput): Promise<MutateOpportunityResult>
  /** Composable restore core: clear an Opportunity tombstone on the caller's transaction executor (no internal tx). */
  restoreOn(exec: OpportunityExec, input: OpportunityMutationInput): Promise<MutateOpportunityResult>
  history(workspaceId: string, opportunityId: string): Promise<readonly OpportunityHistoryEntry[]>
}

export interface OpportunityServiceOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

/** The admitted command envelope every Opportunity mutation shares. */
interface OpportunityMutationIds { readonly workspaceId: LifecycleId; readonly opportunityId: LifecycleId; readonly actor: AdmittedCommandActor }

function mutationIds(input: { workspaceId: unknown; opportunityId: unknown; actor: unknown }): OpportunityMutationIds {
  return { workspaceId: requireId(input.workspaceId, 'workspaceId'), opportunityId: requireId(input.opportunityId, 'opportunityId'), actor: requireActor(input.actor) }
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
  idempotencyKey?: string | null
}

const IDEMPOTENCY_KEY_MAX = 200
const OPPORTUNITY_ACTOR_TYPES = ['user', 'agent', 'system'] as const

/**
 * Validate + serialize the contract warning override to bounded JSON, or null when
 * absent. Throws a typed OpportunityInputError on a malformed override.
 */
function serializeOverride(override: WarningOverrideInput | null | undefined): string | null {
  if (override === undefined || override === null) return null
  const type = requireOneOf(override.actor?.type, OPPORTUNITY_ACTOR_TYPES, 'override.actor.type')
  const id = requireText(override.actor?.id, 'override.actor.id', 1, WORKSPACE_MAX)
  const rationale = requireText(override.rationale, 'override.rationale', 1, RATIONALE_MAX)
  if (!Array.isArray(override.warningCodes)) {
    throw new OpportunityInputError('invalid_input', 'override.warningCodes must be an array')
  }
  const warningCodes = override.warningCodes.map((code) => requireOneOf(code, lifecycleWarningCodes, 'override.warningCodes'))
  const displayName = override.actor.displayName === undefined
    ? undefined
    : requireText(override.actor.displayName, 'override.actor.displayName', 1, WORKSPACE_MAX)
  const value: OpportunityOverride = {
    actor: displayName === undefined ? { id, type } : { id, type, displayName },
    rationale,
    warningCodes,
  }
  return boundedJson(value as unknown as JsonValue, 'override', OVERRIDE_MAX)
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
      .from(opportunities)
      .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.id, opportunityId)))
      .limit(1)
    return (row as OpportunityRow | undefined) ?? null
  }

  /** Returns the Job's current facts revision, or null when it is absent/foreign. */
  async function jobFactsRevision(exec: Pick<PgliteDatabase, 'select'>, workspaceId: string, jobId: string): Promise<number | null> {
    const [row] = await exec
      .select({ factsRevision: jobs.factsRevision })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)))
      .limit(1)
    return row ? row.factsRevision : null
  }

  async function selectByIdempotencyKey(exec: OpportunityExec, workspaceId: string, key: string): Promise<OpportunityRow | null> {
    const [row] = await exec
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.idempotencyKey, key)))
      .limit(1)
    return (row as OpportunityRow | undefined) ?? null
  }

  /** The single active (non-tombstoned) Opportunity for a Job, if any — the attach target. */
  async function selectActiveByJob(exec: OpportunityExec, workspaceId: string, jobId: string): Promise<OpportunityRow | null> {
    const [row] = await exec
      .select()
      .from(opportunities)
      .where(and(
        eq(opportunities.workspaceId, workspaceId),
        eq(opportunities.jobId, jobId),
        sql`${opportunities.removedAt} is null`,
      ))
      .limit(1)
    return (row as OpportunityRow | undefined) ?? null
  }

  async function appendHistory(
    tx: OpportunityExec,
    opportunityId: string,
    revision: number,
    kind: OpportunityHistoryKind,
    snapshotJson: BoundedJson<typeof SNAPSHOT_MAX>,
    actor: AdmittedCommandActor,
    createdAt: string,
  ) {
    await insertOpportunityHistory(tx).values({
      opportunityId,
      revision,
      kind,
      snapshotJson,
      auditJson: auditJson(actor),
      createdAt,
    })
  }

  function historySnapshot(value: JsonValue): BoundedJson<typeof SNAPSHOT_MAX> {
    return boundedJson(value, 'snapshot', SNAPSHOT_MAX)
  }

  // Composable commit core: conditional head update + history append on the caller's
  // executor (no internal tx) so the removal orchestration composes an Opportunity
  // tombstone into ONE atomic cross-aggregate transaction. May THROW a unique-violation
  // for the caller's boundary to map.
  async function commitOn(
    exec: OpportunityExec,
    row: OpportunityRow,
    actor: AdmittedCommandActor,
    kind: OpportunityHistoryKind,
    snapshotJson: BoundedJson<typeof SNAPSHOT_MAX>,
    headUpdate: HeadUpdate,
    guard: SQL,
  ): Promise<MutateOpportunityResult> {
    const createdAt = nowIso()
    const nextRevision = row.revision + 1
    const updated = await updateOpportunities(exec)
      .set({ ...headUpdate, revision: nextRevision, updatedAt: createdAt })
      .where(and(eq(opportunities.id, row.id), guard))
      .returning({ id: opportunities.id })
    if (updated.length === 0) return fail('revision_conflict', 'opportunity was modified concurrently')
    await appendHistory(exec, row.id, nextRevision, kind, snapshotJson, actor, createdAt)
    return { ok: true as const, opportunity: toRecord({ ...row, ...headUpdate, revision: nextRevision, updatedAt: createdAt }) }
  }

  async function commit(
    row: OpportunityRow,
    actor: AdmittedCommandActor,
    kind: OpportunityHistoryKind,
    snapshotJson: BoundedJson<typeof SNAPSHOT_MAX>,
    headUpdate: HeadUpdate,
    guard: SQL,
    onUnique: 'revision_conflict' | 'deterministic_duplicate',
  ): Promise<MutateOpportunityResult> {
    try {
      return await database.transaction((tx) => commitOn(tx, row, actor, kind, snapshotJson, headUpdate, guard))
    } catch (error) {
      if (isUniqueViolation(error)) {
        return onUnique === 'deterministic_duplicate'
          ? fail('deterministic_duplicate', 'an active opportunity already exists for this job')
          : fail('revision_conflict', 'opportunity was modified concurrently')
      }
      throw error
    }
  }

  // Composable tombstone/restore cores for the removal orchestration.
  async function removeOn(exec: OpportunityExec, input: OpportunityMutationInput): Promise<MutateOpportunityResult> {
    let ids: OpportunityMutationIds
    try {
      ids = mutationIds(input)
    } catch (error) {
      if (error instanceof OpportunityInputError) return fail(error.code, error.message)
      throw error
    }
    const [row] = await exec.select().from(opportunities)
      .where(and(eq(opportunities.workspaceId, ids.workspaceId), eq(opportunities.id, ids.opportunityId))).limit(1)
    const typed = (row as OpportunityRow | undefined) ?? null
    if (!typed) return fail('not_found', 'opportunity not found in this workspace')
    if (typed.removedAt !== null) return { ok: true, opportunity: toRecord(typed) }
    return commitOn(exec, typed, ids.actor, 'removed', historySnapshot({ kind: 'removed', priorRevision: typed.revision }),
      { removedAt: nowIso() }, sql`${opportunities.removedAt} is null`)
  }

  async function restoreOn(exec: OpportunityExec, input: OpportunityMutationInput): Promise<MutateOpportunityResult> {
    let ids: OpportunityMutationIds
    try {
      ids = mutationIds(input)
    } catch (error) {
      if (error instanceof OpportunityInputError) return fail(error.code, error.message)
      throw error
    }
    const [row] = await exec.select().from(opportunities)
      .where(and(eq(opportunities.workspaceId, ids.workspaceId), eq(opportunities.id, ids.opportunityId))).limit(1)
    const typed = (row as OpportunityRow | undefined) ?? null
    if (!typed) return fail('not_found', 'opportunity not found in this workspace')
    if (typed.removedAt === null) return { ok: true, opportunity: toRecord(typed) }
    // The (workspace, job) partial unique index is the deterministic-duplicate guard on restore.
    return commitOn(exec, typed, ids.actor, 'restored', historySnapshot({ kind: 'restored', priorRevision: typed.revision }),
      { removedAt: null }, sql`${opportunities.removedAt} is not null`)
  }

  async function changeEvaluation(input: ChangeEvaluationInput): Promise<MutateOpportunityResult> {
    let ids: OpportunityMutationIds
    let resolved: { update: HeadUpdate; snapshot: Record<string, JsonValue> }
    try {
      ids = mutationIds(input)
      resolved = evaluationUpdate(input)
      // #304: an evaluation change may carry a warning override for the resource.
      if (input.override !== undefined) resolved.update.overrideJson = serializeOverride(input.override)
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
      historySnapshot(resolved.snapshot),
      resolved.update,
      eq(opportunities.revision, row.revision),
      'revision_conflict',
    )
  }

  return {
    async createOn(exec, input) {
      let workspaceId: string
      let jobId: string
      let actor: AdmittedCommandActor
      let fit: OpportunityFit
      let cutoff: OpportunityCutoff
      let rank: number | null
      let disposition: OpportunityDisposition
      let idempotencyKey: string | null
      let overrideJson: string | null
      try {
        workspaceId = requireId(input.workspaceId, 'workspaceId')
        jobId = requireText(input.jobId, 'jobId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
        fit = input.evaluation?.fit === undefined ? DEFAULT_FIT : requireOneOf(input.evaluation.fit, opportunityFitStates, 'fit')
        cutoff = input.evaluation?.cutoff === undefined ? DEFAULT_CUTOFF : requireOneOf(input.evaluation.cutoff, opportunityCutoffStates, 'cutoff')
        rank = optionalRank(input.evaluation?.rank, 'rank')
        disposition = input.disposition === undefined ? DEFAULT_DISPOSITION : requireOneOf(input.disposition, opportunityDispositions, 'disposition')
        idempotencyKey = input.idempotencyKey === undefined ? null : requireText(input.idempotencyKey, 'idempotencyKey', 1, IDEMPOTENCY_KEY_MAX)
        overrideJson = serializeOverride(input.override)
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        throw error
      }
      // Create-dedup: a keyed re-create converges to the existing Opportunity.
      if (idempotencyKey !== null) {
        const existing = await selectByIdempotencyKey(exec, workspaceId, idempotencyKey)
        if (existing) return { ok: true, opportunity: toRecord(existing), created: false }
      }
      // Lineage + optimistic Job-facts guard (AC3): the Job must exist in the workspace,
      // and — when the caller pins a revision — its facts must not have advanced.
      const factsRevision = await jobFactsRevision(exec, workspaceId, jobId)
      if (factsRevision === null) return fail('missing_lineage', 'job not found in this workspace')
      if (input.expectedJobFactsRevision !== undefined && input.expectedJobFactsRevision !== factsRevision) {
        return fail('revision_conflict', 'job facts advanced since evaluation; re-evaluate before promoting')
      }
      // Duplicate pre-check (attach/merge): an aborted unique-violation cannot be
      // recovered on the same transaction, so resolve BEFORE inserting. attach/merge
      // reduce to the same target for this 1:1 (workspace, job) aggregate.
      const activeForJob = await selectActiveByJob(exec, workspaceId, jobId)
      if (activeForJob) {
        if (input.duplicateResolution) {
          if (input.duplicateResolution.targetResourceId !== activeForJob.id) {
            return fail('invalid_input', 'duplicateResolution.targetResourceId does not match the existing opportunity for this job')
          }
          return { ok: true, opportunity: toRecord(activeForJob), created: false }
        }
        return fail('deterministic_duplicate', 'an active opportunity already exists for this job')
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
        overrideJson,
        createdAt,
        updatedAt: createdAt,
        removedAt: null,
        idempotencyKey,
      }
      // A (workspace, job) unique violation still PROPAGATES (the promotion retries and
      // attaches the winner); the pre-check only handles the non-racing common path.
      await insertOpportunities(exec).values(row)
      await appendHistory(exec, row.id, 1, 'created', historySnapshot({ fit, rank, cutoff, disposition }), actor, createdAt)
      return { ok: true, opportunity: toRecord(row), created: true }
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
        .from(opportunities)
        .where(
          query?.includeRemoved
            ? eq(opportunities.workspaceId, workspaceId)
            : and(eq(opportunities.workspaceId, workspaceId), sql`${opportunities.removedAt} is null`),
        )
        .orderBy(desc(opportunities.createdAt), asc(opportunities.id))
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
      let ids: OpportunityMutationIds
      let disposition: OpportunityDisposition
      let rationale: string | null
      try {
        ids = mutationIds(input)
        disposition = requireOneOf(input.disposition, opportunityDispositions, 'disposition')
        rationale = input.rationale === undefined || input.rationale === null
          ? null
          : requireText(input.rationale, 'rationale', 1, RATIONALE_MAX)
      } catch (error) {
        if (error instanceof OpportunityInputError) return fail(error.code, error.message)
        throw error
      }
      // #304: the disposition rationale is an audit-trail fact (history snapshot); the
      // resource `override_json` now holds only the contract warning override, set
      // explicitly via `override` (undefined leaves the current override untouched).
      let overrideUpdate: Pick<HeadUpdate, 'overrideJson'> = {}
      try {
        if (input.override !== undefined) overrideUpdate = { overrideJson: serializeOverride(input.override) }
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
        'disposition_changed',
        historySnapshot({ disposition, priorDisposition: row.disposition, rationale }),
        { disposition, ...overrideUpdate },
        eq(opportunities.revision, row.revision),
        'revision_conflict',
      )
    },

    removeOn,
    restoreOn,

    async remove(input) {
      try {
        return await database.transaction((tx) => removeOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'opportunity was modified concurrently')
        throw error
      }
    },

    async restore(input) {
      // The (workspace, job) partial unique index is the deterministic duplicate
      // guard: restoring while another active Opportunity owns the Job raises a
      // unique violation, mapped here to a typed deterministic_duplicate.
      try {
        return await database.transaction((tx) => restoreOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('deterministic_duplicate', 'an active opportunity already exists for this job')
        throw error
      }
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
