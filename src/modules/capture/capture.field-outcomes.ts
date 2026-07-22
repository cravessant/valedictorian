/**
 * Capture-owned provider-field resolution outcomes (issue #325).
 *
 * The Capture module owns the durable result of a trusted connector provider-field
 * resolver, keyed to the immutable Capture revision plus the exact resolver id/version,
 * input hash, and field. Scheduling tables stay coordination-only; the domain result
 * lives here. Guarantees:
 *   - persist outcomes idempotently (a crash after persist but before work completion
 *     re-runs and converges via ON CONFLICT DO NOTHING, never duplicating rows);
 *   - load the exact immutable resolver input for a revision (null when no truthful
 *     payload was preserved, so replay skips it rather than inventing input);
 *   - list eligible revisions with available immutable payload for replay;
 *   - read the completed current-version location outcome for Capture -> Job promotion.
 *
 * Outcome rows are bounded and sanitized: status, value, reason, confidence, and evidence
 * are preserved when they fit the bound; optional detail is progressively dropped when it
 * cannot safely fit so a well-formed outcome still records its terminal field/status.
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import type { FieldResolutionOutcome } from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'
import { captureFieldOutcomes, captureRevisions, captures } from './capture.schema'
import { insertCaptureFieldOutcomes } from './capture.repository'

/** A read+write executor — the workspace database OR an open transaction. */
export type CaptureFieldOutcomeExec = Pick<PgliteDatabase, 'select' | 'insert'>

const OUTCOME_MAX = 16_384
const FORBIDDEN_KEY_REGEX = new RegExp(`"[^"]*(?:${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[\\t\\n\\r ]*:`, 'i')

export interface PersistFieldOutcomesInput {
  readonly captureId: string
  readonly captureRevision: number
  readonly resolverId: string
  readonly resolverVersion: string
  readonly inputHash: string
  readonly outcomes: readonly FieldResolutionOutcome[]
  readonly createdAt: string
}

/** The immutable resolver input loaded from a Capture revision (null when unavailable). */
export interface CaptureResolverInput {
  readonly captureId: string
  readonly captureRevision: number
  readonly contentHash: string
  readonly adapter: { readonly id: string; readonly kind: string; readonly version: string }
  readonly providerSchema: string | null
  readonly payload: Record<string, unknown>
}

export interface EligibleRevision {
  readonly captureId: string
  readonly captureRevision: number
  readonly contentHash: string
  readonly providerSchema: string | null
}

/** A resolved location outcome eligible to prefill a null Capture -> Job location. */
export interface ResolvedLocationEvidence {
  readonly country: 'US' | 'CA'
  readonly display: string
  readonly city: string | null
  readonly region: string | null
}

