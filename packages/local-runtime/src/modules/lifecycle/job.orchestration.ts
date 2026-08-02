/**
 * Job write orchestration (issue #304).
 *
 * The write half of the Job HTTP surface. The sparxie contract's `jobs.create`,
 * `correctFacts`, and `updateAvailability` each carry `evidenceReferences`, and
 * the external-identity add/remove verbs have no single JobService method — so a
 * Job write is a COMPOSITION of the Job aggregate's cores plus the Job-owned
 * evidence-reference and external-identity conversations. This module owns that
 * composition in ONE transaction per write and returns a transport-neutral
 * outcome the facade maps into the strict `JobMutationResult`.
 *
 * Ownership: every write is issued through a Job-module conversation — the Job
 * service's composable cores (`createOn` / `correctFactsOn` / `updateAvailabilityOn`),
 * the Job repository's lineage/identity/history inserts, and the Job identity
 * service (establish / remove / merge). This file issues no direct
 * `.insert(table)` against another module's tables, so the state-ownership scanner
 * attributes each write to the job module; the orchestration holds no ownership.
 *
 * Ratified create-time handling:
 *  - `evidenceReferences` are validated for lineage (the referenced capture revision
 *    exists in THIS workspace) and linked idempotently (dedup on the lineage index),
 *    so every requested reference appears on the returned Job (the client's create
 *    correlation) without duplicating an existing link.
 *  - `externalIdentities` are established in-transaction; a strong identity already
 *    owned by another Job is a `strong_identity_conflict` block (pre-checked against
 *    the strong-uniqueness index, with the residual concurrent race surfaced as a
 *    conflict too).
 *  - `override` needs no handling here — the sparxie input schema already validated
 *    its shape; the facade echoes it into the audit envelope (validated-not-persisted;
 *    the Job aggregate has no override column).
 *  - `duplicateResolution` attach links this create onto the caller-identified target
 *    Job; merge creates then composes the identity service's deterministic merge, so
 *    the returned resource is the surviving (target) Job — satisfying the contract's
 *    applied-duplicate target=resource-id invariant.
 *
 * Lineage/ownership failures are POLICY BLOCKS (a 200 blocked body), never converted
 * into transport errors; existence/concurrency remain typed errors — the facade's
 * shared classifier draws that line.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite.js'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7.js'
import { captureRevisions, captures } from '../capture/capture.schema.js'
import type { CreateJobInput, JobAvailabilityState, JobService, JsonValue } from '../job/job.service.js'
import { jobExternalIdentities, jobHistory, jobs } from '../job/job.schema.js'
import {
  insertJobCaptureEvidenceReferences,
  insertJobExternalIdentities,
  insertJobHistory,
} from '../job/job.repository.js'
import { resolveStrongIdentityOwner, type JobIdentityService } from '../job/job.identity.js'
import {
  type AdmittedCommandActor,
  type BoundedJson,
  SNAPSHOT_MAX,
  type JobActor,
  type JobFailure,
  JobInputError,
  WORKSPACE_MAX,
  auditJson,
  boundedJson,
  isUniqueViolation,
  requireActor,
  requireText,
} from '../job/job.validation.js'

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

/** A capture-evidence lineage reference the caller attaches to a Job write. */
export interface JobEvidenceReferenceInput {
  readonly captureId: string
  readonly captureRevision: number
  readonly evidenceIndexes: readonly number[]
}

/** An external identity the caller attaches to a Job (contract-validated upstream). */
export interface JobExternalIdentityInput {
  readonly kind: string
  readonly provider: string
  readonly account: string | null
  readonly value: string
  readonly strength: 'strong' | 'provisional'
}

/** Explicit duplicate resolution onto an existing target Job. */
export interface JobDuplicateResolutionInput {
  readonly action: 'attach' | 'merge'
  readonly targetResourceId: string
}

export interface CreateJobOrchestrationInput {
  readonly workspaceId: string
  readonly actor: JobActor
  readonly facts: JsonValue
  readonly availability: { readonly state: string; readonly observedAt: string }
  readonly idempotencyKey?: string
  readonly evidenceReferences: readonly JobEvidenceReferenceInput[]
  readonly externalIdentities: readonly JobExternalIdentityInput[]
  readonly duplicateResolution?: JobDuplicateResolutionInput
}

export interface CorrectJobFactsOrchestrationInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly actor: JobActor
  readonly facts: JsonValue
  readonly expectedFactsRevision?: number
  readonly evidenceReferences: readonly JobEvidenceReferenceInput[]
}

