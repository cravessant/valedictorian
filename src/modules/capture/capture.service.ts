/**
 * Capture aggregate — the user-controlled durable module contract (issue #299).
 *
 * One contract through which user, connector, CLI, and import creation differ
 * ONLY by typed provenance (`adapterKind`) and declared capability
 * (`evidenceMode`), never by downstream control. The service writes the canonical
 * `captures` / `capture_revisions` / `capture_evidence_items` tables
 * (Capture-owned; see capture.repository.ts) and exposes narrow read/write
 * conversations to lifecycle orchestration.
 *
 * Invariants enforced here:
 *  - Provenance identity resolves to ONE Capture id forever. `accept` is
 *    idempotent by (workspace, adapter, provider_record_id) via the 0002 partial
 *    unique index; manual captures (null provider_record_id) never collide.
 *  - Evidence mode is IMMUTABLE per Capture: a re-intake declaring a different
 *    mode is rejected, never silently mutated.
 *  - Observed evidence (`capture_evidence_items`) is append-only and is NEVER
 *    rewritten by user corrections — history keeps observed evidence separate
 *    from user changes. Adapter re-observation records a `corrected` revision
 *    (the revision-kind enum is mirrored contract vocabulary — `created/
 *    corrected/removed/restored` — and is not extended locally), distinguished
 *    from a user correction by the audit actor (`system`/`agent` vs `user`) and
 *    by carrying new evidence items. This structural split (append-only evidence
 *    = observed; revisions + actor = agency) is the umbrella's "observed evidence
 *    separately from user changes".
 *  - Removal is an explicit tombstone (`removed_at`); adapter re-observation of a
 *    tombstoned Capture appends occurrences/revisions but NEVER clears the
 *    tombstone. Restore is an explicit, deterministic user command.
 *
 * #299 wires NO adapter to this contract for the connector path (that write move
 * is co-sequenced with the read cutover at #304) and enqueues NO scheduled work
 * (canonical scheduled-work adoption is #303; promotion + its scheduling is #300).
 * The contract is exercised red-first through its public commands/queries.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import {
  captureConnectorProvenanceSchema,
  type CaptureConnectorProvenance,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { captureEvidenceModes, captureSourceAdapterKinds } from '../../db/lifecycle-vocabulary'
import { LIFECYCLE_ID_MAX as WORKSPACE_MAX, type AdmittedCommandActor, type BoundedJson, type LifecycleActorInput, type LifecycleActorType, actorAuditJson as auditJson, admitBoundedJson, admitCommandActor, admitLifecycleId, isUniqueViolation, owning, safeParseJson } from '../lifecycle/lifecycle-representation'
import {
  captureEvidenceItems,
  captureRevisions,
  captures,
} from './capture.schema'
import {
  insertCaptureEvidenceItems,
  insertCaptureOccurrences,
  insertCaptureRevisions,
  insertCaptures,
  updateCaptures,
} from './capture.repository'

export type { JsonValue } from '../lifecycle/lifecycle-representation'
import type { JsonValue } from '../lifecycle/lifecycle-representation'

export type CaptureEvidenceMode = (typeof captureEvidenceModes)[number]
export type CaptureAdapterKind = (typeof captureSourceAdapterKinds)[number]
export type CaptureActorType = LifecycleActorType
export type CaptureRevisionKind = 'created' | 'corrected' | 'removed' | 'restored'

/** Untrusted actor as it arrives on a Capture command. */
export type CaptureActor = LifecycleActorInput

export interface CaptureProvenance {
  readonly adapterId: string
  readonly adapterKind: CaptureAdapterKind
  readonly adapterVersion: string
  readonly providerRecordId?: string | null
  readonly providerSchema?: string | null
  readonly observedAt: string
}

export interface CaptureEvidenceInput {
  readonly kind: string
  readonly label: string
  readonly value: JsonValue
}

export interface AcceptCaptureInput {
  readonly workspaceId: string
  readonly provenance: CaptureProvenance
  readonly evidenceMode: CaptureEvidenceMode
  readonly evidence: readonly CaptureEvidenceInput[]
  readonly payload?: JsonValue | null
  readonly connectorProvenance?: CaptureConnectorProvenance | null
  readonly actor: CaptureActor
}

