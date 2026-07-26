/**
 * Job aggregate — the user-controlled canonical module contract (issue #300, slice 1).
 *
 * Users create, read/list, correct, remove/restore, inspect history, and update
 * availability through this service, which writes the canonical `jobs`
 * and append-only `job_history` tables (Job-owned; see job.repository.ts). Jobs use
 * stable app-side UUIDv7 identities (src/db/uuidv7.ts) — the migration's
 * deterministic mint stays migration-only. Facts and availability are versioned;
 * every mutation appends a `job_history` row whose `(job_id, sequence)` unique
 * index serializes concurrent mutations.
 *
 * External identities, conflicts, attach/merge (slice 2) and Capture→Job promotion
 * (slice 3) build on this contract. This slice wires no promotion and no identity
 * establishment; a Job here carries facts + availability only.
 */
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7'
import { jobAvailabilityStates } from '../../db/lifecycle-vocabulary'
import { jobHistory, jobs } from './job.schema'
import { insertJobHistory, insertJobs, updateJobs } from './job.repository'
import {
  type AdmittedCommandActor,
  type BoundedJson,
  type LifecycleId,
  SNAPSHOT_MAX,
  requireId,
  type JobActor,
  type JobActorType,
  type JobFailure,
  type JsonValue,
  JobInputError,
  WORKSPACE_MAX,
  auditJson,
  boundedJson,
  fail,
  isUniqueViolation,
  requireActor,
  requireText,
  safeParse,
} from './job.validation'

export type { JobActor, JobActorType, JobFailure, JobFailureCode, JsonValue } from './job.validation'

export type JobAvailabilityState = (typeof jobAvailabilityStates)[number]
export type JobHistoryKind =
  | 'created'
  | 'facts_corrected'
  | 'availability_changed'
  | 'identity_added'
  | 'identity_removed'
  | 'removed'
  | 'restored'

export interface JobAvailabilityInput {
  readonly state: JobAvailabilityState
  readonly observedAt: string
}

export interface CreateJobInput {
  readonly workspaceId: string
  readonly facts: JsonValue
  readonly availability?: JobAvailabilityInput
  readonly actor: JobActor
  /**
   * #304: caller-supplied create-dedup key. Re-issuing the same create with the
   * same (workspace, key) converges to the already-created Job (created:false)
   * instead of minting a duplicate. Persisted on the aggregate row and enforced by
   * the partial unique index idx_jobs_idempotency.
   */
  readonly idempotencyKey?: string
}

/**
 * Lifecycle-only creation seam for a transaction that will establish this
 * explicit assignment before commit. It intentionally skips coverage's default
 * baseline Company rather than creating and immediately replacing one.
 */
export interface CreateJobForCompanyAssignmentInput extends CreateJobInput {
  readonly selectedCompanyId: string
  /** Invoked inside the same executor before this method can return success. */
  readonly establishInitialAssignment: (input: {
    readonly jobId: string
    readonly workspaceId: string
    readonly companyId: string
    readonly createdAt: string
  }) => Promise<void>
}

export interface CorrectJobFactsInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly facts: JsonValue
  readonly actor: JobActor
  readonly expectedFactsRevision?: number
}

export interface UpdateJobAvailabilityInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly state: JobAvailabilityState
  readonly observedAt: string
  readonly actor: JobActor
  readonly expectedAvailabilityRevision?: number
}

export interface JobMutationInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly actor: JobActor
}

export interface JobListQuery {
  readonly includeRemoved?: boolean
  readonly limit?: number
}

