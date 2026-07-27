import { createHash } from 'node:crypto'
import { and, asc, count, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import {
  createCaptureInputSchema,
  type CreateCaptureInput,
  type ProcessingIssue,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import {
  createUuidV7Generator,
  type Clock,
  type UuidV7Generator,
} from '../../db/uuidv7'
import { jobCaptureEvidenceReferences, jobs } from '../job/job.schema'
import {
  captureEffectiveRevisionInputs,
  captureEvidenceItems,
  captureMaterializationIssues,
  captureMaterializationState,
  captureResolutionGenerations,
  captureResolutionStageResults,
  captureRevisions,
  captures,
} from './capture.schema'

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

const RETRY_POLICY_ID = 'capture-destination-v1'
const RETRY_POLICY = JSON.stringify({
  retryDelaysMs: [2_000, 4_000, 8_000, 16_000, 32_000, 60_000],
  maximumAttempts: 7,
})
const SYSTEM_ACTOR = JSON.stringify({ id: 'capture-materializer', type: 'system' })
const NO_RESOLVER = JSON.stringify({ resolverId: null, resolverVersion: null })

interface CaptureHead {
  readonly id: string
  readonly workspaceId: string
  readonly evidenceMode: string
  readonly adapterId: string
  readonly adapterKind: string
  readonly adapterVersion: string
  readonly observedAt: string
  readonly providerRecordId: string | null
  readonly providerSchema: string | null
  readonly revision: number
  readonly removedAt: string | null
}

interface RevisionRow {
  readonly revision: number
  readonly kind: string
  readonly snapshotJson: string
  readonly payloadJson: string | null
}

interface EvidenceRow {
  readonly captureRevision: number
  readonly evidenceIndex: number
  readonly kind: string
  readonly label: string
  readonly valueJson: string
}

interface EvidenceOrigin {
  readonly captureRevision: number
  readonly evidenceIndex: number
}

interface EffectiveRevision {
  readonly input: CreateCaptureInput
  readonly evidenceOrigins: readonly EvidenceOrigin[]
}

interface ReconstructedRevision {
  readonly input: unknown
  readonly evidenceOrigins: readonly EvidenceOrigin[]
  readonly persistExplicitEvidence: boolean
}

export interface CaptureMaterializationOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
  readonly pageSize?: number
}

export interface CaptureMaterializationService {
  ensureCapture(workspaceId: string, captureId: string): Promise<void>
  materializeNextRevision(workspaceId: string, captureId: string): Promise<boolean>
  prepare(workspaceId: string): Promise<void>
  materializeNextPage(workspaceId: string): Promise<number>
  migrateToReady(workspaceId: string): Promise<void>
}

export function createCaptureMaterializationService(
  database: PgliteDatabase,
  options: CaptureMaterializationOptions = {},
): CaptureMaterializationService {
  const clock = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(clock)
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50))
  const nowIso = () => clock().toISOString()

  async function ensureCapture(workspaceId: string, captureId: string) {
    for (let processed = 0; processed < pageSize; processed += 1) {
      if (!await materializeNextRevision(workspaceId, captureId)) break
    }
    await finalizeCaptureIfComplete(workspaceId, captureId)
  }

  async function finalizeCaptureIfComplete(workspaceId: string, captureId: string) {
    return database.transaction(async (tx) => {
      await tx.execute(sql`select id from captures where id = ${captureId} for update`)
      const [head] = await selectCaptureHead(tx)
        .from(captures)
        .where(and(eq(captures.workspaceId, workspaceId), eq(captures.id, captureId)))
        .limit(1)
      if (!head) return false
      const [pendingRevision] = await tx
        .select({ revision: captureRevisions.revision })
        .from(captureRevisions)
        .leftJoin(captureEffectiveRevisionInputs, and(
          eq(captureEffectiveRevisionInputs.captureId, captureRevisions.captureId),
          eq(captureEffectiveRevisionInputs.captureRevision, captureRevisions.revision),
        ))
        .leftJoin(captureMaterializationIssues, and(
          eq(captureMaterializationIssues.captureId, captureRevisions.captureId),
          eq(captureMaterializationIssues.captureRevision, captureRevisions.revision),
        ))
        .where(and(
          eq(captureRevisions.captureId, captureId),
          isNull(captureEffectiveRevisionInputs.captureId),
          isNull(captureMaterializationIssues.captureId),
        ))
        .limit(1)
      if (pendingRevision) return false
      const effective = await currentEffectiveInput(tx, head)
      if (effective) {
        await tx.update(captureMaterializationIssues)
          .set({ resolvedAt: nowIso() })
          .where(and(
            eq(captureMaterializationIssues.captureId, head.id),
            isNull(captureMaterializationIssues.resolvedAt),
          ))
        await ensureCurrentGeneration(tx, head, effective.inputFingerprint)
        await tx.update(captureEffectiveRevisionInputs).set({
          finalizedAt: nowIso(),
        }).where(and(
          eq(captureEffectiveRevisionInputs.captureId, head.id),
          eq(captureEffectiveRevisionInputs.captureRevision, head.revision),
        ))
      } else {
        await stopPriorActiveGeneration(tx, head, nowIso())
      }
      return true
    })
  }

  async function materializeNextRevision(workspaceId: string, captureId: string) {
    return database.transaction(async (tx) => {
      await tx.execute(sql`select id from captures where id = ${captureId} for update`)
      const [head] = await selectCaptureHead(tx)
        .from(captures)
        .where(and(eq(captures.workspaceId, workspaceId), eq(captures.id, captureId)))
        .limit(1)
      if (!head) return false
      const [revision] = await tx
        .select({
          revision: captureRevisions.revision,
          kind: captureRevisions.kind,
          snapshotJson: captureRevisions.snapshotJson,
          payloadJson: captureRevisions.payloadJson,
        })
        .from(captureRevisions)
        .leftJoin(captureEffectiveRevisionInputs, and(
          eq(captureEffectiveRevisionInputs.captureId, captureRevisions.captureId),
          eq(captureEffectiveRevisionInputs.captureRevision, captureRevisions.revision),
        ))
        .leftJoin(captureMaterializationIssues, and(
          eq(captureMaterializationIssues.captureId, captureRevisions.captureId),
          eq(captureMaterializationIssues.captureRevision, captureRevisions.revision),
        ))
        .where(and(
          eq(captureRevisions.captureId, captureId),
          isNull(captureEffectiveRevisionInputs.captureId),
          isNull(captureMaterializationIssues.captureId),
        ))
        .orderBy(asc(captureRevisions.revision))
        .limit(1) as RevisionRow[]
      if (!revision) return false
      const exactEvidence = await tx
        .select({
          captureRevision: captureEvidenceItems.captureRevision,
          evidenceIndex: captureEvidenceItems.evidenceIndex,
          kind: captureEvidenceItems.kind,
          label: captureEvidenceItems.label,
          valueJson: captureEvidenceItems.valueJson,
        })
        .from(captureEvidenceItems)
        .where(and(
          eq(captureEvidenceItems.captureId, captureId),
          eq(captureEvidenceItems.captureRevision, revision.revision),
        ))
        .orderBy(asc(captureEvidenceItems.evidenceIndex)) as EvidenceRow[]
      const [previousRow] = revision.revision === 1 ? [] : await tx
        .select({
          effectiveInputJson: captureEffectiveRevisionInputs.effectiveInputJson,
          evidenceOriginsJson: captureEffectiveRevisionInputs.evidenceOriginsJson,
        })
        .from(captureEffectiveRevisionInputs)
        .where(and(
          eq(captureEffectiveRevisionInputs.captureId, captureId),
          eq(captureEffectiveRevisionInputs.captureRevision, revision.revision - 1),
        ))
        .limit(1)
      const previous = previousRow
        ? parseEffectiveRevision(previousRow)
        : null
      const candidate = reconstructEffectiveInput({
        exactEvidence,
        head,
        previous,
        revision,
        snapshot: parseRecord(revision.snapshotJson),
      })
      if (!candidate) {
        await recordIssue(tx, head, revision.revision, nowIso())
        if (revision.revision === head.revision) {
          await stopPriorActiveGeneration(tx, head, nowIso())
        }
        return true
      }
      const parsed = createCaptureInputSchema.safeParse(candidate.input)
      if (
        !parsed.success
        || candidate.evidenceOrigins.length !== parsed.data.evidence.length
      ) {
        await recordIssue(tx, head, revision.revision, nowIso())
        if (revision.revision === head.revision) {
          await stopPriorActiveGeneration(tx, head, nowIso())
        }
        return true
      }
      if (candidate.persistExplicitEvidence) {
        await tx.insert(captureEvidenceItems).values(
          parsed.data.evidence.map((item, index) => ({
            id: newId(),
            captureId: head.id,
            captureRevision: revision.revision,
            evidenceIndex: index,
            kind: item.kind,
            label: item.label,
            valueJson: stableJson(item.value),
            createdAt: nowIso(),
          })),
        ).onConflictDoNothing()
      }
      const effectiveInputJson = stableJson(parsed.data)
      await tx.insert(captureEffectiveRevisionInputs).values({
        workspaceId: head.workspaceId,
        captureId: head.id,
        captureRevision: revision.revision,
        effectiveInputJson,
        evidenceOriginsJson: stableJson(candidate.evidenceOrigins),
        inputFingerprint: fingerprint(effectiveInputJson),
        materializedAt: nowIso(),
        finalizedAt: null,
      }).onConflictDoNothing()
      return true
    })
  }

  function selectCaptureHead(tx: Tx) {
    return tx
      .select({
        id: captures.id,
        workspaceId: captures.workspaceId,
        evidenceMode: captures.evidenceMode,
        adapterId: captures.adapterId,
        adapterKind: captures.adapterKind,
        adapterVersion: captures.adapterVersion,
        observedAt: captures.observedAt,
        providerRecordId: captures.providerRecordId,
        providerSchema: captures.providerSchema,
        revision: captures.revision,
        removedAt: captures.removedAt,
      })
  }

  async function ensureCurrentGeneration(
    tx: Tx,
    head: CaptureHead,
    inputFingerprint: string,
  ) {
    const [existing] = await tx
      .select({ id: captureResolutionGenerations.id })
      .from(captureResolutionGenerations)
      .where(and(
        eq(captureResolutionGenerations.captureId, head.id),
        eq(captureResolutionGenerations.captureRevision, head.revision),
      ))
      .limit(1)
    if (existing) return
    const timestamp = nowIso()
    await stopPriorActiveGeneration(tx, head, timestamp)
    if (head.removedAt !== null) return

    const [ordinalRow] = await tx
      .select({ ordinal: captureResolutionGenerations.ordinal })
      .from(captureResolutionGenerations)
      .where(eq(captureResolutionGenerations.captureId, head.id))
      .orderBy(desc(captureResolutionGenerations.ordinal))
      .limit(1)
    const linkedJob = await linkedJobForCapture(tx, head.id)
    const promoted = linkedJob !== null
    const destinationStatus = promoted || destinationNotRequired(head)
      ? 'not_required'
      : 'queued'
    const generationId = newId()
    const processingSummary = promoted
      ? 'promoted'
      : destinationStatus === 'queued' ? 'processing' : 'awaiting_information'
    await tx.insert(captureResolutionGenerations).values({
      id: generationId,
      workspaceId: head.workspaceId,
      captureId: head.id,
      captureRevision: head.revision,
      ordinal: (ordinalRow?.ordinal ?? 0) + 1,
      trigger: triggerForCurrentRevision(await currentRevisionKind(tx, head)),
      status: promoted ? 'promoted' : 'active',
      processingSummary,
      inputFingerprint,
      retryPolicyId: RETRY_POLICY_ID,
      retryPolicySnapshotJson: RETRY_POLICY,
      resolverSelectionSnapshotJson: NO_RESOLVER,
      createdByActorJson: SYSTEM_ACTOR,
      linkedJobId: linkedJob?.id ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await tx.insert(captureResolutionStageResults).values([
      stageRow(generationId, head.revision, 'destination', destinationStatus, timestamp),
      stageRow(
        generationId,
        head.revision,
        'information',
        promoted ? 'resolved' : 'awaiting_manual',
        timestamp,
      ),
      stageRow(
        generationId,
        head.revision,
        'promotion',
        promoted ? 'promoted' : 'not_ready',
        timestamp,
      ),
    ])
  }

  async function prepare(workspaceId: string) {
    await updateProgress(database, workspaceId, nowIso(), 'migrating')
  }

  async function materializeNextPage(workspaceId: string) {
    const rows = await database
      .select({ id: captures.id })
      .from(captures)
      .leftJoin(captureEffectiveRevisionInputs, and(
        eq(captureEffectiveRevisionInputs.captureId, captures.id),
        eq(captureEffectiveRevisionInputs.captureRevision, captures.revision),
      ))
      .leftJoin(captureMaterializationIssues, and(
        eq(captureMaterializationIssues.captureId, captures.id),
        eq(captureMaterializationIssues.captureRevision, captures.revision),
        isNull(captureMaterializationIssues.resolvedAt),
      ))
      .where(and(
        eq(captures.workspaceId, workspaceId),
        or(
          and(
            isNull(captureEffectiveRevisionInputs.captureId),
            isNull(captureMaterializationIssues.captureId),
          ),
          and(
            isNotNull(captureEffectiveRevisionInputs.captureId),
            isNull(captureEffectiveRevisionInputs.finalizedAt),
          ),
        ),
      ))
      .orderBy(asc(captures.id))
      .limit(pageSize)
    for (const row of rows) {
      await materializeNextRevision(workspaceId, row.id)
      await finalizeCaptureIfComplete(workspaceId, row.id)
    }
    await updateProgress(database, workspaceId, nowIso(), 'migrating')
    return rows.length
  }

  async function migrateToReady(workspaceId: string) {
    await prepare(workspaceId)
    while (await materializeNextPage(workspaceId) > 0) {
      // Revision checkpoints let a restart resume without replaying completed work.
    }
    const progress = await progressCounts(database, workspaceId)
    await updateProgress(
      database,
      workspaceId,
      nowIso(),
      progress.issueCount > 0 ? 'blocked' : 'ready',
    )
  }

  return {
    ensureCapture,
    materializeNextRevision,
    prepare,
    materializeNextPage,
    migrateToReady,
  }
}

async function stopPriorActiveGeneration(
  tx: Tx,
  head: CaptureHead,
  timestamp: string,
) {
  const active = await tx
    .select({ id: captureResolutionGenerations.id })
    .from(captureResolutionGenerations)
    .where(and(
      eq(captureResolutionGenerations.captureId, head.id),
      eq(captureResolutionGenerations.status, 'active'),
    ))
  const replacement = head.removedAt === null ? 'superseded' : 'cancelled'
  for (const generation of active) {
    await replaceGeneration(tx, generation.id, replacement, timestamp)
  }
}

function reconstructEffectiveInput(input: {
  readonly exactEvidence: readonly EvidenceRow[]
  readonly head: CaptureHead
  readonly previous: EffectiveRevision | null
  readonly revision: RevisionRow
  readonly snapshot: Record<string, unknown> | null
}): ReconstructedRevision | null {
  const { exactEvidence, head, previous, revision, snapshot } = input
  if (!snapshot) return null
  const exact = parseEvidenceRows(exactEvidence)
  if (!exact) return null
  const direct = createCaptureInputSchema.safeParse(snapshot)
  if (direct.success) {
    if (exactEvidence.length > 0) {
      if (stableJson(direct.data.evidence) !== stableJson(exact.values)) return null
      return {
        input: direct.data,
        evidenceOrigins: exact.origins,
        persistExplicitEvidence: false,
      }
    }
    return {
      input: direct.data,
      evidenceOrigins: direct.data.evidence.map((_, evidenceIndex) => ({
        captureRevision: revision.revision,
        evidenceIndex,
      })),
      persistExplicitEvidence: direct.data.evidence.length > 0,
    }
  }
  const observation = typeof snapshot.adapterId === 'string'
    && typeof snapshot.adapterKind === 'string'
    && typeof snapshot.adapterVersion === 'string'
  if (observation) {
    const payload = parseJsonStrict(revision.payloadJson)
    if (!payload.ok) return null
    return {
      input: {
        evidenceMode: snapshot.evidenceMode ?? head.evidenceMode,
        adapter: {
          id: snapshot.adapterId,
          kind: snapshot.adapterKind,
          version: snapshot.adapterVersion,
        },
        observedAt: snapshot.observedAt ?? head.observedAt,
        providerRecordId: snapshot.providerRecordId ?? null,
        providerSchema: snapshot.providerSchema ?? null,
        payload: payload.value,
        evidence: exact.values,
      },
      evidenceOrigins: exact.origins,
      persistExplicitEvidence: false,
    }
  }
  if (!previous) return null
  if (revision.kind === 'removed' || revision.kind === 'restored') {
    return {
      input: { ...previous.input, evidence: [] },
      evidenceOrigins: [],
      persistExplicitEvidence: false,
    }
  }
  const payload = snapshot.payload !== undefined
    ? snapshot.payload
    : mergePayload(previous.input.payload, snapshot)
  return {
    input: {
      ...previous.input,
      providerRecordId: readOptionalText(
        snapshot.providerRecordId,
        previous.input.providerRecordId,
      ),
      providerSchema: readOptionalText(
        snapshot.providerSchema,
        previous.input.providerSchema,
      ),
      payload,
      evidence: exactEvidence.length > 0 ? exact.values : [],
    },
    evidenceOrigins: exactEvidence.length > 0
      ? exact.origins
      : [],
    persistExplicitEvidence: false,
  }
}

function parseEvidenceRows(rows: readonly EvidenceRow[]) {
  const values: Array<{ kind: string; label: string; value: unknown }> = []
  const origins: EvidenceOrigin[] = []
  for (const row of rows) {
    const parsed = parseJsonStrict(row.valueJson)
    if (!parsed.ok) return null
    values.push({ kind: row.kind, label: row.label, value: parsed.value })
    origins.push({
      captureRevision: row.captureRevision,
      evidenceIndex: row.evidenceIndex,
    })
  }
  return { values, origins }
}

function mergePayload(previous: unknown, correction: Record<string, unknown>) {
  if (isRecord(previous)) return { ...previous, ...correction }
  return correction
}

function readOptionalText(value: unknown, fallback: string | null) {
  return value === null || typeof value === 'string' ? value : fallback
}

async function currentEffectiveInput(tx: Tx, head: CaptureHead) {
  const [row] = await tx
    .select({
      inputFingerprint: captureEffectiveRevisionInputs.inputFingerprint,
    })
    .from(captureEffectiveRevisionInputs)
    .where(and(
      eq(captureEffectiveRevisionInputs.captureId, head.id),
      eq(captureEffectiveRevisionInputs.captureRevision, head.revision),
    ))
    .limit(1)
  return row ?? null
}

async function currentRevisionKind(tx: Tx, head: CaptureHead) {
  const [row] = await tx
    .select({ kind: captureRevisions.kind })
    .from(captureRevisions)
    .where(and(
      eq(captureRevisions.captureId, head.id),
      eq(captureRevisions.revision, head.revision),
    ))
    .limit(1)
  return row?.kind ?? 'created'
}

function triggerForCurrentRevision(kind: string) {
  if (kind === 'corrected') return 'correction' as const
  if (kind === 'restored') return 'restore' as const
  return 'intake' as const
}

function destinationNotRequired(head: CaptureHead) {
  return head.evidenceMode === 'ats_details_provided'
    || head.adapterKind !== 'connector'
    || head.providerRecordId === null
}

async function linkedJobForCapture(tx: Tx, captureId: string) {
  const [row] = await tx
    .select({
      id: jobs.id,
      factsJson: jobs.factsJson,
      removedAt: jobs.removedAt,
    })
    .from(jobCaptureEvidenceReferences)
    .innerJoin(jobs, eq(jobs.id, jobCaptureEvidenceReferences.jobId))
    .where(eq(jobCaptureEvidenceReferences.captureId, captureId))
    .orderBy(asc(jobs.createdAt), asc(jobs.id))
    .limit(1)
  return row ?? null
}

function stageRow(
  generationId: string,
  captureRevision: number,
  stage: 'destination' | 'information' | 'promotion',
  status: string,
  updatedAt: string,
) {
  return {
    generationId,
    stage,
    captureRevision,
    status,
    attemptCount: 0,
    issueJson: null,
    resultJson: '{}',
    nextAttemptAt: null,
    resolverId: null,
    resolverVersion: null,
    remoteOperationId: null,
    updatedAt,
  }
}

async function replaceGeneration(
  tx: Tx,
  generationId: string,
  replacement: 'superseded' | 'cancelled',
  timestamp: string,
) {
  const code = replacement === 'superseded'
    ? 'superseded_by_revision'
    : 'capture_removed'
  await tx.update(captureResolutionGenerations).set({
    status: replacement,
    processingSummary: 'stopped',
    updatedAt: timestamp,
  }).where(eq(captureResolutionGenerations.id, generationId))
  for (const stage of ['destination', 'information', 'promotion'] as const) {
    const issue: ProcessingIssue = {
      stage,
      code,
      action: null,
      causedBy: null,
      message: replacement === 'superseded'
        ? 'A newer Capture revision replaced this generation.'
        : 'The Capture was removed.',
      details: {},
    }
    await tx.update(captureResolutionStageResults).set({
      status: replacement,
      issueJson: JSON.stringify(issue),
      nextAttemptAt: null,
      updatedAt: timestamp,
    }).where(and(
      eq(captureResolutionStageResults.generationId, generationId),
      eq(captureResolutionStageResults.stage, stage),
    ))
  }
}

async function recordIssue(
  tx: Tx,
  head: CaptureHead,
  captureRevision: number,
  timestamp: string,
) {
  await tx.insert(captureMaterializationIssues).values({
    workspaceId: head.workspaceId,
    captureId: head.id,
    captureRevision,
    code: 'revision_materialization_failed',
    message: 'Capture revision history could not be reconstructed.',
    detailsJson: JSON.stringify({ captureRevision }),
    createdAt: timestamp,
    resolvedAt: null,
  }).onConflictDoNothing()
}

async function progressCounts(database: PgliteDatabase, workspaceId: string) {
  const [{ value: total }] = await database
    .select({ value: count() })
    .from(captures)
    .where(eq(captures.workspaceId, workspaceId))
  const [{ value: completed }] = await database
    .select({ value: count() })
    .from(captures)
    .innerJoin(captureEffectiveRevisionInputs, and(
      eq(captureEffectiveRevisionInputs.captureId, captures.id),
      eq(captureEffectiveRevisionInputs.captureRevision, captures.revision),
    ))
    .where(and(
      eq(captures.workspaceId, workspaceId),
      isNotNull(captureEffectiveRevisionInputs.finalizedAt),
    ))
  const [{ value: issueCount }] = await database
    .select({ value: count() })
    .from(captures)
    .innerJoin(captureMaterializationIssues, and(
      eq(captureMaterializationIssues.captureId, captures.id),
      eq(captureMaterializationIssues.captureRevision, captures.revision),
    ))
    .where(and(
      eq(captures.workspaceId, workspaceId),
      isNull(captureMaterializationIssues.resolvedAt),
    ))
  return { completed, issueCount, total }
}

async function updateProgress(
  database: PgliteDatabase,
  workspaceId: string,
  timestamp: string,
  status: 'migrating' | 'ready' | 'blocked',
) {
  const progress = await progressCounts(database, workspaceId)
  await database.insert(captureMaterializationState).values({
    workspaceId,
    status,
    completed: progress.completed,
    total: progress.total,
    issueCount: progress.issueCount,
    updatedAt: timestamp,
  }).onConflictDoUpdate({
    target: captureMaterializationState.workspaceId,
    set: { ...progress, status, updatedAt: timestamp },
  })
}

function parseEffectiveRevision(row: {
  readonly effectiveInputJson: string
  readonly evidenceOriginsJson: string
}): EffectiveRevision | null {
  try {
    const result = createCaptureInputSchema.safeParse(JSON.parse(row.effectiveInputJson))
    const origins = JSON.parse(row.evidenceOriginsJson)
    if (
      !result.success
      || !Array.isArray(origins)
      || origins.length !== result.data.evidence.length
      || origins.some((origin) => (
        !isRecord(origin)
        || typeof origin.captureRevision !== 'number'
        || !Number.isInteger(origin.captureRevision)
        || origin.captureRevision <= 0
        || typeof origin.evidenceIndex !== 'number'
        || !Number.isInteger(origin.evidenceIndex)
        || origin.evidenceIndex < 0
      ))
    ) {
      return null
    }
    return {
      input: result.data,
      evidenceOrigins: origins as unknown as EvidenceOrigin[],
    }
  } catch {
    return null
  }
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseJsonStrict(value: string | null):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false } {
  if (value === null) return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function fingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