export interface CorrectCaptureInput {
  readonly workspaceId: string
  readonly captureId: string
  readonly correction: JsonValue
  readonly actor: CaptureActor
  readonly expectedRevision?: number
}

export interface CaptureMutationInput {
  readonly workspaceId: string
  readonly captureId: string
  readonly actor: CaptureActor
  readonly expectedRevision?: number
}

export interface CaptureRecord {
  readonly id: string
  readonly workspaceId: string
  readonly evidenceMode: CaptureEvidenceMode
  readonly provenance: CaptureProvenance
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

export interface CaptureRevisionRecord {
  readonly revision: number
  readonly kind: CaptureRevisionKind
  readonly actor: CaptureActor
  readonly createdAt: string
}

export interface CaptureEvidenceItemRecord {
  readonly revision: number
  readonly index: number
  readonly kind: string
  readonly label: string
  readonly value: JsonValue
}

export interface CaptureEvidenceView {
  readonly captureId: string
  readonly evidenceMode: CaptureEvidenceMode
  readonly items: readonly CaptureEvidenceItemRecord[]
}

export type CaptureFailureCode =
  | 'invalid_input'
  | 'bounded_data_violation'
  | 'security_violation'
  | 'not_found'
  | 'evidence_mode_conflict'
  | 'revision_conflict'

export interface CaptureFailure {
  readonly ok: false
  readonly code: CaptureFailureCode
  readonly message: string
}

export interface AcceptedConnectorRevision {
  readonly revision: number
  readonly contentHash: string
  readonly reused: boolean
  readonly createdAt: string
  readonly occurrenceId: string
  readonly occurrenceReceivedAt: string
}

export type AcceptCaptureResult =
  | {
      readonly ok: true
      readonly capture: CaptureRecord
      readonly created: boolean
      readonly connectorRevision?: AcceptedConnectorRevision
    }
  | CaptureFailure

export type MutateCaptureResult = { readonly ok: true; readonly capture: CaptureRecord } | CaptureFailure

export interface CaptureService {
  accept(input: AcceptCaptureInput): Promise<AcceptCaptureResult>
  correct(input: CorrectCaptureInput): Promise<MutateCaptureResult>
  remove(input: CaptureMutationInput): Promise<MutateCaptureResult>
  restore(input: CaptureMutationInput): Promise<MutateCaptureResult>
  /**
   * Composable cores for lifecycle orchestration: run a SINGLE attempt on the
   * caller's transaction executor (no internal transaction) so a promotion can
   * compose Capture + Job writes in one atomic boundary. Same validation and
   * idempotency semantics as the standalone `accept`/`correct` (one shared
   * implementation); may THROW a unique-violation for the caller to retry.
   */
  acceptOn(exec: CaptureExec, input: AcceptCaptureInput): Promise<AcceptCaptureResult>
  correctOn(exec: CaptureExec, input: CorrectCaptureInput): Promise<MutateCaptureResult>
  /** Composable tombstone core: run a single Capture tombstone on the caller's transaction executor (no internal tx). */
  removeOn(exec: CaptureExec, input: CaptureMutationInput): Promise<MutateCaptureResult>
  /** Composable restore core: clear a Capture tombstone on the caller's transaction executor (no internal tx). */
  restoreOn(exec: CaptureExec, input: CaptureMutationInput): Promise<MutateCaptureResult>
  get(workspaceId: string, captureId: string): Promise<CaptureRecord | null>
  getByProvenance(
    workspaceId: string,
    adapterId: string,
    providerSchema: string | null,
    providerRecordId: string,
  ): Promise<CaptureRecord | null>
  history(workspaceId: string, captureId: string): Promise<readonly CaptureRevisionRecord[]>
  evidence(workspaceId: string, captureId: string): Promise<CaptureEvidenceView | null>
}

export interface CaptureServiceOptions {
  readonly now?: () => Date
  readonly newId?: () => string
}

// --- Bounds (mirror the schema CHECK constraints so the DB never rejects). ---
const ADAPTER_VERSION_MAX = 100
const PROVIDER_FIELD_MAX = 500
const PAYLOAD_MAX = 262_144
const SNAPSHOT_MAX = 262_144
const EVIDENCE_VALUE_MAX = 16_384
const EVIDENCE_KIND_MAX = 100
const EVIDENCE_LABEL_MAX = 200
const EVIDENCE_MAX_ITEMS = 50

class CaptureInputError extends Error {
  constructor(
    readonly code: CaptureFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'CaptureInputError'
  }
}

function fail(code: CaptureFailureCode, message: string): CaptureFailure {
  return { ok: false, code, message }
}

const requireId = owning(admitLifecycleId, CaptureInputError)
const boundedJson = owning(admitBoundedJson, CaptureInputError)
const requireActor = owning(admitCommandActor, CaptureInputError)

/** Capture-owned free text: adapter/provider fields, evidence kind/label, instants. */
function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new CaptureInputError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new CaptureInputError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > max) throw new CaptureInputError('bounded_data_violation', `${field} exceeds ${max} characters`)
  return trimmed
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, field, 1, max)
}

