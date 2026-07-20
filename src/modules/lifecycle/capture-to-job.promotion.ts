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
import { and, desc, eq } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7'
import { jobCaptureEvidenceReferences, jobHistory } from '../../db/schema'
import { captureEvidenceItems, lifecycleCaptures } from '../capture/capture.schema'
import type { CaptureEvidenceInput, CaptureFailure, CaptureService, JsonValue } from '../capture/capture.service'
import type { JobActor, JobService } from '../job/job.service'
import {
  type JobFailure,
  type JobFailureCode,
  JobInputError,
  WORKSPACE_MAX,
  auditJson,
  fail,
  isUniqueViolation,
  requireActor,
  requireText,
} from '../job/job.validation'
import { resolveStrongIdentityOwner } from '../job/job.identity'
import { insertJobCaptureEvidenceReferences, insertJobExternalIdentities, insertJobHistory } from '../job/job.repository'

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

export interface PromoteCaptureInput {
  readonly workspaceId: string
  readonly captureId: string
  readonly actor: JobActor
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

export interface JobPromotionService {
  promoteCapture(input: PromoteCaptureInput): Promise<PromotionResult>
  createManualJob(input: CreateManualJobInput): Promise<PromotionResult>
}

export interface JobPromotionOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
  readonly resolutionPort?: JobResolutionPort
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
  async function evidenceBearingRevision(captureId: string): Promise<{ revision: number; indexes: number[] } | null> {
    const rows = await database
      .select({ revision: captureEvidenceItems.captureRevision, index: captureEvidenceItems.evidenceIndex })
      .from(captureEvidenceItems)
      .where(eq(captureEvidenceItems.captureId, captureId))
      .orderBy(desc(captureEvidenceItems.captureRevision))
    if (rows.length === 0) return null
    const revision = rows[0]!.revision
    const indexes = rows.filter((r) => r.revision === revision).map((r) => r.index).sort((a, b) => a - b)
    return { revision, indexes }
  }

  async function appendHistory(tx: Tx, jobId: string, kind: string, snapshotJson: string, actor: JobActor, createdAt: string) {
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

  async function linkCapture(tx: Tx, jobId: string, captureId: string, revision: number, indexes: number[], createdAt: string) {
    await insertJobCaptureEvidenceReferences(tx).values({
      id: newId(),
      jobId,
      captureId,
      captureRevision: revision,
      evidenceIndexesJson: JSON.stringify(indexes.length > 0 ? indexes : [0]),
      createdAt,
    })
  }

  async function establishPromotionIdentity(tx: Tx, jobId: string, captureId: string, revision: number, identity: ResolvedIdentity, actor: JobActor, createdAt: string) {
    await insertJobExternalIdentities(tx).values({
      id: newId(),
      jobId,
      kind: identity.kind,
      provider: identity.provider,
      account: identity.account,
      value: identity.value,
      strength: identity.strength,
      provenanceKind: 'promotion',
      provenanceVersion: '1',
      evidenceJson: JSON.stringify({ captureId, revision }),
      createdAt,
    })
    await appendHistory(tx, jobId, 'identity_added', JSON.stringify({ kind: identity.kind, value: identity.value }), actor, createdAt)
  }

  function mapCaptureFailure(failure: CaptureFailure): JobFailure {
    const code: JobFailureCode = failure.code === 'evidence_mode_conflict' ? 'invalid_input' : failure.code
    return fail(code, failure.message)
  }

  return {
    async promoteCapture(input) {
      let workspaceId: string
      let captureId: string
      let actor: JobActor
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        captureId = requireText(input.captureId, 'captureId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
      } catch (error) {
        return fail('invalid_input', error instanceof Error ? error.message : 'invalid input')
      }
      const capture = await captureService.get(workspaceId, captureId)
      if (!capture) return fail('not_found', 'capture not found in this workspace')
      const bearing = await evidenceBearingRevision(captureId)
      if (!bearing) return fail('invalid_input', 'capture has no observed evidence to promote')

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await database.transaction(async (tx) => {
            // Serialize concurrent promotions of THIS capture on real Postgres.
            await tx.select({ id: lifecycleCaptures.id }).from(lifecycleCaptures)
              .where(and(eq(lifecycleCaptures.workspaceId, workspaceId), eq(lifecycleCaptures.id, captureId)))
              .for('update')
            // Idempotency BEFORE any boundary retrieval.
            const linked = await existingLineageJob(tx, captureId)
            if (linked) return { ok: true as const, jobId: linked, captureId, attached: true, created: false, warnings: [] }

            const warnings: PromotionWarning[] = []
            const resolved = await resolveIdentity(workspaceId, capture, warnings)
            if ('ok' in resolved) throw new PromotionAbort(resolved)
            const validated = validateResolvedIdentity(resolved)
            if ('ok' in validated) throw new PromotionAbort(validated)

            const owner = validated.strength === 'strong'
              ? await resolveStrongIdentityOwner(tx, workspaceId, validated)
              : null
            const createdAt = nowIso()
            if (owner) {
              await linkCapture(tx, owner.jobId, captureId, bearing.revision, bearing.indexes, createdAt)
              return { ok: true as const, jobId: owner.jobId, captureId, attached: true, created: false, warnings }
            }
            const created = await jobService.createOn(tx, { workspaceId, facts: { source: 'promotion', captureId, evidenceMode: capture.evidenceMode }, actor })
            if (!created.ok) throw new PromotionAbort(created)
            await establishPromotionIdentity(tx, created.job.id, captureId, bearing.revision, validated, actor, createdAt)
            await linkCapture(tx, created.job.id, captureId, bearing.revision, bearing.indexes, createdAt)
            return { ok: true as const, jobId: created.job.id, captureId, attached: false, created: true, warnings }
          })
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
      let actor: JobActor
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
          await linkCapture(tx, created.job.id, accepted.capture.id, accepted.capture.revision, input.evidence.map((_, index) => index), createdAt)
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
