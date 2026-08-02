/**
 * Capture → Job promotion orchestration (issue #300, slice 3).
 *
 * The explicit, idempotent, concurrency-safe lifecycle command that turns a
 * Capture into a Job. It owns ONE transaction per promotion and COMPOSES the
 * Capture and Job modules' public write conversations — capture `acceptOn`, job
 * `createOn`, and the Job-owned identity/history/lineage conversations. Every
 * lifecycle write is executed by an owning-module conversation (this file issues
 * no inline `.insert(table)`), so the state-ownership scanner attributes each
 * write to its module; the orchestration holds no aggregate ownership itself.
 *
 * Serialization: concurrent promotions of the SAME Capture are serialized by a
 * `SELECT ... FOR UPDATE` row lock on the Capture at transaction start plus the
 * lineage check INSIDE the transaction — so convergence rests on real Postgres
 * semantics, not pglite's single-connection accident. (The contract permits
 * multiple Jobs per Capture via explicit distinct promotions; the serialization
 * key is the promotion operation, not a one-Job-per-Capture index.) The strong
 * unique index is the second line for cross-Capture ATTACH races.
 *
 * Idempotency is checked BEFORE any boundary retrieval: a re-promote short-circuits
 * to the existing Job without re-firing the side-effecting resolver.
 *
 * Boundary-owned retrieval (AC5) happens ONLY here, composing the #233 provider-URL
 * resolver PORT (opaque provider record id in, validated canonical destination out;
 * intermediary URLs are never surfaced to a hosted resolver — that guard + the
 * hosted writer are #303). Per-mode retrieval authority is enforced here: a
 * `reported` Capture cannot claim an ATS-authoritative (strong) identity without
 * boundary retrieval; an `ats_details_provided` Capture may. Blocking is reserved
 * for typed deterministic failures (a security-rejected destination, an over-bound
 * identity); missing optional facts and policy judgments are WARNINGS. A typed
 * inner failure rolls the whole transaction back (no partial state).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { jobLocationSchema } from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite.js'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7.js'
import { jobCaptureEvidenceReferences, jobExternalIdentities, jobHistory, jobs } from '../../db/schema.js'
import { lifecycleWarningCodes } from '../../db/lifecycle-vocabulary.js'
import { captureEvidenceItems, captureRevisions, captures } from '../capture/capture.schema.js'
import type { CaptureFieldOutcomeExec } from '../capture/capture.field-outcomes.js'
import type { CaptureEvidenceInput, CaptureFailure, CaptureService, JsonValue } from '../capture/capture.service.js'
import type { JobActor, JobActorType, JobService } from '../job/job.service.js'
import {
  AUDIT_MAX,
  type AdmittedCommandActor,
  type BoundedJson,
  SNAPSHOT_MAX,
  type JobFailure,
  type JobFailureCode,
  JobInputError,
  WORKSPACE_MAX,
  auditJson,
  boundedJson,
  fail,
  isUniqueViolation,
  requireActor,
  requireText,
} from '../job/job.validation.js'
import { jobFactsTiming } from '../job/job.timing.js'
import { resolveStrongIdentityOwner, type JobIdentityService } from '../job/job.identity.js'
import { insertJobCaptureEvidenceReferences, insertJobExternalIdentities, insertJobHistory } from '../job/job.repository.js'

/** Boundary-owned retrieval port — composes the #233 provider-URL resolver. */
export interface JobResolutionPort {
  resolveDestination(input: { workspaceId: string; providerRecordId: string }): Promise<DestinationResolution>
}
export type DestinationResolution =
  | { readonly status: 'resolved'; readonly canonicalUrl: string; readonly classification: 'employer_or_ats' | 'third_party' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'security_rejected' }

export type PromotionWarningCode = 'missing_optional_facts' | 'third_party_destination' | 'retrieval_unavailable'
export interface PromotionWarning {
  readonly code: PromotionWarningCode
  readonly message: string
}

/** #304: the contract warning override — recorded on the promotion's job-history audit (Job has no override column). */
export interface JobWarningOverrideInput {
  readonly actor: { readonly id: string; readonly type: JobActorType; readonly displayName?: string }
  readonly rationale: string
  readonly warningCodes: readonly string[]
}

/** #304: attach/merge onto an explicit existing Job when the caller identifies a duplicate. */
export interface JobDuplicateResolutionInput {
  readonly action: 'attach' | 'merge'
  readonly targetResourceId: string
}