function validateProvenance(provenance: CaptureProvenance) {
  const adapterKind = provenance.adapterKind
  if (!(captureSourceAdapterKinds as readonly string[]).includes(adapterKind)) {
    throw new CaptureInputError('invalid_input', 'provenance.adapterKind is invalid')
  }
  return {
    adapterId: requireText(provenance.adapterId, 'provenance.adapterId', 1, WORKSPACE_MAX),
    adapterKind,
    adapterVersion: requireText(provenance.adapterVersion, 'provenance.adapterVersion', 1, ADAPTER_VERSION_MAX),
    providerRecordId: optionalText(provenance.providerRecordId, 'provenance.providerRecordId', PROVIDER_FIELD_MAX),
    providerSchema: optionalText(provenance.providerSchema, 'provenance.providerSchema', PROVIDER_FIELD_MAX),
    observedAt: requireText(provenance.observedAt, 'provenance.observedAt', 1, WORKSPACE_MAX),
  }
}

function validateEvidence(evidence: readonly CaptureEvidenceInput[]) {
  if (!Array.isArray(evidence)) throw new CaptureInputError('invalid_input', 'evidence must be an array')
  if (evidence.length > EVIDENCE_MAX_ITEMS) {
    throw new CaptureInputError('bounded_data_violation', `evidence exceeds ${EVIDENCE_MAX_ITEMS} items`)
  }
  return evidence.map((item, index) => ({
    kind: requireText(item?.kind, `evidence[${index}].kind`, 1, EVIDENCE_KIND_MAX),
    label: requireText(item?.label, `evidence[${index}].label`, 1, EVIDENCE_LABEL_MAX),
    valueJson: boundedJson(item?.value as JsonValue, `evidence[${index}].value`, EVIDENCE_VALUE_MAX),
  }))
}