export interface UpdateJobAvailabilityOrchestrationInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly actor: JobActor
  readonly state: string
  readonly observedAt: string
  readonly expectedAvailabilityRevision?: number
  readonly evidenceReferences: readonly JobEvidenceReferenceInput[]
}

export interface JobIdentityOrchestrationInput {
  readonly workspaceId: string
  readonly jobId: string
  readonly actor: JobActor
  readonly identity: JobExternalIdentityInput
}

/** A transport-neutral write failure the facade classifies into a blocked body or a typed error. */
export interface JobWriteFailure {
  readonly code: string
  readonly message: string
  readonly field?: string
  readonly conflictingResourceId?: string
  readonly allowedDuplicateResolutions?: readonly ('attach' | 'merge')[]
}

export type JobWriteOutcome =
  | { readonly ok: true; readonly jobId: string; readonly created: boolean; readonly timestamp: string }
  | { readonly ok: false; readonly failure: JobWriteFailure }

export interface JobOrchestration {
  createJob(input: CreateJobOrchestrationInput): Promise<JobWriteOutcome>
  correctFacts(input: CorrectJobFactsOrchestrationInput): Promise<JobWriteOutcome>
  updateAvailability(input: UpdateJobAvailabilityOrchestrationInput): Promise<JobWriteOutcome>
  addExternalIdentity(input: JobIdentityOrchestrationInput): Promise<JobWriteOutcome>
  removeExternalIdentity(input: JobIdentityOrchestrationInput): Promise<JobWriteOutcome>
}