export interface PromoteCaptureInput {
  readonly workspaceId: string
  readonly captureId: string
  readonly actor: JobActor
  /**
   * #304: the contract-valid Job facts to promote with (sparxie `jobFactsSchema`,
   * validated at the promotion boundary). Fixes the #300 placeholder-facts defect:
   * a promoted Job now carries real, schema-valid facts. When omitted (a domain
   * caller with no selected facts, e.g. the manual chain) strict-schema-valid
   * defaults are derived and a `missing_optional_facts` warning is emitted, so the
   * minted Job still satisfies the strict contract.
   */
  readonly selectedFacts?: JsonValue
  /**
   * #304: the Capture revision to bind the produced lineage to. Defaults to the
   * evidence-bearing revision when omitted. A revision that does not exist on the
   * Capture is a typed invalid_input.
   */
  readonly captureRevision?: number
  /** #304: create-dedup key threaded onto the minted Job (a keyed re-promote converges). */
  readonly idempotencyKey?: string
  /**
   * #304: optimistic lineage guard applied on the ATTACH path — the facts revision the
   * caller expects the resolved owner Job to hold. A mismatch is a typed revision_conflict.
   * A freshly created Job is always at revision 1, so the guard is inert on the create path.
   */
  readonly expectedJobFactsRevision?: number
  /**
   * #304: warning override. The accepted design places override persistence ONLY on
   * the Opportunity resource and the Application history audit — the Job aggregate has
   * no override column and no history kind for it. So the override is VALIDATED here
   * (bounded, well-formed, warningCodes in-vocabulary) — a malformed override is a
   * typed invalid_input — but not persisted on the Job. Capture→Job never blocks on a
   * policy warning, so no override is required to proceed.
   */
  readonly override?: JobWarningOverrideInput | null
  /**
   * #304: explicit duplicate resolution onto `targetResourceId` (a JobId). `attach`
   * links this Capture's evidence directly to the target within the promotion tx;
   * `merge` runs the normal create/resolve then composes jobIdentityService.merge to
   * reconcile the two Jobs (merge owns its own transaction — see createManualJob notes).
   */
  readonly duplicateResolution?: JobDuplicateResolutionInput
}

export interface CreateManualJobInput {
  readonly workspaceId: string
  readonly facts: JsonValue
  readonly evidence: readonly CaptureEvidenceInput[]
  readonly providerRecordId?: string | null
  readonly actor: JobActor
}

export type PromotionResult =
  | { readonly ok: true; readonly jobId: string; readonly captureId: string; readonly attached: boolean; readonly created: boolean; readonly warnings: readonly PromotionWarning[] }
  | JobFailure

/** Exact immutable evidence and identity lineage to finalize on an existing Job. */
export interface CanonicalPromotionOnInput {
  readonly workspaceId: string
  readonly captureId: string
  readonly jobId: string
  /** Already admitted by the caller's owning boundary; this core performs no actor parsing. */
  readonly actor: AdmittedCommandActor
  readonly evidenceReferences: readonly {
    readonly captureId: string
    readonly captureRevision: number
    readonly evidenceIndexes: readonly number[]
  }[]
  readonly externalIdentities: readonly {
    readonly kind: 'ats_job' | 'canonical_destination' | 'employer_job' | 'posting'
    readonly provider: string
    readonly account: string | null
    readonly value: string
    readonly strength: 'strong' | 'provisional'
  }[]
}

export interface JobPromotionService {
  promoteCapture(input: PromoteCaptureInput): Promise<PromotionResult>
  /** Shared transaction-composable canonical write core; never starts a transaction. */
  promoteCaptureOn(tx: Tx, input: CanonicalPromotionOnInput): Promise<JobFailure | { readonly ok: true }>
  createManualJob(input: CreateManualJobInput): Promise<PromotionResult>
}

export interface JobPromotionOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
  readonly resolutionPort?: JobResolutionPort
  /** #304: wired only to service `duplicateResolution: { action: 'merge' }`; attach needs no identity service. */
  readonly jobIdentityService?: JobIdentityService
  /**
   * #325: Capture-owned read port for the completed current-version provider-field location
   * outcome. When wired, a promotion fills a null caller-selected location only from a resolved
   * outcome whose country is exactly US or CA; every other outcome stays unknown. Never edits an
   * existing Job and never overrides a non-null caller location.
   */
  readonly locationEvidence?: PromotionLocationEvidencePort
}