export interface CaptureFieldOutcomeStore {
  persistOutcomes(exec: CaptureFieldOutcomeExec, input: PersistFieldOutcomesInput): Promise<number>
  loadRevisionInput(workspaceId: string, captureId: string, captureRevision: number): Promise<CaptureResolverInput | null>
  listEligibleRevisions(workspaceId: string, adapterId: string): Promise<readonly EligibleRevision[]>
  readResolvedLocation(
    workspaceId: string,
    captureId: string,
    captureRevision: number,
    resolverId: string,
    resolverVersion: string,
  ): Promise<ResolvedLocationEvidence | null>
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Project a connector outcome to a bounded, sanitized JSON cell. Optional detail is removed
 * from least to most semantically important until the field/status can be stored safely.
 * Returning null rejects a malformed outcome whose required identity/status cannot fit.
 */
function sanitizeOutcomeJson(outcome: FieldResolutionOutcome): string | null {
  const projection: Record<string, unknown> = { field: outcome.field, status: outcome.status }
  if ('value' in outcome) projection.value = outcome.value
  if ('reason' in outcome) projection.reason = outcome.reason
  if ('values' in outcome) projection.values = outcome.values
  if ('confidence' in outcome) projection.confidence = outcome.confidence
  if ('evidence' in outcome && outcome.evidence !== undefined) projection.evidence = outcome.evidence
  for (const optionalKey of [null, 'evidence', 'values', 'value', 'confidence', 'reason'] as const) {
    if (optionalKey !== null) delete projection[optionalKey]
    const serialized = safeStringify(projection)
    if (serialized !== null && !FORBIDDEN_KEY_REGEX.test(serialized) && serialized.length <= OUTCOME_MAX) {
      return serialized
    }
  }
  return null
}

export function createCaptureFieldOutcomeStore(database: PgliteDatabase): CaptureFieldOutcomeStore {
  return {
    async persistOutcomes(exec, input) {
      const rows = []
      for (const outcome of input.outcomes) {
        const outcomeJson = sanitizeOutcomeJson(outcome)
        if (outcomeJson === null) continue
        rows.push({
          captureId: input.captureId,
          captureRevision: input.captureRevision,
          resolverId: input.resolverId,
          resolverVersion: input.resolverVersion,
          inputHash: input.inputHash,
          field: outcome.field,
          status: outcome.status,
          outcomeJson,
          createdAt: input.createdAt,
        })
      }
      if (rows.length === 0) return 0
      const inserted = await insertCaptureFieldOutcomes(exec)
        .values(rows)
        .onConflictDoNothing()
        .returning({ field: captureFieldOutcomes.field })
      return inserted.length
    },

    async loadRevisionInput(workspaceId, captureId, captureRevision) {
      const [row] = await database
        .select({
          adapterId: captures.adapterId,
          adapterKind: captures.adapterKind,
          adapterVersion: captures.adapterVersion,
          providerSchema: captures.providerSchema,
          contentHash: captureRevisions.contentHash,
          payloadJson: captureRevisions.payloadJson,
        })
        .from(captureRevisions)
        .innerJoin(captures, and(eq(captures.id, captureRevisions.captureId), eq(captures.workspaceId, workspaceId)))
        .where(and(eq(captureRevisions.captureId, captureId), eq(captureRevisions.revision, captureRevision)))
        .limit(1)
      if (!row || row.payloadJson === null || row.contentHash === null) return null
      const payload = safeParse(row.payloadJson)
      if (!isRecord(payload)) return null
      return {
        captureId,
        captureRevision,
        contentHash: row.contentHash,
        adapter: { id: row.adapterId, kind: row.adapterKind, version: row.adapterVersion },
        providerSchema: row.providerSchema,
        payload,
      }
    },

    async listEligibleRevisions(workspaceId, adapterId) {
      const rows = await database
        .select({
          captureId: captureRevisions.captureId,
          captureRevision: captureRevisions.revision,
          contentHash: captureRevisions.contentHash,
          providerSchema: captures.providerSchema,
        })
        .from(captureRevisions)
        .innerJoin(captures, and(eq(captures.id, captureRevisions.captureId), eq(captures.workspaceId, workspaceId)))
        .where(and(
          eq(captures.adapterId, adapterId),
          eq(captures.adapterKind, 'connector'),
          isNotNull(captureRevisions.payloadJson),
          isNotNull(captureRevisions.contentHash),
        ))
      return rows
        .filter((row): row is {
          captureId: string
          captureRevision: number
          contentHash: string
          providerSchema: string | null
        } => row.contentHash !== null)
        .map((row) => ({
          captureId: row.captureId,
          captureRevision: row.captureRevision,
          contentHash: row.contentHash,
          providerSchema: row.providerSchema,
        }))
    },

    async readResolvedLocation(workspaceId, captureId, captureRevision, resolverId, resolverVersion) {
      const [row] = await database
        .select({ outcomeJson: captureFieldOutcomes.outcomeJson })
        .from(captureFieldOutcomes)
        .innerJoin(captureRevisions, and(
          eq(captureRevisions.captureId, captureFieldOutcomes.captureId),
          eq(captureRevisions.revision, captureFieldOutcomes.captureRevision),
          eq(captureRevisions.contentHash, captureFieldOutcomes.inputHash),
        ))
        .innerJoin(captures, and(eq(captures.id, captureFieldOutcomes.captureId), eq(captures.workspaceId, workspaceId)))
        .where(and(
          eq(captureFieldOutcomes.captureId, captureId),
          eq(captureFieldOutcomes.captureRevision, captureRevision),
          eq(captureFieldOutcomes.resolverId, resolverId),
          eq(captureFieldOutcomes.resolverVersion, resolverVersion),
          eq(captureFieldOutcomes.field, 'location'),
          eq(captureFieldOutcomes.status, 'resolved'),
        ))
        .limit(1)
      if (!row) return null
      const outcome = safeParse(row.outcomeJson)
      if (!isRecord(outcome) || outcome.status !== 'resolved') return null
      const value = outcome.value
      if (!isRecord(value)) return null
      const country = value.country
      if (country !== 'US' && country !== 'CA') return null
      const display = typeof value.raw === 'string' && value.raw.length > 0 ? value.raw : country
      return {
        country,
        display,
        city: typeof value.city === 'string' ? value.city : null,
        region: typeof value.region === 'string' ? value.region : null,
      }
    },
  }
}