export interface JobRecord {
  readonly id: string
  readonly workspaceId: string
  readonly facts: JsonValue
  readonly factsRevision: number
  readonly availability: { readonly state: JobAvailabilityState; readonly observedAt: string; readonly revision: number }
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

export interface JobHistoryEntry {
  readonly sequence: number
  readonly kind: JobHistoryKind
  readonly actor: JobActor
  readonly createdAt: string
}

export type CreateJobResult = { readonly ok: true; readonly job: JobRecord; readonly created: boolean } | JobFailure
export type MutateJobResult = { readonly ok: true; readonly job: JobRecord } | JobFailure

/** A read+write executor — the workspace database OR an open transaction. */
export type JobExec = Pick<PgliteDatabase, 'select' | 'insert' | 'update'>

export interface JobCreationCoveragePort {
  ensureAssignmentOn(
    exec: JobExec,
    input: {
      readonly workspaceId: string
      readonly jobId: string
      readonly facts: JsonValue
      readonly createdAt: string
    },
  ): Promise<void>
}

export interface JobService {
  create(input: CreateJobInput): Promise<CreateJobResult>
  /**
   * Composable core: mint a Job on the caller's transaction executor (no internal
   * transaction), so a promotion composes Capture + Job writes in one atomic
   * boundary. Same validation as `create` (one shared implementation).
   */
  createOn(exec: JobExec, input: CreateJobInput): Promise<CreateJobResult>
  createForCompanyAssignmentOn(
    exec: JobExec,
    input: CreateJobForCompanyAssignmentInput,
  ): Promise<CreateJobResult>
  get(workspaceId: string, jobId: string): Promise<JobRecord | null>
  list(workspaceId: string, query?: JobListQuery): Promise<readonly JobRecord[]>
  correctFacts(input: CorrectJobFactsInput): Promise<MutateJobResult>
  /**
   * Composable facts-correction core: bump facts on the caller's transaction
   * executor (no internal tx), so the job orchestration composes a facts
   * correction atomically with the corrected facts' supporting evidence-reference
   * links. Same validation + optimistic guard as `correctFacts`.
   */
  correctFactsOn(exec: JobExec, input: CorrectJobFactsInput): Promise<MutateJobResult>
  updateAvailability(input: UpdateJobAvailabilityInput): Promise<MutateJobResult>
  /** Composable availability core: bump availability on the caller's transaction executor (no internal tx). */
  updateAvailabilityOn(exec: JobExec, input: UpdateJobAvailabilityInput): Promise<MutateJobResult>
  remove(input: JobMutationInput): Promise<MutateJobResult>
  /** Composable tombstone core: run a single Job tombstone on the caller's transaction executor (no internal tx). */
  removeOn(exec: JobExec, input: JobMutationInput): Promise<MutateJobResult>
  restore(input: JobMutationInput): Promise<MutateJobResult>
  /** Composable restore core: clear a Job tombstone on the caller's transaction executor (no internal tx). */
  restoreOn(exec: JobExec, input: JobMutationInput): Promise<MutateJobResult>
  history(workspaceId: string, jobId: string): Promise<readonly JobHistoryEntry[]>
}

export interface JobServiceOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
  readonly creationCoverage: JobCreationCoveragePort
}

const FACTS_MAX = 262_144
const TIMESTAMP_MAX = 100
const IDEMPOTENCY_KEY_MAX = 200

function requireAvailabilityState(value: unknown, field: string): JobAvailabilityState {
  if (typeof value !== 'string' || !(jobAvailabilityStates as readonly string[]).includes(value)) {
    throw new JobInputError('invalid_input', `${field} is invalid`)
  }
  return value as JobAvailabilityState
}

/** The admitted command envelope every Job mutation shares. */
interface JobMutationIds { readonly workspaceId: LifecycleId; readonly jobId: LifecycleId; readonly actor: AdmittedCommandActor }

function mutationIds(input: { workspaceId: unknown; jobId: unknown; actor: unknown }): JobMutationIds {
  return { workspaceId: requireId(input.workspaceId, 'workspaceId'), jobId: requireId(input.jobId, 'jobId'), actor: requireActor(input.actor) }
}

interface JobRow {
  id: string
  workspaceId: string
  factsJson: string
  factsRevision: number
  availabilityState: string
  availabilityObservedAt: string
  availabilityRevision: number
  createdAt: string
  updatedAt: string
  removedAt: string | null
  idempotencyKey?: string | null
}

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    facts: safeParse(row.factsJson),
    factsRevision: row.factsRevision,
    availability: {
      state: row.availabilityState as JobAvailabilityState,
      observedAt: row.availabilityObservedAt,
      revision: row.availabilityRevision,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    removedAt: row.removedAt,
  }
}

type HeadUpdate = Partial<Pick<JobRow, 'factsJson' | 'factsRevision' | 'availabilityState' | 'availabilityObservedAt' | 'availabilityRevision' | 'removedAt'>>