/** #325: narrow Capture-owned read port for evidence-backed country prefill. */
export interface PromotionLocationEvidencePort {
  readonly resolverId: string
  readonly resolverVersion: string
  readResolvedLocation(
    exec: CaptureFieldOutcomeExec,
    workspaceId: string,
    captureId: string,
    captureRevision: number,
    resolverId: string,
    resolverVersion: string,
  ): Promise<{ readonly country: 'US' | 'CA'; readonly display: string; readonly city: string | null; readonly region: string | null } | null>
}

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

/** Thrown inside a promotion transaction to roll it back and surface a typed failure. */
class PromotionAbort extends Error {
  constructor(readonly failure: JobFailure) {
    super(failure.message)
    this.name = 'PromotionAbort'
  }
}

interface ResolvedIdentity {
  readonly kind: 'ats_job' | 'canonical_destination' | 'posting'
  readonly provider: string
  readonly account: string | null
  readonly value: string
  readonly strength: 'strong' | 'provisional'
}

/**
 * A strict-schema-valid default Job facts blob (sparxie `jobFactsSchema`) for a
 * promotion that carries no `selectedFacts`. Every required string is non-empty
 * and every enum is a valid literal, so the minted Job passes the contract's
 * strict protocol check; the emptiness is signalled to the caller as a
 * `missing_optional_facts` warning rather than a block.
 */
function deriveDefaultJobFacts(sourceName: string): JsonValue {
  return {
    companyName: 'Unknown',
    roleTitle: 'Unknown',
    sourceName: sourceName.trim().length > 0 ? sourceName : 'unknown',
    roleKind: 'other',
    ...jobFactsTiming({ terms: [], timingMode: 'unknown', startDate: null, endDate: null }),
    location: null,
    workMode: 'unknown',
    employmentType: 'unknown',
    seniority: 'unknown',
    compensation: null,
    postedAt: null,
    destination: null,
  }
}