function validateConnectorProvenance(
  provenance: CaptureConnectorProvenance | null | undefined,
): CaptureConnectorProvenance | null {
  if (provenance === undefined || provenance === null) return null
  try {
    return captureConnectorProvenanceSchema.parse(provenance)
  } catch {
    throw new CaptureInputError('invalid_input', 'connectorProvenance is invalid')
  }
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function connectorContentHash(
  input: AcceptCaptureInput,
  provenance: ReturnType<typeof validateProvenance>,
  evidence: ReturnType<typeof validateEvidence>,
  connectorProvenance: CaptureConnectorProvenance,
): string {
  const canonical = stableJsonStringify({
    adapter: {
      id: provenance.adapterId,
      kind: provenance.adapterKind,
      version: provenance.adapterVersion,
    },
    evidence: evidence.map((item) => ({
      kind: item.kind,
      label: item.label,
      value: JSON.parse(item.valueJson) as JsonValue,
    })),
    payload: input.payload ?? null,
    providerRecordId: provenance.providerRecordId,
    providerSchema: provenance.providerSchema,
    reportedOrigin: connectorProvenance.reportedOrigin ?? null,
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

interface CaptureRow {
  id: string
  workspaceId: string
  evidenceMode: string
  adapterId: string
  adapterKind: string
  adapterVersion: string
  observedAt: string
  receivedAt: string
  providerRecordId: string | null
  providerSchema: string | null
  revision: number
  createdAt: string
  updatedAt: string
  removedAt: string | null
}

function toRecord(row: CaptureRow): CaptureRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    evidenceMode: row.evidenceMode as CaptureEvidenceMode,
    provenance: {
      adapterId: row.adapterId,
      adapterKind: row.adapterKind as CaptureAdapterKind,
      adapterVersion: row.adapterVersion,
      providerRecordId: row.providerRecordId,
      providerSchema: row.providerSchema,
      observedAt: row.observedAt,
    },
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    removedAt: row.removedAt,
  }
}

/** A read+write executor — the workspace database OR an open transaction. */
export type CaptureExec = Pick<PgliteDatabase, 'select' | 'insert' | 'update'>

export function createPgliteCaptureService(
  database: PgliteDatabase,
  options: CaptureServiceOptions = {},
): CaptureService {
  const nowIso = () => (options.now?.() ?? new Date()).toISOString()
  const newId = options.newId ?? (() => randomUUID())

  async function selectById(exec: CaptureExec, workspaceId: string, captureId: string): Promise<CaptureRow | null> {
    const [row] = await exec
      .select()
      .from(captures)
      .where(and(eq(captures.workspaceId, workspaceId), eq(captures.id, captureId)))
      .limit(1)
    return (row as CaptureRow | undefined) ?? null
  }

  async function selectByProvenance(
    exec: CaptureExec,
    workspaceId: string,
    adapterId: string,
    providerSchema: string | null,
    providerRecordId: string,
  ): Promise<CaptureRow | null> {
    const [row] = await exec
      .select()
      .from(captures)
      .where(
        and(
          eq(captures.workspaceId, workspaceId),
          eq(captures.adapterId, adapterId),
          // Provenance identity includes provider_schema (matching the legacy
          // connector lineage key + the 0002 partial unique index), so the same
          // adapter re-observing a provider record under a bumped schema stays a
          // distinct capture.
          sql`coalesce(${captures.providerSchema}, '') = ${providerSchema ?? ''}`,
          eq(captures.providerRecordId, providerRecordId),
        ),
      )
      .limit(1)
    return (row as CaptureRow | undefined) ?? null
  }

  async function selectRevisionByContent(
    exec: CaptureExec,
    captureId: string,
    contentHash: string,
  ): Promise<{ revision: number; createdAt: string } | null> {
    const [row] = await exec
      .select({ revision: captureRevisions.revision, createdAt: captureRevisions.createdAt })
      .from(captureRevisions)
      .where(and(eq(captureRevisions.captureId, captureId), eq(captureRevisions.contentHash, contentHash)))
      .limit(1)
    return row ?? null
  }

  async function recordConnectorOccurrence(
    exec: CaptureExec,
    input: {
      captureId: string
      captureRevision: number
      connectorProvenance: CaptureConnectorProvenance
      observedAt: string
      receivedAt: string
    },
  ): Promise<string> {
    const occurrenceId = newId()
    await insertCaptureOccurrences(exec).values({
      id: occurrenceId,
      captureId: input.captureId,
      captureRevision: input.captureRevision,
      connectorInstanceId: input.connectorProvenance.connectorInstanceId,
      connectorRunId: input.connectorProvenance.connectorRunId,
      executionScopeId: input.connectorProvenance.executionScopeId,
      observedAt: input.observedAt,
      receivedAt: input.receivedAt,
    })
    return occurrenceId
  }

  function observedSnapshot(
    provenance: ReturnType<typeof validateProvenance>,
    evidenceMode: CaptureEvidenceMode,
    revision: number,
  ): BoundedJson<typeof SNAPSHOT_MAX> {
    return boundedJson(
      {
        evidenceMode,
        adapterId: provenance.adapterId,
        adapterKind: provenance.adapterKind,
        adapterVersion: provenance.adapterVersion,
        providerRecordId: provenance.providerRecordId,
        providerSchema: provenance.providerSchema,
        observedAt: provenance.observedAt,
        revision,
      },
      'snapshot',
      SNAPSHOT_MAX,
    )
  }

  async function appendObservation(
    tx: CaptureExec,
    existing: CaptureRow,
    provenance: ReturnType<typeof validateProvenance>,
    evidenceMode: CaptureEvidenceMode,
    evidence: ReturnType<typeof validateEvidence>,
    actor: AdmittedCommandActor,
    connectorProvenance: CaptureConnectorProvenance | null,
    contentHash: string | null,
    payloadJson: string | null,
    createdAt: string,
  ): Promise<CaptureRecord> {
    const revision = existing.revision + 1
    await insertCaptureRevisions(tx).values({
      captureId: existing.id,
      revision,
      kind: 'corrected',
      snapshotJson: observedSnapshot(provenance, evidenceMode, revision),
      auditJson: auditJson(actor),
      connectorInstanceId: connectorProvenance?.connectorInstanceId ?? null,
      connectorRunId: connectorProvenance?.connectorRunId ?? null,
      executionScopeId: connectorProvenance?.executionScopeId ?? null,
      reportedOriginJson: connectorProvenance?.reportedOrigin === undefined
        ? null
        : JSON.stringify(connectorProvenance.reportedOrigin),
      contentHash,
      payloadJson,
      createdAt,
    })
    if (evidence.length > 0) {
      await insertCaptureEvidenceItems(tx).values(
        evidence.map((item, index) => ({
          id: newId(),
          captureId: existing.id,
          captureRevision: revision,
          evidenceIndex: index,
          kind: item.kind,
          label: item.label,
          valueJson: item.valueJson,
          createdAt,
        })),
      )
    }
    // Re-observation bumps the head + updatedAt but NEVER clears the tombstone.
    await updateCaptures(tx)
      .set({ revision, updatedAt: createdAt })
      .where(eq(captures.id, existing.id))
    return toRecord({ ...existing, revision, updatedAt: createdAt })
  }

  async function createCapture(
    tx: CaptureExec,
    input: AcceptCaptureInput,
    provenance: ReturnType<typeof validateProvenance>,
    evidence: ReturnType<typeof validateEvidence>,
    actor: AdmittedCommandActor,
    connectorProvenance: CaptureConnectorProvenance | null,
    contentHash: string | null,
    createdAt: string,
  ): Promise<CaptureRecord> {
    const id = newId()
    const payloadJson =
      input.payload === undefined || input.payload === null
        ? null
        : boundedJson(input.payload, 'payload', PAYLOAD_MAX)
    const row: CaptureRow = {
      id,
      workspaceId: input.workspaceId,
      evidenceMode: input.evidenceMode,
      adapterId: provenance.adapterId,
      adapterKind: provenance.adapterKind,
      adapterVersion: provenance.adapterVersion,
      observedAt: provenance.observedAt,
      receivedAt: createdAt,
      providerRecordId: provenance.providerRecordId,
      providerSchema: provenance.providerSchema,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      removedAt: null,
    }
    await insertCaptures(tx).values({ ...row, payloadJson })
    await insertCaptureRevisions(tx).values({
      captureId: id,
      revision: 1,
      kind: 'created',
      snapshotJson: observedSnapshot(provenance, input.evidenceMode, 1),
      auditJson: auditJson(actor),
      connectorInstanceId: connectorProvenance?.connectorInstanceId ?? null,
      connectorRunId: connectorProvenance?.connectorRunId ?? null,
      executionScopeId: connectorProvenance?.executionScopeId ?? null,
      reportedOriginJson: connectorProvenance?.reportedOrigin === undefined
        ? null
        : JSON.stringify(connectorProvenance.reportedOrigin),
      contentHash,
      payloadJson,
      createdAt,
    })
    if (evidence.length > 0) {
      await insertCaptureEvidenceItems(tx).values(
        evidence.map((item, index) => ({
          id: newId(),
          captureId: id,
          captureRevision: 1,
          evidenceIndex: index,
          kind: item.kind,
          label: item.label,
          valueJson: item.valueJson,
          createdAt,
        })),
      )
    }
    return toRecord(row)
  }

  type LoadedMutation =
    | { readonly ok: true; readonly row: CaptureRow; readonly workspaceId: string; readonly captureId: string; readonly actor: AdmittedCommandActor }
    | { readonly ok: false; readonly failure: CaptureFailure }

  function loadForMutation(input: CaptureMutationInput, row: CaptureRow | null, ids: { workspaceId: string; captureId: string; actor: AdmittedCommandActor }): LoadedMutation {
    if (!row) return { ok: false, failure: fail('not_found', 'capture not found in this workspace') }
    if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
      return { ok: false, failure: fail('revision_conflict', 'capture was modified concurrently') }
    }
    return { ok: true, row, workspaceId: ids.workspaceId, captureId: ids.captureId, actor: ids.actor }
  }

  function validateMutationIds(input: CaptureMutationInput): { workspaceId: string; captureId: string; actor: AdmittedCommandActor } {
    return {
      workspaceId: requireId(input.workspaceId, 'workspaceId'),
      captureId: requireId(input.captureId, 'captureId'),
      actor: requireActor(input.actor),
    }
  }

  // Composable core: single-attempt commit on the caller's executor. May THROW a
  // unique-violation (revision race) for the caller to handle; the standalone
  // wrapper converts it to a typed revision_conflict.
  async function commitRevisionOn(
    exec: CaptureExec,
    loaded: Extract<LoadedMutation, { ok: true }>,
    kind: CaptureRevisionKind,
    snapshotJson: BoundedJson<typeof SNAPSHOT_MAX>,
    removedAt: 'set' | 'clear' | 'keep',
  ): Promise<MutateCaptureResult> {
    const createdAt = nowIso()
    const revision = loaded.row.revision + 1
    await insertCaptureRevisions(exec).values({
      captureId: loaded.captureId,
      revision,
      kind,
      snapshotJson,
      auditJson: auditJson(loaded.actor),
      createdAt,
    })
    const set: { revision: number; updatedAt: string; removedAt?: string | null } = { revision, updatedAt: createdAt }
    let nextRemovedAt = loaded.row.removedAt
    if (removedAt === 'set') {
      set.removedAt = createdAt
      nextRemovedAt = createdAt
    } else if (removedAt === 'clear') {
      set.removedAt = null
      nextRemovedAt = null
    }
    await updateCaptures(exec).set(set).where(eq(captures.id, loaded.captureId))
    return { ok: true as const, capture: toRecord({ ...loaded.row, revision, updatedAt: createdAt, removedAt: nextRemovedAt }) }
  }

  // Composable core: single-attempt accept on the caller's executor (idempotent by
  // provenance). May THROW a unique-violation for the caller to retry; validation +
  // idempotency semantics are shared with the standalone wrapper (one implementation).
  async function acceptOn(exec: CaptureExec, input: AcceptCaptureInput): Promise<AcceptCaptureResult> {
    let provenance: ReturnType<typeof validateProvenance>
    let evidence: ReturnType<typeof validateEvidence>
    let actor: AdmittedCommandActor
    let connectorProvenance: CaptureConnectorProvenance | null
    let workspaceId: string
    let evidenceMode: CaptureEvidenceMode
    let payloadJson: string | null
    try {
      workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
      if (!(captureEvidenceModes as readonly string[]).includes(input.evidenceMode)) {
        throw new CaptureInputError('invalid_input', 'evidenceMode is invalid')
      }
      evidenceMode = input.evidenceMode
      provenance = validateProvenance(input.provenance)
      evidence = validateEvidence(input.evidence)
      actor = requireActor(input.actor)
      connectorProvenance = validateConnectorProvenance(input.connectorProvenance)
      if (connectorProvenance && provenance.adapterKind !== 'connector') {
        throw new CaptureInputError('invalid_input', 'connectorProvenance requires a connector adapter')
      }
      payloadJson = input.payload === undefined || input.payload === null
        ? null
        : boundedJson(input.payload, 'payload', PAYLOAD_MAX)
    } catch (error) {
      if (error instanceof CaptureInputError) return fail(error.code, error.message)
      throw error
    }

    const normalized: AcceptCaptureInput = { ...input, workspaceId, evidenceMode }
    const providerRecordId = provenance.providerRecordId
    const existing = providerRecordId
      ? await selectByProvenance(exec, workspaceId, provenance.adapterId, provenance.providerSchema, providerRecordId)
      : null
    if (existing && existing.evidenceMode !== evidenceMode) {
      return fail('evidence_mode_conflict', 'evidence mode is immutable for this capture')
    }
    const createdAt = nowIso()
    const contentHash = connectorProvenance
      ? connectorContentHash(normalized, provenance, evidence, connectorProvenance)
      : null
    if (existing) {
      if (connectorProvenance && contentHash) {
        const reused = await selectRevisionByContent(exec, existing.id, contentHash)
        if (reused) {
          const occurrenceId = await recordConnectorOccurrence(exec, {
            captureId: existing.id,
            captureRevision: reused.revision,
            connectorProvenance,
            observedAt: provenance.observedAt,
            receivedAt: createdAt,
          })
          return {
            ok: true,
            capture: toRecord(existing),
            created: false,
            connectorRevision: {
              revision: reused.revision,
              contentHash,
              reused: true,
              createdAt: reused.createdAt,
              occurrenceId,
              occurrenceReceivedAt: createdAt,
            },
          }
        }
      }
      const capture = await appendObservation(
        exec,
        existing,
        provenance,
        evidenceMode,
        evidence,
        actor,
        connectorProvenance,
        contentHash,
        payloadJson,
        createdAt,
      )
      if (!connectorProvenance || !contentHash) return { ok: true, capture, created: false }
      const occurrenceId = await recordConnectorOccurrence(exec, {
        captureId: capture.id,
        captureRevision: capture.revision,
        connectorProvenance,
        observedAt: provenance.observedAt,
        receivedAt: createdAt,
      })
      return {
        ok: true,
        capture,
        created: false,
        connectorRevision: {
          revision: capture.revision,
          contentHash,
          reused: false,
          createdAt,
          occurrenceId,
          occurrenceReceivedAt: createdAt,
        },
      }
    }
    const capture = await createCapture(
      exec,
      normalized,
      provenance,
      evidence,
      actor,
      connectorProvenance,
      contentHash,
      createdAt,
    )
    if (!connectorProvenance || !contentHash) return { ok: true, capture, created: true }
    const occurrenceId = await recordConnectorOccurrence(exec, {
      captureId: capture.id,
      captureRevision: capture.revision,
      connectorProvenance,
      observedAt: provenance.observedAt,
      receivedAt: createdAt,
    })
    return {
      ok: true,
      capture,
      created: true,
      connectorRevision: {
        revision: capture.revision,
        contentHash,
        reused: false,
        createdAt,
        occurrenceId,
        occurrenceReceivedAt: createdAt,
      },
    }
  }

  async function correctOn(exec: CaptureExec, input: CorrectCaptureInput): Promise<MutateCaptureResult> {
    let ids: { workspaceId: string; captureId: string; actor: AdmittedCommandActor }
    let correctionJson: BoundedJson<typeof SNAPSHOT_MAX>
    try {
      ids = validateMutationIds(input)
      correctionJson = boundedJson(input.correction, 'correction', SNAPSHOT_MAX)
    } catch (error) {
      if (error instanceof CaptureInputError) return fail(error.code, error.message)
      throw error
    }
    const loaded = loadForMutation(input, await selectById(exec, ids.workspaceId, ids.captureId), ids)
    if (!loaded.ok) return loaded.failure
    // Corrections append a user-attributed revision; observed evidence is untouched.
    return commitRevisionOn(exec, loaded, 'corrected', correctionJson, 'keep')
  }

  // Composable tombstone/restore cores: single attempt on the caller's executor so the
  // removal orchestration composes a Capture tombstone atomically with its dependents.
  async function removeOn(exec: CaptureExec, input: CaptureMutationInput): Promise<MutateCaptureResult> {
    let ids: { workspaceId: string; captureId: string; actor: AdmittedCommandActor }
    try {
      ids = validateMutationIds(input)
    } catch (error) {
      if (error instanceof CaptureInputError) return fail(error.code, error.message)
      throw error
    }
    const loaded = loadForMutation(input, await selectById(exec, ids.workspaceId, ids.captureId), ids)
    if (!loaded.ok) return loaded.failure
    if (loaded.row.removedAt !== null) return { ok: true, capture: toRecord(loaded.row) }
    const snapshot = boundedJson({ kind: 'removed', priorRevision: loaded.row.revision, revision: loaded.row.revision + 1 }, 'snapshot', SNAPSHOT_MAX)
    return commitRevisionOn(exec, loaded, 'removed', snapshot, 'set')
  }

  async function restoreOn(exec: CaptureExec, input: CaptureMutationInput): Promise<MutateCaptureResult> {
    let ids: { workspaceId: string; captureId: string; actor: AdmittedCommandActor }
    try {
      ids = validateMutationIds(input)
    } catch (error) {
      if (error instanceof CaptureInputError) return fail(error.code, error.message)
      throw error
    }
    const loaded = loadForMutation(input, await selectById(exec, ids.workspaceId, ids.captureId), ids)
    if (!loaded.ok) return loaded.failure
    if (loaded.row.removedAt === null) return { ok: true, capture: toRecord(loaded.row) }
    const snapshot = boundedJson({ kind: 'restored', priorRevision: loaded.row.revision, revision: loaded.row.revision + 1 }, 'snapshot', SNAPSHOT_MAX)
    return commitRevisionOn(exec, loaded, 'restored', snapshot, 'clear')
  }

  return {
    acceptOn,
    correctOn,
    removeOn,
    restoreOn,

    async accept(input) {
      // Thin wrapper: open a transaction around the composable core, retrying on a
      // provenance/revision race (the row now exists / advanced, so acceptOn appends).
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await database.transaction((tx) => acceptOn(tx, input))
        } catch (error) {
          if (isUniqueViolation(error)) continue
          throw error
        }
      }
      return fail('revision_conflict', 'capture intake could not converge under contention')
    },

    async correct(input) {
      try {
        return await database.transaction((tx) => correctOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'capture was modified concurrently')
        throw error
      }
    },

    async remove(input) {
      try {
        return await database.transaction((tx) => removeOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'capture was modified concurrently')
        throw error
      }
    },

    async restore(input) {
      try {
        return await database.transaction((tx) => restoreOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'capture was modified concurrently')
        throw error
      }
    },

    async get(workspaceId, captureId) {
      const row = await selectById(database, workspaceId, captureId)
      return row ? toRecord(row) : null
    },

    async getByProvenance(workspaceId, adapterId, providerSchema, providerRecordId) {
      const row = await selectByProvenance(database, workspaceId, adapterId, providerSchema, providerRecordId)
      return row ? toRecord(row) : null
    },

    async history(workspaceId, captureId) {
      const existing = await selectById(database, workspaceId, captureId)
      if (!existing) return []
      const rows = await database
        .select()
        .from(captureRevisions)
        .where(eq(captureRevisions.captureId, captureId))
        .orderBy(asc(captureRevisions.revision))
      return rows.map((row) => {
        const audit = safeParseJson(row.auditJson)
        const actor = (audit as { actor?: { type?: string; id?: string | null } }).actor
        return {
          revision: row.revision,
          kind: row.kind as CaptureRevisionKind,
          actor: {
            type: (actor?.type ?? 'system') as CaptureActorType,
            id: actor?.id ?? null,
          },
          createdAt: row.createdAt,
        }
      })
    },

    async evidence(workspaceId, captureId) {
      const existing = await selectById(database, workspaceId, captureId)
      if (!existing) return null
      const rows = await database
        .select()
        .from(captureEvidenceItems)
        .where(eq(captureEvidenceItems.captureId, captureId))
        .orderBy(asc(captureEvidenceItems.captureRevision), asc(captureEvidenceItems.evidenceIndex))
      return {
        captureId,
        evidenceMode: existing.evidenceMode as CaptureEvidenceMode,
        items: rows.map((row) => ({
          revision: row.captureRevision,
          index: row.evidenceIndex,
          kind: row.kind,
          label: row.label,
          value: safeParseJson(row.valueJson) as JsonValue,
        })),
      }
    },
  }
}