export function createPgliteJobService(
  database: PgliteDatabase,
  options: JobServiceOptions,
): JobService {
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const newId = options.newId ?? createUuidV7Generator(clock)
  const creationCoverage = options.creationCoverage

  async function selectByIdOn(exec: JobExec, workspaceId: string, jobId: string): Promise<JobRow | null> {
    const [row] = await exec
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)))
      .limit(1)
    return (row as JobRow | undefined) ?? null
  }

  async function selectById(workspaceId: string, jobId: string): Promise<JobRow | null> {
    return selectByIdOn(database, workspaceId, jobId)
  }

  // Composable facts-correction / availability cores: single attempt on the caller's
  // executor (no internal tx) so the job orchestration composes the head mutation
  // atomically with the write's supporting evidence-reference links. May THROW a
  // unique-violation (history-sequence race) for the caller's boundary to map.
  async function correctFactsOn(exec: JobExec, input: CorrectJobFactsInput): Promise<MutateJobResult> {
    let ids: JobMutationIds
    let factsJson: BoundedJson<typeof FACTS_MAX>
    try {
      ids = mutationIds(input)
      factsJson = boundedJson(input.facts, 'facts', FACTS_MAX)
    } catch (error) {
      if (error instanceof JobInputError) return fail(error.code, error.message)
      throw error
    }
    const row = await selectByIdOn(exec, ids.workspaceId, ids.jobId)
    if (!row) return fail('not_found', 'job not found in this workspace')
    if (input.expectedFactsRevision !== undefined && input.expectedFactsRevision !== row.factsRevision) {
      return fail('revision_conflict', 'job facts were modified concurrently')
    }
    return commitOn(
      exec,
      row,
      ids.actor,
      'facts_corrected',
      factsJson,
      { factsJson, factsRevision: row.factsRevision + 1 },
      eq(jobs.factsRevision, row.factsRevision),
    )
  }

  async function updateAvailabilityOn(exec: JobExec, input: UpdateJobAvailabilityInput): Promise<MutateJobResult> {
    let ids: JobMutationIds
    let state: JobAvailabilityState
    let observedAt: string
    try {
      ids = mutationIds(input)
      state = requireAvailabilityState(input.state, 'state')
      observedAt = requireText(input.observedAt, 'observedAt', 1, TIMESTAMP_MAX)
    } catch (error) {
      if (error instanceof JobInputError) return fail(error.code, error.message)
      throw error
    }
    const row = await selectByIdOn(exec, ids.workspaceId, ids.jobId)
    if (!row) return fail('not_found', 'job not found in this workspace')
    if (input.expectedAvailabilityRevision !== undefined && input.expectedAvailabilityRevision !== row.availabilityRevision) {
      return fail('revision_conflict', 'job availability was modified concurrently')
    }
    return commitOn(
      exec,
      row,
      ids.actor,
      'availability_changed',
      boundedJson({ state, observedAt }, 'snapshot', SNAPSHOT_MAX),
      { availabilityState: state, availabilityObservedAt: observedAt, availabilityRevision: row.availabilityRevision + 1 },
      eq(jobs.availabilityRevision, row.availabilityRevision),
    )
  }

  // Dedup lookup on the caller's executor (workspace DB or an open promotion tx), so
  // create-dedup composes atomically inside a promotion boundary.
  async function selectByIdempotencyKey(exec: JobExec, workspaceId: string, key: string): Promise<JobRow | null> {
    const [row] = await exec
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.idempotencyKey, key)))
      .limit(1)
    return (row as JobRow | undefined) ?? null
  }

  // Composable commit core: run the conditional head update + history append on the
  // caller's executor (no internal transaction) so the removal orchestration composes
  // a Job tombstone into ONE atomic cross-aggregate transaction. May THROW a
  // unique-violation (history-sequence race) for the caller's boundary to map.
  async function commitOn(
    exec: JobExec,
    row: JobRow,
    actor: AdmittedCommandActor,
    kind: JobHistoryKind,
    snapshotJson: BoundedJson<typeof SNAPSHOT_MAX>,
    headUpdate: HeadUpdate,
    guard: SQL,
  ): Promise<MutateJobResult> {
    const createdAt = nowIso()
    // Conditional update on the pre-read head state is the optimistic concurrency
    // guard: if another mutation advanced it first, 0 rows update and this mutation
    // loses. (pglite serializes transactions, so a plain read-then-write would let
    // both succeed — the guard prevents that.)
    const updated = await updateJobs(exec)
      .set({ ...headUpdate, updatedAt: createdAt })
      .where(and(eq(jobs.id, row.id), guard))
      .returning({ id: jobs.id })
    if (updated.length === 0) return fail('revision_conflict', 'job was modified concurrently')
    const [seqRow] = await exec
      .select({ maxSeq: sql<number>`coalesce(max(${jobHistory.sequence}), 0)` })
      .from(jobHistory)
      .where(eq(jobHistory.jobId, row.id))
    const sequence = Number(seqRow?.maxSeq ?? 0) + 1
    await insertJobHistory(exec).values({
      id: newId(),
      jobId: row.id,
      sequence,
      kind,
      snapshotJson,
      auditJson: auditJson(actor),
      createdAt,
    })
    return { ok: true as const, job: toRecord({ ...row, ...headUpdate, updatedAt: createdAt }) }
  }

  // Composable tombstone/restore cores: single attempt on the caller's executor so the
  // removal orchestration composes a Job tombstone atomically with its dependents.
  async function removeOn(exec: JobExec, input: JobMutationInput): Promise<MutateJobResult> {
    let ids: JobMutationIds
    try {
      ids = mutationIds(input)
    } catch (error) {
      if (error instanceof JobInputError) return fail(error.code, error.message)
      throw error
    }
    const [row] = await exec.select().from(jobs)
      .where(and(eq(jobs.workspaceId, ids.workspaceId), eq(jobs.id, ids.jobId))).limit(1)
    const typed = (row as JobRow | undefined) ?? null
    if (!typed) return fail('not_found', 'job not found in this workspace')
    if (typed.removedAt !== null) return { ok: true, job: toRecord(typed) }
    return commitOn(exec, typed, ids.actor, 'removed',
      boundedJson({ kind: 'removed', priorFactsRevision: typed.factsRevision }, 'snapshot', SNAPSHOT_MAX),
      { removedAt: nowIso() }, sql`${jobs.removedAt} is null`)
  }

  async function restoreOn(exec: JobExec, input: JobMutationInput): Promise<MutateJobResult> {
    let ids: JobMutationIds
    try {
      ids = mutationIds(input)
    } catch (error) {
      if (error instanceof JobInputError) return fail(error.code, error.message)
      throw error
    }
    const [row] = await exec.select().from(jobs)
      .where(and(eq(jobs.workspaceId, ids.workspaceId), eq(jobs.id, ids.jobId))).limit(1)
    const typed = (row as JobRow | undefined) ?? null
    if (!typed) return fail('not_found', 'job not found in this workspace')
    if (typed.removedAt === null) return { ok: true, job: toRecord(typed) }
    return commitOn(exec, typed, ids.actor, 'restored',
      boundedJson({ kind: 'restored', priorFactsRevision: typed.factsRevision }, 'snapshot', SNAPSHOT_MAX),
      { removedAt: null }, sql`${jobs.removedAt} is not null`)
  }

  // Composable core: mint a Job on the caller's executor (no internal transaction)
  // so a promotion can create a Job atomically with a Capture. Same validation as
  // the standalone `create` (one shared implementation).
  async function createOnInternal(
    exec: JobExec,
    input: CreateJobInput,
    establishCoverage: boolean,
  ): Promise<CreateJobResult> {
    let workspaceId: string
    let factsJson: BoundedJson<typeof FACTS_MAX>
    let actor: AdmittedCommandActor
    let availabilityState: JobAvailabilityState
    let availabilityObservedAt: string
    let idempotencyKey: string | null
    try {
      workspaceId = requireId(input.workspaceId, 'workspaceId')
      factsJson = boundedJson(input.facts, 'facts', FACTS_MAX)
      actor = requireActor(input.actor)
      idempotencyKey = input.idempotencyKey === undefined
        ? null
        : requireText(input.idempotencyKey, 'idempotencyKey', 1, IDEMPOTENCY_KEY_MAX)
      if (input.availability) {
        availabilityState = requireAvailabilityState(input.availability.state, 'availability.state')
        availabilityObservedAt = requireText(input.availability.observedAt, 'availability.observedAt', 1, TIMESTAMP_MAX)
      } else {
        availabilityState = 'unknown'
        availabilityObservedAt = nowIso()
      }
    } catch (error) {
      if (error instanceof JobInputError) return fail(error.code, error.message)
      throw error
    }
    // Create-dedup: an existing row under this (workspace, key) short-circuits before
    // minting a new id, so re-issuing the same create converges (created:false).
    if (idempotencyKey !== null) {
      const existing = await selectByIdempotencyKey(exec, workspaceId, idempotencyKey)
      if (existing) {
        if (establishCoverage) {
          await creationCoverage.ensureAssignmentOn(exec, {
            workspaceId,
            jobId: existing.id,
            facts: safeParse(existing.factsJson),
            createdAt: existing.createdAt,
          })
        }
        return { ok: true, job: toRecord(existing), created: false }
      }
    }
    const createdAt = nowIso()
    const row: JobRow = {
      id: newId(),
      workspaceId,
      factsJson,
      factsRevision: 1,
      availabilityState,
      availabilityObservedAt,
      availabilityRevision: 1,
      createdAt,
      updatedAt: createdAt,
      removedAt: null,
      idempotencyKey,
    }
    try {
      await insertJobs(exec).values(row)
    } catch (error) {
      // Concurrent create with the same key lost the unique-index race: converge to
      // the winner rather than surface a conflict (idempotent create semantics).
      if (idempotencyKey !== null && isUniqueViolation(error)) {
        const winner = await selectByIdempotencyKey(exec, workspaceId, idempotencyKey)
        if (winner) return { ok: true, job: toRecord(winner), created: false }
      }
      throw error
    }
    await insertJobHistory(exec).values({
      id: newId(),
      jobId: row.id,
      sequence: 1,
      kind: 'created',
      snapshotJson: factsJson,
      auditJson: auditJson(actor),
      createdAt,
    })
    if (establishCoverage) {
      await creationCoverage.ensureAssignmentOn(exec, {
        workspaceId,
        jobId: row.id,
        facts: input.facts,
        createdAt,
      })
    }
    return { ok: true, job: toRecord(row), created: true }
  }

  async function createOn(exec: JobExec, input: CreateJobInput): Promise<CreateJobResult> {
    return createOnInternal(exec, input, true)
  }

  async function createForCompanyAssignmentOn(
    exec: JobExec,
    input: CreateJobForCompanyAssignmentInput,
  ): Promise<CreateJobResult> {
    requireText(input.selectedCompanyId, 'selectedCompanyId', 1, WORKSPACE_MAX)
    const result = await createOnInternal(exec, input, false)
    if (result.ok) {
      await input.establishInitialAssignment({
        jobId: result.job.id,
        workspaceId: result.job.workspaceId,
        companyId: input.selectedCompanyId,
        createdAt: result.job.createdAt,
      })
    }
    return result
  }

  return {
    createOn,
    createForCompanyAssignmentOn,

    async create(input) {
      return database.transaction((tx) => createOn(tx, input))
    },

    async get(workspaceId, jobId) {
      const row = await selectById(workspaceId, jobId)
      return row ? toRecord(row) : null
    },

    async list(workspaceId, query) {
      const rows = await database
        .select()
        .from(jobs)
        .where(
          query?.includeRemoved
            ? eq(jobs.workspaceId, workspaceId)
            : and(eq(jobs.workspaceId, workspaceId), sql`${jobs.removedAt} is null`),
        )
        .orderBy(desc(jobs.createdAt), asc(jobs.id))
        .limit(query?.limit ?? 200)
      return (rows as JobRow[]).map(toRecord)
    },

    correctFactsOn,
    updateAvailabilityOn,

    async correctFacts(input) {
      try {
        return await database.transaction((tx) => correctFactsOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'job was modified concurrently')
        throw error
      }
    },

    async updateAvailability(input) {
      try {
        return await database.transaction((tx) => updateAvailabilityOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'job was modified concurrently')
        throw error
      }
    },

    removeOn,
    restoreOn,

    async remove(input) {
      try {
        return await database.transaction((tx) => removeOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'job was modified concurrently')
        throw error
      }
    },

    async restore(input) {
      try {
        return await database.transaction((tx) => restoreOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'job was modified concurrently')
        throw error
      }
    },

    async history(workspaceId, jobId) {
      const row = await selectById(workspaceId, jobId)
      if (!row) return []
      const rows = await database
        .select()
        .from(jobHistory)
        .where(eq(jobHistory.jobId, jobId))
        .orderBy(asc(jobHistory.sequence))
      return rows.map((entry) => {
        const audit = safeParse(entry.auditJson)
        const actor = (audit as { actor?: { type?: string; id?: string | null } }).actor
        return {
          sequence: entry.sequence,
          kind: entry.kind as JobHistoryKind,
          actor: { type: (actor?.type ?? 'system') as JobActorType, id: actor?.id ?? null },
          createdAt: entry.createdAt,
        }
      })
    },
  }
}