/** #325: whether the promotion facts blob is a record (so a null `location` can be prefilled). */
function isFactsRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createPgliteJobPromotion(
  database: PgliteDatabase,
  captureService: CaptureService,
  jobService: JobService,
  options: JobPromotionOptions = {},
): JobPromotionService {
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const newId = options.newId ?? createUuidV7Generator(clock)
  const resolutionPort = options.resolutionPort
  const jobIdentityService = options.jobIdentityService

  const ACTOR_TYPES = ['user', 'agent', 'system'] as const

  /**
   * Validate the contract warning override shape (bounded actor/rationale, in-vocabulary
   * warning codes) so a malformed override is a typed invalid_input. The validated value
   * is not persisted on the Job (no override surface — see PromoteCaptureInput.override).
   */
  function validatePromotionOverride(override: JobWarningOverrideInput | null | undefined): JobFailure | null {
    if (override === undefined || override === null) return null
    try {
      const type = override.actor?.type
      if (typeof type !== 'string' || !(ACTOR_TYPES as readonly string[]).includes(type)) {
        throw new JobInputError('invalid_input', 'override.actor.type is invalid')
      }
      requireText(override.actor?.id, 'override.actor.id', 1, WORKSPACE_MAX)
      requireText(override.rationale, 'override.rationale', 1, 4_096)
      if (!Array.isArray(override.warningCodes)) {
        throw new JobInputError('invalid_input', 'override.warningCodes must be an array')
      }
      for (const code of override.warningCodes) {
        if (typeof code !== 'string' || !(lifecycleWarningCodes as readonly string[]).includes(code)) {
          throw new JobInputError('invalid_input', 'override.warningCodes contains an unknown code')
        }
      }
      if (override.actor.displayName !== undefined) requireText(override.actor.displayName, 'override.actor.displayName', 1, WORKSPACE_MAX)
      boundedJson({ rationale: override.rationale, warningCodes: [...override.warningCodes] } as unknown as JsonValue, 'override', AUDIT_MAX)
      return null
    } catch (error) {
      if (error instanceof JobInputError) return fail(error.code, error.message)
      throw error
    }
  }

  function validateOverrideWarnings(
    override: JobWarningOverrideInput | null | undefined,
    warnings: readonly PromotionWarning[],
  ): JobFailure | null {
    if (!override) return null
    const actualCodes = new Set<string>(warnings.map((warning) => (
      warning.code === 'retrieval_unavailable' ? 'weak_possible_match' : warning.code
    )))
    const absent = override.warningCodes.find((code) => !actualCodes.has(code))
    return absent === undefined
      ? null
      : fail('invalid_input', `override warning code ${absent} is not present in the promotion warnings`)
  }

  /** Load an existing target Job for duplicate resolution (workspace-scoped, non-removed). */
  async function loadTargetJob(exec: Tx, workspaceId: string, jobId: string): Promise<{ id: string; factsRevision: number } | null> {
    const [row] = await exec
      .select({ id: jobs.id, factsRevision: jobs.factsRevision, removedAt: jobs.removedAt })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)))
      .limit(1)
    if (!row || row.removedAt !== null) return null
    return { id: row.id, factsRevision: row.factsRevision }
  }

  async function existingLineageJob(exec: Tx, captureId: string): Promise<string | null> {
    const [row] = await exec
      .select({ jobId: jobCaptureEvidenceReferences.jobId })
      .from(jobCaptureEvidenceReferences)
      .where(eq(jobCaptureEvidenceReferences.captureId, captureId))
      .limit(1)
    return row?.jobId ?? null
  }

  // Evidence lives at observation revisions; a head-after-correction revision is
  // empty (inherited seam note). Select the greatest revision that bears evidence.
  async function evidenceBearingRevision(tx: Tx, captureId: string): Promise<{ revision: number; indexes: number[] } | null> {
    const rows = await tx
      .select({ revision: captureEvidenceItems.captureRevision, index: captureEvidenceItems.evidenceIndex })
      .from(captureEvidenceItems)
      .where(eq(captureEvidenceItems.captureId, captureId))
      .orderBy(desc(captureEvidenceItems.captureRevision))
    if (rows.length === 0) return null
    const revision = rows[0]!.revision
    const indexes = rows.filter((r) => r.revision === revision).map((r) => r.index).sort((a, b) => a - b)
    return { revision, indexes }
  }

  /** The sorted evidence indexes recorded at a specific Capture revision (empty at a correction revision). */
  async function evidenceIndexesAt(tx: Tx, captureId: string, revision: number): Promise<number[]> {
    const rows = await tx
      .select({ index: captureEvidenceItems.evidenceIndex })
      .from(captureEvidenceItems)
      .where(and(eq(captureEvidenceItems.captureId, captureId), eq(captureEvidenceItems.captureRevision, revision)))
    return rows.map((r) => r.index).sort((a, b) => a - b)
  }

  /** Whether a Capture revision exists (the lineage FK targets `capture_revisions`). */
  async function revisionExists(tx: Tx, captureId: string, revision: number): Promise<boolean> {
    const [rev] = await tx
      .select({ revision: captureRevisions.revision })
      .from(captureRevisions)
      .where(and(eq(captureRevisions.captureId, captureId), eq(captureRevisions.revision, revision)))
      .limit(1)
    return rev !== undefined
  }

  async function loadCaptureForPromotion(
    tx: Tx,
    workspaceId: string,
    captureId: string,
  ): Promise<{
    readonly evidenceMode: string
    readonly provenance: { readonly adapterId: string; readonly providerRecordId: string | null }
  } | null> {
    const [capture] = await tx.select({
      evidenceMode: captures.evidenceMode,
      adapterId: captures.adapterId,
      providerRecordId: captures.providerRecordId,
    }).from(captures).where(and(
      eq(captures.workspaceId, workspaceId),
      eq(captures.id, captureId),
    )).limit(1).for('update')
    if (!capture) return null
    return {
      evidenceMode: capture.evidenceMode,
      provenance: {
        adapterId: capture.adapterId,
        providerRecordId: capture.providerRecordId,
      },
    }
  }

  async function appendHistory(tx: Tx, jobId: string, kind: string, snapshotJson: BoundedJson<typeof SNAPSHOT_MAX>, actor: AdmittedCommandActor, createdAt: string) {
    const [seqRow] = await tx
      .select({ maxSeq: jobHistory.sequence })
      .from(jobHistory)
      .where(eq(jobHistory.jobId, jobId))
      .orderBy(desc(jobHistory.sequence))
      .limit(1)
    await insertJobHistory(tx).values({
      id: newId(),
      jobId,
      sequence: (seqRow?.maxSeq ?? 0) + 1,
      kind,
      snapshotJson,
      auditJson: auditJson(actor),
      createdAt,
    })
  }

  /** Per-mode authority: reported → strong only via boundary retrieval; ats_details_provided → strong from observed detail. */
  async function resolveIdentity(
    workspaceId: string,
    capture: { evidenceMode: string; provenance: { adapterId: string; providerRecordId?: string | null } },
    warnings: PromotionWarning[],
  ): Promise<ResolvedIdentity | JobFailure> {
    const providerRecordId = capture.provenance.providerRecordId ?? null
    const adapterId = capture.provenance.adapterId.toLowerCase()

    if (capture.evidenceMode === 'ats_details_provided' && providerRecordId) {
      return { kind: 'ats_job', provider: adapterId, account: adapterId, value: providerRecordId, strength: 'strong' }
    }
    if (providerRecordId && resolutionPort) {
      const resolution = await resolutionPort.resolveDestination({ workspaceId, providerRecordId })
      if (resolution.status === 'security_rejected') {
        return fail('security_violation', 'boundary retrieval rejected the destination')
      }
      if (resolution.status === 'resolved') {
        const host = new URL(resolution.canonicalUrl).host.toLowerCase()
        if (resolution.classification === 'employer_or_ats') {
          return { kind: 'canonical_destination', provider: host, account: host, value: resolution.canonicalUrl, strength: 'strong' }
        }
        warnings.push({ code: 'third_party_destination', message: 'resolved destination is a third-party posting' })
        return { kind: 'canonical_destination', provider: host, account: null, value: resolution.canonicalUrl, strength: 'provisional' }
      }
      warnings.push({ code: 'retrieval_unavailable', message: 'boundary retrieval did not resolve a destination' })
    }
    if (!providerRecordId) {
      warnings.push({ code: 'missing_optional_facts', message: 'manual/provider-less capture yields a provisional identity only' })
      return { kind: 'posting', provider: adapterId, account: null, value: `manual:${newId()}`, strength: 'provisional' }
    }
    if (!resolutionPort) {
      warnings.push({ code: 'retrieval_unavailable', message: 'no boundary destination resolver is configured' })
    }
    return { kind: 'posting', provider: adapterId, account: null, value: providerRecordId, strength: 'provisional' }
  }

  // Fix: identities go through the shared bounds validation, so an over-long
  // resolved canonical URL is a typed bounded_data_violation, not a raw DB CHECK.
  function validateResolvedIdentity(identity: ResolvedIdentity): ResolvedIdentity | JobFailure {
    try {
      requireText(identity.value, 'identity.value', 1, 2_048)
      requireText(identity.provider, 'identity.provider', 1, 200)
      if (identity.account !== null) requireText(identity.account, 'identity.account', 1, 500)
      return identity
    } catch (error) {
      if (error instanceof JobInputError) return fail(error.code, error.message)
      throw error
    }
  }

  function mapCaptureFailure(failure: CaptureFailure): JobFailure {
    const code: JobFailureCode = failure.code === 'evidence_mode_conflict' ? 'invalid_input' : failure.code
    return fail(code, failure.message)
  }

  /**
   * Shared canonical finalization core. The caller owns Job creation/attachment
   * and its outer transaction; this owner conversation validates exact Capture
   * lineage, establishes external identities, records their history, and links
   * the immutable evidence references without opening a nested transaction.
   */
  async function promoteCaptureOn(tx: Tx, input: CanonicalPromotionOnInput): Promise<JobFailure | { readonly ok: true }> {
    if (input.evidenceReferences.length === 0) {
      return fail('invalid_input', 'promotion requires at least one evidence reference')
    }
    for (const reference of input.evidenceReferences) {
      if (reference.evidenceIndexes.length === 0) {
        return fail('invalid_input', 'an evidence reference must name at least one evidence item')
      }
      const [capture] = await tx.select({ workspaceId: captures.workspaceId }).from(captures)
        .where(eq(captures.id, reference.captureId)).limit(1)
      if (!capture) return fail('invalid_input', 'an evidence reference names an unknown capture')
      if (capture.workspaceId !== input.workspaceId) return fail('invalid_input', 'an evidence reference belongs to another workspace')
      const [revision] = await tx.select({ revision: captureRevisions.revision }).from(captureRevisions)
        .where(and(eq(captureRevisions.captureId, reference.captureId), eq(captureRevisions.revision, reference.captureRevision))).limit(1)
      if (!revision) return fail('invalid_input', 'an evidence reference names an unknown capture revision')
      const evidence = await tx.select({ index: captureEvidenceItems.evidenceIndex }).from(captureEvidenceItems)
        .where(and(
          eq(captureEvidenceItems.captureId, reference.captureId),
          eq(captureEvidenceItems.captureRevision, reference.captureRevision),
        ))
      const availableIndexes = new Set(evidence.map((item) => item.index))
      const requestedIndexes = new Set<number>()
      for (const index of reference.evidenceIndexes) {
        if (!Number.isSafeInteger(index) || index < 0 || !availableIndexes.has(index) || requestedIndexes.has(index)) {
          return fail('invalid_input', 'an evidence reference names an unknown or repeated evidence item')
        }
        requestedIndexes.add(index)
      }
    }
    const timestamp = nowIso()
    for (const identity of input.externalIdentities) {
      try {
        requireText(identity.value, 'identity.value', 1, 2_048)
        requireText(identity.provider, 'identity.provider', 1, 200)
        if (identity.account !== null) requireText(identity.account, 'identity.account', 1, 500)
      } catch (error) {
        if (error instanceof JobInputError) return fail(error.code, error.message)
        throw error
      }
      if (identity.strength === 'strong') {
        const owner = await resolveStrongIdentityOwner(tx, input.workspaceId, identity)
        if (owner && owner.jobId !== input.jobId) {
          return fail('strong_identity_conflict', 'the strong identity is already owned by another Job')
        }
      }
      const [existing] = await tx.select({ id: jobExternalIdentities.id }).from(jobExternalIdentities)
        .where(and(
          eq(jobExternalIdentities.jobId, input.jobId), eq(jobExternalIdentities.kind, identity.kind),
          eq(jobExternalIdentities.provider, identity.provider),
          sql`coalesce(${jobExternalIdentities.account}, '') = ${identity.account ?? ''}`,
          eq(jobExternalIdentities.value, identity.value),
        )).limit(1)
      if (existing) continue
      await insertJobExternalIdentities(tx).values({
        id: newId(), jobId: input.jobId, kind: identity.kind, provider: identity.provider,
        account: identity.account, value: identity.value, strength: identity.strength,
        provenanceKind: 'promotion', provenanceVersion: '1',
        evidenceJson: JSON.stringify({ captureId: input.captureId, evidenceReferences: input.evidenceReferences }),
        createdAt: timestamp,
      })
      await appendHistory(tx, input.jobId, 'identity_added', boundedJson(identity as unknown as JsonValue, 'snapshot', SNAPSHOT_MAX), input.actor, timestamp)
    }
    for (const reference of input.evidenceReferences) {
      await insertJobCaptureEvidenceReferences(tx).values({
        id: newId(), jobId: input.jobId, captureId: reference.captureId,
        captureRevision: reference.captureRevision,
        evidenceIndexesJson: JSON.stringify(reference.evidenceIndexes), createdAt: timestamp,
      }).onConflictDoNothing()
    }
    return { ok: true }
  }

  return {
    promoteCaptureOn,
    async promoteCapture(input) {
      let workspaceId: string
      let captureId: string
      let actor: AdmittedCommandActor
      let idempotencyKey: string | undefined
      let dedup: JobDuplicateResolutionInput | undefined
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        captureId = requireText(input.captureId, 'captureId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
        idempotencyKey = input.idempotencyKey === undefined ? undefined : requireText(input.idempotencyKey, 'idempotencyKey', 1, 200)
        if (input.duplicateResolution !== undefined) {
          const action = input.duplicateResolution.action
          if (action !== 'attach' && action !== 'merge') throw new JobInputError('invalid_input', 'duplicateResolution.action must be attach or merge')
          const targetResourceId = requireText(input.duplicateResolution.targetResourceId, 'duplicateResolution.targetResourceId', 1, WORKSPACE_MAX)
          dedup = { action, targetResourceId }
        }
      } catch (error) {
        if (error instanceof JobInputError) return fail(error.code, error.message)
        return fail('invalid_input', error instanceof Error ? error.message : 'invalid input')
      }
      // Validate the (non-persisted) override shape up front.
      const overrideFailure = validatePromotionOverride(input.override)
      if (overrideFailure) return overrideFailure
      if (dedup?.action === 'merge' && !jobIdentityService) {
        return fail('invalid_input', 'duplicateResolution: merge requires a wired job identity service')
      }
      const expectedFactsRevision = input.expectedJobFactsRevision

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const outcome = await database.transaction(async (tx) => {
            // Load and lock every Capture fact that determines a Job write before
            // consulting lineage or boundary resolution.
            const capture = await loadCaptureForPromotion(tx, workspaceId, captureId)
            if (!capture) throw new PromotionAbort(fail('not_found', 'capture not found in this workspace'))
            const bearing = await evidenceBearingRevision(tx, captureId)
            if (!bearing) throw new PromotionAbort(fail('invalid_input', 'capture has no observed evidence to promote'))

            // Bind lineage to a validated, transaction-consistent evidence revision.
            let link = bearing
            if (input.captureRevision !== undefined && input.captureRevision !== bearing.revision) {
              if (!(await revisionExists(tx, captureId, input.captureRevision))) {
                throw new PromotionAbort(fail('invalid_input', 'captureRevision does not exist for this capture'))
              }
              link = {
                revision: input.captureRevision,
                indexes: await evidenceIndexesAt(tx, captureId, input.captureRevision),
              }
            }

            let promotionFacts = input.selectedFacts ?? deriveDefaultJobFacts(capture.provenance.adapterId)
            const locationEvidence = options.locationEvidence
            if (locationEvidence && isFactsRecord(promotionFacts) && promotionFacts.location === null) {
              const evidence = await locationEvidence.readResolvedLocation(
                tx,
                workspaceId,
                captureId,
                link.revision,
                locationEvidence.resolverId,
                locationEvidence.resolverVersion,
              )
              if (evidence) {
                const location = jobLocationSchema.safeParse({
                  display: evidence.display,
                  city: evidence.city,
                  region: evidence.region,
                  country: evidence.country,
                })
                if (location.success) promotionFacts = { ...promotionFacts, location: location.data }
              }
            }
            const factsWarning: PromotionWarning | null = input.selectedFacts === undefined
              ? { code: 'missing_optional_facts', message: 'promoted with derived default facts; no selected facts were provided' }
              : null
            const replayWarnings: PromotionWarning[] = []
            if (!capture.provenance.providerRecordId) {
              replayWarnings.push({ code: 'missing_optional_facts', message: 'manual/provider-less capture yields a provisional identity only' })
            } else if (!resolutionPort && capture.evidenceMode !== 'ats_details_provided') {
              replayWarnings.push({ code: 'retrieval_unavailable', message: 'no boundary destination resolver is configured' })
            }
            if (factsWarning) replayWarnings.push(factsWarning)
            // Idempotency BEFORE any boundary retrieval.
            const linked = await existingLineageJob(tx, captureId)
            if (linked) {
              if (dedup && dedup.targetResourceId !== linked) {
                throw new PromotionAbort(fail('invalid_input', 'duplicateResolution.targetResourceId does not match the Job already linked to this Capture'))
              }
              const invalidOverride = validateOverrideWarnings(input.override, replayWarnings)
              if (invalidOverride) throw new PromotionAbort(invalidOverride)
              return { ok: true as const, jobId: linked, captureId, attached: true, created: false, warnings: replayWarnings }
            }

            // Explicit ATTACH: link the Capture directly to the caller-identified Job,
            // skipping identity resolution/creation entirely (composes the Job-owned
            // linkCapture helper — scanner-clean). MERGE falls through to create/resolve
            // and reconciles after the transaction commits.
            if (dedup?.action === 'attach') {
              const target = await loadTargetJob(tx, workspaceId, dedup.targetResourceId)
              if (!target) throw new PromotionAbort(fail('not_found', 'duplicateResolution.targetResourceId is not an active job in this workspace'))
              if (expectedFactsRevision !== undefined && expectedFactsRevision !== target.factsRevision) {
                throw new PromotionAbort(fail('revision_conflict', 'target job facts advanced since evaluation'))
              }
              const finalized = await promoteCaptureOn(tx, {
                workspaceId, captureId, jobId: target.id, actor,
                evidenceReferences: [{ captureId, captureRevision: link.revision, evidenceIndexes: link.indexes }],
                externalIdentities: [],
              })
              if (!finalized.ok) throw new PromotionAbort(finalized)
              const invalidOverride = validateOverrideWarnings(input.override, replayWarnings)
              if (invalidOverride) throw new PromotionAbort(invalidOverride)
              return { ok: true as const, jobId: target.id, captureId, attached: true, created: false, warnings: replayWarnings }
            }

            const warnings: PromotionWarning[] = []
            const resolved = await resolveIdentity(workspaceId, capture, warnings)
            if ('ok' in resolved) throw new PromotionAbort(resolved)
            const validated = validateResolvedIdentity(resolved)
            if ('ok' in validated) throw new PromotionAbort(validated)

            const owner = validated.strength === 'strong'
              ? await resolveStrongIdentityOwner(tx, workspaceId, validated)
              : null
            if (owner) {
              if (expectedFactsRevision !== undefined) {
                const target = await loadTargetJob(tx, workspaceId, owner.jobId)
                if (target && expectedFactsRevision !== target.factsRevision) {
                  throw new PromotionAbort(fail('revision_conflict', 'resolved owner job facts advanced since evaluation'))
                }
              }
              const invalidOverride = validateOverrideWarnings(input.override, warnings)
              if (invalidOverride) throw new PromotionAbort(invalidOverride)
              const finalized = await promoteCaptureOn(tx, {
                workspaceId, captureId, jobId: owner.jobId, actor,
                evidenceReferences: [{ captureId, captureRevision: link.revision, evidenceIndexes: link.indexes }],
                externalIdentities: [],
              })
              if (!finalized.ok) throw new PromotionAbort(finalized)
              return { ok: true as const, jobId: owner.jobId, captureId, attached: true, created: false, warnings }
            }
            if (factsWarning) warnings.push(factsWarning)
            const invalidOverride = validateOverrideWarnings(input.override, warnings)
            if (invalidOverride) throw new PromotionAbort(invalidOverride)
            const created = await jobService.createOn(tx, { workspaceId, facts: promotionFacts, actor, idempotencyKey })
            if (!created.ok) throw new PromotionAbort(created)
            const finalized = await promoteCaptureOn(tx, {
              workspaceId, captureId, jobId: created.job.id, actor,
              evidenceReferences: [{ captureId, captureRevision: link.revision, evidenceIndexes: link.indexes }],
              externalIdentities: [validated],
            })
            if (!finalized.ok) throw new PromotionAbort(finalized)
            if (dedup?.action === 'merge') {
              const merged = await jobIdentityService!.mergeOn(tx, {
                workspaceId,
                jobIdA: created.job.id,
                jobIdB: dedup.targetResourceId,
                actor,
              })
              if (!merged.ok) throw new PromotionAbort(merged)
              return { ok: true as const, jobId: merged.winnerJobId, captureId, attached: true, created: false, warnings }
            }
            return { ok: true as const, jobId: created.job.id, captureId, attached: false, created: created.created, warnings }
          })
          return outcome
        } catch (error) {
          if (error instanceof PromotionAbort) return error.failure
          // Cross-capture strong-index ATTACH race: another capture claimed the same
          // strong identity first. On this retry the resolver may legitimately re-fire
          // for a NEVER-promoted capture — the at-most-once resolver guarantee is
          // scoped to re-promotes (the lineage short-circuit above), not to a fresh
          // capture losing a strong-identity race.
          if (isUniqueViolation(error)) continue
          throw error
        }
      }
      return fail('revision_conflict', 'promotion could not converge under contention')
    },

    async createManualJob(input) {
      let workspaceId: string
      let actor: AdmittedCommandActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
      } catch (error) {
        return fail('invalid_input', error instanceof Error ? error.message : 'invalid input')
      }
      const providerRecordId = input.providerRecordId ?? null
      // Import-style manual creation carries a provider record id (so #299 provenance
      // idempotency dedups the Capture); a bare manual creation carries none.
      const adapter = providerRecordId ? 'import' : 'manual'
      const createdAt = nowIso()
      try {
        return await database.transaction(async (tx) => {
          const accepted = await captureService.acceptOn(tx, {
            workspaceId,
            provenance: { adapterId: adapter, adapterKind: adapter, adapterVersion: '1.0.0', providerRecordId, providerSchema: null, observedAt: createdAt },
            evidenceMode: 'reported',
            evidence: input.evidence,
            actor,
          })
          if (!accepted.ok) throw new PromotionAbort(mapCaptureFailure(accepted))
          const created = await jobService.createOn(tx, { workspaceId, facts: input.facts, actor })
          if (!created.ok) throw new PromotionAbort(created)
          // Link the EVIDENCE-BEARING head revision: a second import with the same
          // providerRecordId dedups to the existing Capture and appendObservation
          // advances the revision, storing the new evidence there. Hardcoding
          // revision 1 would point the lineage at a stale revision whose evidence
          // indexes differ from the new array (a silent, FK-satisfied corruption).
          const finalized = await promoteCaptureOn(tx, {
            workspaceId, captureId: accepted.capture.id, jobId: created.job.id, actor,
            evidenceReferences: [{ captureId: accepted.capture.id, captureRevision: accepted.capture.revision, evidenceIndexes: input.evidence.map((_, index) => index) }],
            externalIdentities: [],
          })
          if (!finalized.ok) throw new PromotionAbort(finalized)
          return { ok: true as const, jobId: created.job.id, captureId: accepted.capture.id, attached: false, created: true, warnings: [] }
        })
      } catch (error) {
        if (error instanceof PromotionAbort) return error.failure
        if (isUniqueViolation(error)) return fail('revision_conflict', 'manual job creation raced concurrently')
        throw error
      }
    },
  }
}
