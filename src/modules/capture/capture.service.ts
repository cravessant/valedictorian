/**
 * Capture aggregate — the user-controlled durable module contract (issue #299).
 *
 * One contract through which user, connector, CLI, and import creation differ
 * ONLY by typed provenance (`adapterKind`) and declared capability
 * (`evidenceMode`), never by downstream control. The service writes the canonical
 * `lifecycle_captures` / `capture_revisions` / `capture_evidence_items` tables
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
import { randomUUID } from 'node:crypto'
import type { PgliteDatabase } from '../../db/pglite'
import {
  captureEvidenceModes,
  captureSourceAdapterKinds,
  lifecycleActorTypes,
} from '../../db/lifecycle-vocabulary'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'
import {
  captureEvidenceItems,
  captureRevisions,
  lifecycleCaptures,
} from './capture.schema'
import {
  insertCaptureEvidenceItems,
  insertCaptureRevisions,
  insertLifecycleCaptures,
  updateLifecycleCaptures,
} from './capture.repository'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type CaptureEvidenceMode = (typeof captureEvidenceModes)[number]
export type CaptureAdapterKind = (typeof captureSourceAdapterKinds)[number]
export type CaptureActorType = (typeof lifecycleActorTypes)[number]
export type CaptureRevisionKind = 'created' | 'corrected' | 'removed' | 'restored'

export interface CaptureActor {
  readonly type: CaptureActorType
  readonly id?: string | null
}

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

export type AcceptCaptureResult =
  | { readonly ok: true; readonly capture: CaptureRecord; readonly created: boolean }
  | CaptureFailure

export type MutateCaptureResult = { readonly ok: true; readonly capture: CaptureRecord } | CaptureFailure

export interface CaptureService {
  accept(input: AcceptCaptureInput): Promise<AcceptCaptureResult>
  correct(input: CorrectCaptureInput): Promise<MutateCaptureResult>
  remove(input: CaptureMutationInput): Promise<MutateCaptureResult>
  restore(input: CaptureMutationInput): Promise<MutateCaptureResult>
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
const WORKSPACE_MAX = 200
const ADAPTER_VERSION_MAX = 100
const PROVIDER_FIELD_MAX = 500
const PAYLOAD_MAX = 262_144
const SNAPSHOT_MAX = 262_144
const AUDIT_MAX = 16_384
const EVIDENCE_VALUE_MAX = 16_384
const EVIDENCE_KIND_MAX = 100
const EVIDENCE_LABEL_MAX = 200
const EVIDENCE_MAX_ITEMS = 50

const FORBIDDEN_KEY_REGEX = new RegExp(`"[^"]*(?:${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[\\t\\n\\r ]*:`, 'i')

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

function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new CaptureInputError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new CaptureInputError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > max) {
    throw new CaptureInputError('bounded_data_violation', `${field} exceeds ${max} characters`)
  }
  return trimmed
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, field, 1, max)
}

function boundedJson(value: JsonValue, field: string, max: number): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value ?? null)
  } catch {
    throw new CaptureInputError('invalid_input', `${field} is not serializable JSON`)
  }
  if (serialized.length > max) throw new CaptureInputError('bounded_data_violation', `${field} exceeds ${max} bytes`)
  if (FORBIDDEN_KEY_REGEX.test(serialized)) {
    throw new CaptureInputError('security_violation', `${field} contains a forbidden sensitive key`)
  }
  return serialized
}

function requireActor(actor: unknown): CaptureActor {
  if (typeof actor !== 'object' || actor === null) {
    throw new CaptureInputError('invalid_input', 'actor is required')
  }
  const type = (actor as { type?: unknown }).type
  if (typeof type !== 'string' || !(lifecycleActorTypes as readonly string[]).includes(type)) {
    throw new CaptureInputError('invalid_input', 'actor.type is invalid')
  }
  const id = optionalText((actor as { id?: unknown }).id, 'actor.id', WORKSPACE_MAX)
  const resolved: CaptureActor = { type: type as CaptureActorType, id }
  // audit_json carries a forbidden-key + bound CHECK. Validate the exact payload
  // auditJson() will persist here, up front, so a crafted actor.id returns a typed
  // security_violation/bounded_data_violation instead of a raw DB error mid-tx.
  boundedJson({ actor: { type: resolved.type, id: resolved.id ?? null } }, 'actor', AUDIT_MAX)
  return resolved
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

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown }
  if (record.code === '23505' || record.cause?.code === '23505') return true
  const message = typeof record.message === 'string' ? record.message : ''
  return /duplicate key value|unique constraint/i.test(message)
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

export function createPgliteCaptureService(
  database: PgliteDatabase,
  options: CaptureServiceOptions = {},
): CaptureService {
  const nowIso = () => (options.now?.() ?? new Date()).toISOString()
  const newId = options.newId ?? (() => randomUUID())

  async function selectById(workspaceId: string, captureId: string): Promise<CaptureRow | null> {
    const [row] = await database
      .select()
      .from(lifecycleCaptures)
      .where(and(eq(lifecycleCaptures.workspaceId, workspaceId), eq(lifecycleCaptures.id, captureId)))
      .limit(1)
    return (row as CaptureRow | undefined) ?? null
  }

  async function selectByProvenance(
    workspaceId: string,
    adapterId: string,
    providerSchema: string | null,
    providerRecordId: string,
  ): Promise<CaptureRow | null> {
    const [row] = await database
      .select()
      .from(lifecycleCaptures)
      .where(
        and(
          eq(lifecycleCaptures.workspaceId, workspaceId),
          eq(lifecycleCaptures.adapterId, adapterId),
          // Provenance identity includes provider_schema (matching the legacy
          // connector lineage key + the 0002 partial unique index), so the same
          // adapter re-observing a provider record under a bumped schema stays a
          // distinct capture.
          sql`coalesce(${lifecycleCaptures.providerSchema}, '') = ${providerSchema ?? ''}`,
          eq(lifecycleCaptures.providerRecordId, providerRecordId),
        ),
      )
      .limit(1)
    return (row as CaptureRow | undefined) ?? null
  }

  function auditJson(actor: CaptureActor): string {
    return JSON.stringify({ actor: { type: actor.type, id: actor.id ?? null } })
  }

  function observedSnapshot(
    provenance: ReturnType<typeof validateProvenance>,
    evidenceMode: CaptureEvidenceMode,
    revision: number,
  ): string {
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
    tx: Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0],
    existing: CaptureRow,
    provenance: ReturnType<typeof validateProvenance>,
    evidenceMode: CaptureEvidenceMode,
    evidence: ReturnType<typeof validateEvidence>,
    actor: CaptureActor,
    createdAt: string,
  ): Promise<CaptureRecord> {
    const revision = existing.revision + 1
    await insertCaptureRevisions(tx).values({
      captureId: existing.id,
      revision,
      kind: 'corrected',
      snapshotJson: observedSnapshot(provenance, evidenceMode, revision),
      auditJson: auditJson(actor),
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
    await updateLifecycleCaptures(tx)
      .set({ revision, updatedAt: createdAt })
      .where(eq(lifecycleCaptures.id, existing.id))
    return toRecord({ ...existing, revision, updatedAt: createdAt })
  }

  async function createCapture(
    tx: Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0],
    input: AcceptCaptureInput,
    provenance: ReturnType<typeof validateProvenance>,
    evidence: ReturnType<typeof validateEvidence>,
    actor: CaptureActor,
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
    await insertLifecycleCaptures(tx).values({ ...row, payloadJson })
    await insertCaptureRevisions(tx).values({
      captureId: id,
      revision: 1,
      kind: 'created',
      snapshotJson: observedSnapshot(provenance, input.evidenceMode, 1),
      auditJson: auditJson(actor),
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
    | { readonly ok: true; readonly row: CaptureRow; readonly workspaceId: string; readonly captureId: string; readonly actor: CaptureActor }
    | { readonly ok: false; readonly failure: CaptureFailure }

  function loadForMutation(input: CaptureMutationInput, row: CaptureRow | null, ids: { workspaceId: string; captureId: string; actor: CaptureActor }): LoadedMutation {
    if (!row) return { ok: false, failure: fail('not_found', 'capture not found in this workspace') }
    if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
      return { ok: false, failure: fail('revision_conflict', 'capture was modified concurrently') }
    }
    return { ok: true, row, workspaceId: ids.workspaceId, captureId: ids.captureId, actor: ids.actor }
  }

  function validateMutationIds(input: CaptureMutationInput): { workspaceId: string; captureId: string; actor: CaptureActor } {
    return {
      workspaceId: requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX),
      captureId: requireText(input.captureId, 'captureId', 1, WORKSPACE_MAX),
      actor: requireActor(input.actor),
    }
  }

  async function commitRevision(
    loaded: Extract<LoadedMutation, { ok: true }>,
    kind: CaptureRevisionKind,
    snapshotJson: string,
    removedAt: 'set' | 'clear' | 'keep',
  ): Promise<MutateCaptureResult> {
    const createdAt = nowIso()
    const revision = loaded.row.revision + 1
    try {
      return await database.transaction(async (tx) => {
        await insertCaptureRevisions(tx).values({
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
        await updateLifecycleCaptures(tx).set(set).where(eq(lifecycleCaptures.id, loaded.captureId))
        return { ok: true as const, capture: toRecord({ ...loaded.row, revision, updatedAt: createdAt, removedAt: nextRemovedAt }) }
      })
    } catch (error) {
      // A concurrent mutation already claimed revision N+1 (capture_revisions PK).
      if (isUniqueViolation(error)) return fail('revision_conflict', 'capture was modified concurrently')
      throw error
    }
  }

  return {
    async accept(input) {
      let provenance: ReturnType<typeof validateProvenance>
      let evidence: ReturnType<typeof validateEvidence>
      let actor: CaptureActor
      let workspaceId: string
      let evidenceMode: CaptureEvidenceMode
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        if (!(captureEvidenceModes as readonly string[]).includes(input.evidenceMode)) {
          throw new CaptureInputError('invalid_input', 'evidenceMode is invalid')
        }
        evidenceMode = input.evidenceMode
        provenance = validateProvenance(input.provenance)
        evidence = validateEvidence(input.evidence)
        actor = requireActor(input.actor)
        if (input.payload !== undefined && input.payload !== null) {
          boundedJson(input.payload, 'payload', PAYLOAD_MAX)
        }
      } catch (error) {
        if (error instanceof CaptureInputError) return fail(error.code, error.message)
        throw error
      }

      const normalized: AcceptCaptureInput = { ...input, workspaceId, evidenceMode }
      const providerRecordId = provenance.providerRecordId

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = providerRecordId
          ? await selectByProvenance(workspaceId, provenance.adapterId, provenance.providerSchema, providerRecordId)
          : null
        if (existing && existing.evidenceMode !== evidenceMode) {
          return fail('evidence_mode_conflict', 'evidence mode is immutable for this capture')
        }
        const createdAt = nowIso()
        try {
          return await database.transaction(async (tx) => {
            if (existing) {
              const capture = await appendObservation(
                tx,
                existing,
                provenance,
                evidenceMode,
                evidence,
                actor,
                createdAt,
              )
              return { ok: true as const, capture, created: false }
            }
            const capture = await createCapture(tx, normalized, provenance, evidence, actor, createdAt)
            return { ok: true as const, capture, created: true }
          })
        } catch (error) {
          // Two racing intakes for the same provenance identity, or two racing
          // re-observations: roll back and retry — the row now exists / advanced.
          if (isUniqueViolation(error) && providerRecordId) continue
          throw error
        }
      }
      return fail('revision_conflict', 'capture intake could not converge under contention')
    },

    async correct(input) {
      let ids: { workspaceId: string; captureId: string; actor: CaptureActor }
      let correctionJson: string
      try {
        ids = validateMutationIds(input)
        correctionJson = boundedJson(input.correction, 'correction', SNAPSHOT_MAX)
      } catch (error) {
        if (error instanceof CaptureInputError) return fail(error.code, error.message)
        throw error
      }
      const loaded = loadForMutation(input, await selectById(ids.workspaceId, ids.captureId), ids)
      if (!loaded.ok) return loaded.failure
      // Corrections append a user-attributed revision; observed evidence is untouched.
      return commitRevision(loaded, 'corrected', correctionJson, 'keep')
    },

    async remove(input) {
      let ids: { workspaceId: string; captureId: string; actor: CaptureActor }
      try {
        ids = validateMutationIds(input)
      } catch (error) {
        if (error instanceof CaptureInputError) return fail(error.code, error.message)
        throw error
      }
      const loaded = loadForMutation(input, await selectById(ids.workspaceId, ids.captureId), ids)
      if (!loaded.ok) return loaded.failure
      if (loaded.row.removedAt !== null) return { ok: true, capture: toRecord(loaded.row) }
      const snapshot = JSON.stringify({ kind: 'removed', priorRevision: loaded.row.revision, revision: loaded.row.revision + 1 })
      return commitRevision(loaded, 'removed', snapshot, 'set')
    },

    async restore(input) {
      let ids: { workspaceId: string; captureId: string; actor: CaptureActor }
      try {
        ids = validateMutationIds(input)
      } catch (error) {
        if (error instanceof CaptureInputError) return fail(error.code, error.message)
        throw error
      }
      const loaded = loadForMutation(input, await selectById(ids.workspaceId, ids.captureId), ids)
      if (!loaded.ok) return loaded.failure
      if (loaded.row.removedAt === null) return { ok: true, capture: toRecord(loaded.row) }
      const snapshot = JSON.stringify({ kind: 'restored', priorRevision: loaded.row.revision, revision: loaded.row.revision + 1 })
      return commitRevision(loaded, 'restored', snapshot, 'clear')
    },

    async get(workspaceId, captureId) {
      const row = await selectById(workspaceId, captureId)
      return row ? toRecord(row) : null
    },

    async getByProvenance(workspaceId, adapterId, providerSchema, providerRecordId) {
      const row = await selectByProvenance(workspaceId, adapterId, providerSchema, providerRecordId)
      return row ? toRecord(row) : null
    },

    async history(workspaceId, captureId) {
      const existing = await selectById(workspaceId, captureId)
      if (!existing) return []
      const rows = await database
        .select()
        .from(captureRevisions)
        .where(eq(captureRevisions.captureId, captureId))
        .orderBy(asc(captureRevisions.revision))
      return rows.map((row) => {
        const audit = safeParse(row.auditJson)
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
      const existing = await selectById(workspaceId, captureId)
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
          value: safeParse(row.valueJson) as JsonValue,
        })),
      }
    },
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