export interface JobOrchestrationOptions {
  readonly jobService: JobService
  readonly jobIdentityService: JobIdentityService
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

/** Thrown inside a write transaction to roll it back and surface a typed write failure. */
class JobWriteAbort extends Error {
  constructor(readonly failure: JobWriteFailure) {
    super(failure.message)
    this.name = 'JobWriteAbort'
  }
}

function toWriteFailure(failure: JobFailure): JobWriteFailure {
  return { code: failure.code, message: failure.message }
}

export function createLifecycleJobOrchestration(
  database: PgliteDatabase,
  options: JobOrchestrationOptions,
): JobOrchestration {
  const { jobService, jobIdentityService } = options
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const newId = options.newId ?? createUuidV7Generator(clock)

  /** Validate each evidence reference's lineage against THIS workspace (reads only). */
  async function lineageFailure(
    workspaceId: string,
    refs: readonly JobEvidenceReferenceInput[],
  ): Promise<JobWriteFailure | null> {
    for (const ref of refs) {
      const [capture] = await database
        .select({ workspaceId: captures.workspaceId })
        .from(captures)
        .where(eq(captures.id, ref.captureId))
        .limit(1)
      if (!capture) {
        return { code: 'missing_lineage', message: 'an evidence reference names an unknown capture', field: 'evidenceReferences' }
      }
      if (capture.workspaceId !== workspaceId) {
        return { code: 'foreign_lineage', message: 'an evidence reference belongs to another workspace', field: 'evidenceReferences' }
      }
      const [revision] = await database
        .select({ revision: captureRevisions.revision })
        .from(captureRevisions)
        .where(and(eq(captureRevisions.captureId, ref.captureId), eq(captureRevisions.revision, ref.captureRevision)))
        .limit(1)
      if (!revision) {
        return { code: 'missing_lineage', message: 'an evidence reference names an unknown capture revision', field: 'evidenceReferences' }
      }
    }
    return null
  }

  /** Link the requested references idempotently (dedup on the (job, capture, revision) index). */
  async function ensureEvidenceReferences(
    tx: Tx,
    jobId: string,
    refs: readonly JobEvidenceReferenceInput[],
    createdAt: string,
  ): Promise<void> {
    for (const ref of refs) {
      await insertJobCaptureEvidenceReferences(tx)
        .values({
          id: newId(),
          jobId,
          captureId: ref.captureId,
          captureRevision: ref.captureRevision,
          evidenceIndexesJson: JSON.stringify([...ref.evidenceIndexes]),
          createdAt,
        })
        .onConflictDoNothing()
    }
  }

  async function appendHistory(
    tx: Tx,
    jobId: string,
    kind: string,
    snapshotJson: BoundedJson<typeof SNAPSHOT_MAX>,
    actor: AdmittedCommandActor,
    createdAt: string,
  ): Promise<void> {
    const [seqRow] = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${jobHistory.sequence}), 0)` })
      .from(jobHistory)
      .where(eq(jobHistory.jobId, jobId))
    await insertJobHistory(tx).values({
      id: newId(),
      jobId,
      sequence: Number(seqRow?.maxSeq ?? 0) + 1,
      kind,
      snapshotJson,
      auditJson: auditJson(actor),
      createdAt,
    })
  }

  /** Establish one external identity in-transaction (idempotent per job; strong-uniqueness pre-checked). */
  async function establishExternalIdentity(
    tx: Tx,
    workspaceId: string,
    jobId: string,
    identity: JobExternalIdentityInput,
    actor: AdmittedCommandActor,
    createdAt: string,
  ): Promise<void> {
    const [existing] = await tx
      .select({ id: jobExternalIdentities.id })
      .from(jobExternalIdentities)
      .where(and(
        eq(jobExternalIdentities.jobId, jobId),
        eq(jobExternalIdentities.kind, identity.kind),
        eq(jobExternalIdentities.provider, identity.provider),
        sql`coalesce(${jobExternalIdentities.account}, '') = ${identity.account ?? ''}`,
        eq(jobExternalIdentities.value, identity.value),
        isNull(jobExternalIdentities.removedAt),
      ))
      .limit(1)
    if (existing) return // idempotent: this identity is already active on this job
    if (identity.strength === 'strong') {
      const owner = await resolveStrongIdentityOwner(tx, workspaceId, identity)
      if (owner && owner.jobId !== jobId) {
        throw new JobWriteAbort({ code: 'strong_identity_conflict', message: 'the strong identity is already owned by another job' })
      }
    }
    await insertJobExternalIdentities(tx).values({
      id: newId(),
      jobId,
      kind: identity.kind,
      provider: identity.provider,
      account: identity.account,
      value: identity.value,
      strength: identity.strength,
      provenanceKind: 'user_provided',
      provenanceVersion: '1',
      evidenceJson: JSON.stringify({ source: 'user_provided' }),
      createdAt,
    })
    await appendHistory(tx, jobId, 'identity_added', boundedJson({ kind: identity.kind, value: identity.value }, 'snapshot', SNAPSHOT_MAX), actor, createdAt)
  }

  async function loadActiveJob(tx: Tx, workspaceId: string, jobId: string): Promise<{ id: string } | null> {
    const [row] = await tx
      .select({ id: jobs.id, removedAt: jobs.removedAt })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)))
      .limit(1)
    if (!row || row.removedAt !== null) return null
    return { id: row.id }
  }

  /** Normalize a thrown write error into an outcome (abort, concurrency race, or rethrow). */
  function abortToOutcome(error: unknown): JobWriteOutcome {
    if (error instanceof JobWriteAbort) return { ok: false, failure: error.failure }
    if (isUniqueViolation(error)) {
      return { ok: false, failure: { code: 'revision_conflict', message: 'the job was modified concurrently' } }
    }
    throw error
  }

  function inputFailure(error: unknown): JobWriteOutcome {
    if (error instanceof JobInputError) return { ok: false, failure: { code: error.code, message: error.message } }
    return { ok: false, failure: { code: 'invalid_input', message: error instanceof Error ? error.message : 'invalid input' } }
  }

  return {
    async createJob(input) {
      let workspaceId: string
      let actor: AdmittedCommandActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
      } catch (error) {
        return inputFailure(error)
      }
      const lineage = await lineageFailure(workspaceId, input.evidenceReferences)
      if (lineage) return { ok: false, failure: lineage }

      const dedup = input.duplicateResolution
      const timestamp = nowIso()

      if (dedup?.action === 'attach') {
        try {
          const jobId = await database.transaction(async (tx) => {
            const target = await loadActiveJob(tx, workspaceId, dedup.targetResourceId)
            if (!target) {
              throw new JobWriteAbort({ code: 'not_found', message: 'the duplicate target is not an active job in this workspace' })
            }
            await ensureEvidenceReferences(tx, target.id, input.evidenceReferences, timestamp)
            for (const identity of input.externalIdentities) {
              await establishExternalIdentity(tx, workspaceId, target.id, identity, actor, timestamp)
            }
            return target.id
          })
          return { ok: true, jobId, created: false, timestamp }
        } catch (error) {
          return abortToOutcome(error)
        }
      }

      const createInput: CreateJobInput = {
        workspaceId,
        facts: input.facts,
        availability: { state: input.availability.state as JobAvailabilityState, observedAt: input.availability.observedAt },
        actor,
        idempotencyKey: input.idempotencyKey,
      }
      let created: { jobId: string; created: boolean }
      try {
        created = await database.transaction(async (tx) => {
          const result = await jobService.createOn(tx, createInput)
          if (!result.ok) throw new JobWriteAbort(toWriteFailure(result))
          await ensureEvidenceReferences(tx, result.job.id, input.evidenceReferences, timestamp)
          for (const identity of input.externalIdentities) {
            await establishExternalIdentity(tx, workspaceId, result.job.id, identity, actor, timestamp)
          }
          if (dedup?.action === 'merge') {
            const merged = await jobIdentityService.mergeOn(tx, {
              workspaceId,
              jobIdA: result.job.id,
              jobIdB: dedup.targetResourceId,
              actor,
            })
            if (!merged.ok) throw new JobWriteAbort(toWriteFailure(merged))
            return { jobId: merged.winnerJobId, created: false }
          }
          return { jobId: result.job.id, created: result.created }
        })
      } catch (error) {
        return abortToOutcome(error)
      }
      return { ok: true, jobId: created.jobId, created: created.created, timestamp }
    },

    async correctFacts(input) {
      let workspaceId: string
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        requireActor(input.actor)
      } catch (error) {
        return inputFailure(error)
      }
      const lineage = await lineageFailure(workspaceId, input.evidenceReferences)
      if (lineage) return { ok: false, failure: lineage }
      const timestamp = nowIso()
      try {
        const jobId = await database.transaction(async (tx) => {
          const result = await jobService.correctFactsOn(tx, {
            workspaceId,
            jobId: input.jobId,
            facts: input.facts,
            actor: input.actor,
            expectedFactsRevision: input.expectedFactsRevision,
          })
          if (!result.ok) throw new JobWriteAbort(toWriteFailure(result))
          await ensureEvidenceReferences(tx, input.jobId, input.evidenceReferences, timestamp)
          return result.job.id
        })
        return { ok: true, jobId, created: false, timestamp }
      } catch (error) {
        return abortToOutcome(error)
      }
    },

    async updateAvailability(input) {
      let workspaceId: string
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        requireActor(input.actor)
      } catch (error) {
        return inputFailure(error)
      }
      const lineage = await lineageFailure(workspaceId, input.evidenceReferences)
      if (lineage) return { ok: false, failure: lineage }
      const timestamp = nowIso()
      try {
        const jobId = await database.transaction(async (tx) => {
          const result = await jobService.updateAvailabilityOn(tx, {
            workspaceId,
            jobId: input.jobId,
            state: input.state as JobAvailabilityState,
            observedAt: input.observedAt,
            actor: input.actor,
            expectedAvailabilityRevision: input.expectedAvailabilityRevision,
          })
          if (!result.ok) throw new JobWriteAbort(toWriteFailure(result))
          await ensureEvidenceReferences(tx, input.jobId, input.evidenceReferences, timestamp)
          return result.job.id
        })
        return { ok: true, jobId, created: false, timestamp }
      } catch (error) {
        return abortToOutcome(error)
      }
    },

    async addExternalIdentity(input) {
      const result = await jobIdentityService.establish({
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        actor: input.actor,
        identity: {
          kind: input.identity.kind as never,
          provider: input.identity.provider,
          account: input.identity.account,
          value: input.identity.value,
          strength: input.identity.strength,
          provenanceKind: 'user_provided',
          provenanceVersion: '1',
          evidence: { source: 'user_provided' },
        },
      })
      if (!result.ok) return { ok: false, failure: toWriteFailure(result) }
      // The add verb must return THIS job. A strong identity resolving to a different
      // owner is a conflict, not an attach-to-another-job.
      if (result.resolvedJobId !== input.jobId) {
        return { ok: false, failure: { code: 'strong_identity_conflict', message: 'the strong identity is already owned by another job' } }
      }
      return { ok: true, jobId: input.jobId, created: false, timestamp: nowIso() }
    },

    async removeExternalIdentity(input) {
      const result = await jobIdentityService.remove({
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        actor: input.actor,
        identity: {
          kind: input.identity.kind as never,
          provider: input.identity.provider,
          account: input.identity.account,
          value: input.identity.value,
        },
      })
      if (!result.ok) return { ok: false, failure: toWriteFailure(result) }
      return { ok: true, jobId: input.jobId, created: false, timestamp: nowIso() }
    },
  }
}
