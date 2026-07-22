/**
 * Canonical Application aggregate — the user-controlled module contract (issue #302).
 *
 * Users create, read/list, edit company/source, manage links (add/update/unlink with
 * a single-primary rule), transition status, refresh the Job/Opportunity snapshot,
 * generate attempt/event records, remove/restore with an explicit dependent choice,
 * and inspect history through this service. It writes the canonical
 * `applications`, `pursuit_links`, `application_attempt_records`,
 * `application_event_records`, and append-only `application_history` tables
 * (Application-owned; see application.aggregate.repository.ts).
 *
 * Direct lineage (AC2): every Application references BOTH its originating Opportunity
 * and Job; `jobId` is DERIVED from the Opportunity so the database
 * `enforce_application_lineage` trigger (opportunity.job_id == job_id AND same
 * workspace) always holds. Identity is the normalized `(workspace, opportunity)`
 * partial unique key — one active Application per Opportunity (AC6).
 *
 * Snapshot/refresh (AC3): create copies the Job facts at `jobFactsRevision`; a later
 * Job correction NEVER rewrites an active Application — only an explicit
 * `refreshSnapshot` re-snapshots and advances `jobFactsRevision`.
 *
 * `revision` is a single monotonic version: every head-field or link mutation
 * increments it and appends an `application_history` row at that revision (the
 * conditional `WHERE revision = <pre-read>` update is the optimistic guard, the
 * history `(application_id, revision)` primary key the race backstop). Attempt/event
 * records are sidecars and do not append history. The `createOn` / `addLinkOn` /
 * `recordEventOn` composable cores let the Opportunity→Application promotion compose
 * the whole boundary write in one atomic, idempotent transaction (AC5).
 */
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock, createUuidV7Generator, type UuidV7Generator } from '../../db/uuidv7'
import { lifecycleWarningCodes, pursuitApplicationStatuses } from '../../db/lifecycle-vocabulary'
import { jobs } from '../job/job.schema'
import { opportunities } from '../opportunity/opportunity.schema'
import {
  applicationAttemptRecords,
  applicationEventRecords,
  applicationHistory,
  applications,
  pursuitLinks,
} from '../application/application.schema'
import {
  deleteApplicationAttemptRecords,
  deleteApplicationEventRecords,
  deletePursuitLinks,
  insertApplicationAttemptRecords,
  insertApplicationEventRecords,
  insertApplicationHistoryRecords,
  insertApplications,
  insertPursuitLinks,
  updateApplications,
  updatePursuitLinks,
} from './application.aggregate.repository'
import {
  type ApplicationActor,
  type ApplicationActorType,
  type ApplicationFailure,
  type ApplicationStatus,
  type JsonValue,
  ApplicationInputError,
  DISPLAY_MAX,
  EVENT_TYPE_MAX,
  LINK_KIND_MAX,
  LINK_LABEL_MAX,
  LINK_URL_MAX,
  LINKS_LIMIT,
  SNAPSHOT_MAX,
  SUMMARY_MAX,
  TIMESTAMP_MAX,
  WORKSPACE_MAX,
  auditJson,
  boundedJson,
  fail,
  isUniqueViolation,
  optionalText,
  requireActor,
  requireOneOf,
  requireText,
  safeParse,
} from './application.aggregate.validation'

export type {
  ApplicationActor,
  ApplicationFailure,
  ApplicationFailureCode,
  ApplicationStatus,
  JsonValue,
} from './application.aggregate.validation'

export type ApplicationHistoryKind =
  | 'created'
  | 'status_changed'
  | 'company_edited'
  | 'source_edited'
  | 'link_created'
  | 'link_updated'
  | 'link_removed'
  | 'snapshot_refreshed'
  | 'removed'
  | 'restored'

const attemptStates = ['pending', 'running', 'succeeded', 'failed'] as const
export type ApplicationAttemptState = (typeof attemptStates)[number]

export type ApplicationWarningCode = (typeof lifecycleWarningCodes)[number]

/** #304: the contract warning override, recorded in the application's history audit. */
export interface ApplicationWarningOverrideInput {
  readonly actor: { readonly id: string; readonly type: ApplicationActorType; readonly displayName?: string }
  readonly rationale: string
  readonly warningCodes: readonly ApplicationWarningCode[]
}

/** #304: attach/merge onto an existing Application when (workspace, opportunity) collides. */
export interface ApplicationDuplicateResolutionInput {
  readonly action: 'attach' | 'merge'
  readonly targetResourceId: string
}

export interface CreateApplicationInput {
  readonly workspaceId: string
  readonly opportunityId: string
  readonly companyName?: string
  readonly sourceName?: string
  readonly status?: ApplicationStatus
  readonly scores?: JsonValue
  readonly actor: ApplicationActor
  /** #304: create-dedup key — a keyed re-create converges (created:false). */
  readonly idempotencyKey?: string
  /** #304: optimistic lineage guard — the Job's facts revision the caller evaluated. */
  readonly expectedJobFactsRevision?: number
  /** #304: lineage-identity guard — the Job the caller expects the Opportunity to point at. */
  readonly expectedJobId?: string
  /** #304: warning override recorded in the created-history audit envelope. */
  readonly override?: ApplicationWarningOverrideInput | null
  /** #304: attach/merge onto the one active Application for this (workspace, opportunity). */
  readonly duplicateResolution?: ApplicationDuplicateResolutionInput
  /**
   * #304: creation-time links, frozen into the snapshot blob as `initialLinks`. The
   * caller (the create orchestration) ALSO materializes these as durable `pursuit_links`
   * rows via `addLinkOn` in the same transaction; this field only records the immutable
   * creation-time copy so the read-model can present it truthfully thereafter.
   */
  readonly initialLinks?: readonly { readonly kind: string; readonly label: string; readonly url: string }[]
}

export interface EditCompanyInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly companyName: string
  readonly actor: ApplicationActor
  readonly expectedRevision?: number
}

export interface EditSourceInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly sourceName: string
  readonly actor: ApplicationActor
  readonly expectedRevision?: number
}

export interface TransitionStatusInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly status: ApplicationStatus
  readonly actor: ApplicationActor
  readonly expectedRevision?: number
}

export interface RefreshSnapshotInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly actor: ApplicationActor
  readonly expectedRevision?: number
  /**
   * #304: optimistic lineage guard — the Job facts revision the caller intends to
   * refresh to. A mismatch (the Job's facts advanced past the caller's read) is a
   * typed revision_conflict, so a refresh never silently snapshots an unexpected revision.
   */
  readonly expectedJobFactsRevision?: number
  /**
   * #304 caller-driven refresh reconciliation (same "the contract forces the domain to
   * accept caller inputs" pattern as job→opp evaluation). A refresh re-captures the Job
   * facts into the snapshot blob; these flags tell the domain what to do with the head's
   * caller-editable display fields:
   *  - `preserveCompanyEdit` — when explicitly `false`, the refresh ADOPTS the refreshed
   *    Job company into `companyName`; `true` (or undefined, the legacy default) keeps a
   *    prior `editCompany`.
   *  - `preserveSourceEdit` — same, for `sourceName`.
   *  - `preserveLinkEdits` — accepted and recorded; a guaranteed no-op because a refresh
   *    never sources links from Job facts, so the mutable `pursuit_links` set is always
   *    preserved (documented scoped reading: refresh is non-lossy for links).
   */
  readonly preserveCompanyEdit?: boolean
  readonly preserveSourceEdit?: boolean
  readonly preserveLinkEdits?: boolean
}

export interface ApplicationLinkInput {
  readonly kind: string
  readonly label: string
  readonly url: string
  readonly isPrimary: boolean
}

export interface AddLinkInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly link: ApplicationLinkInput
  readonly actor: ApplicationActor
}

export interface UpdateLinkInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly linkId: string
  readonly patch: Partial<ApplicationLinkInput>
  readonly actor: ApplicationActor
}

export interface RemoveLinkInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly linkId: string
  readonly actor: ApplicationActor
}

export interface RecordEventInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly event: { readonly type: string; readonly summary: string; readonly occurredAt?: string }
  readonly actor: ApplicationActor
}

export interface RecordAttemptInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly attempt: {
    readonly state: ApplicationAttemptState
    readonly startedAt: string
    readonly completedAt?: string | null
    readonly summary?: string | null
  }
  readonly actor: ApplicationActor
}

export interface RemoveApplicationInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly actor: ApplicationActor
  /** Explicit downstream-dependent choice (AC7); required when dependents exist. */
  readonly dependents?: 'cascade' | 'preserve'
}

export interface ApplicationMutationInput {
  readonly workspaceId: string
  readonly applicationId: string
  readonly actor: ApplicationActor
}

export interface ApplicationListQuery {
  readonly includeRemoved?: boolean
  readonly limit?: number
}

export interface ApplicationRecord {
  readonly id: string
  readonly workspaceId: string
  readonly opportunityId: string
  readonly jobId: string
  readonly revision: number
  readonly status: ApplicationStatus
  readonly jobFactsRevision: number
  readonly snapshot: JsonValue
  readonly companyName: string
  readonly sourceName: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

export interface ApplicationLinkRecord {
  readonly id: string
  readonly applicationId: string
  readonly kind: string
  readonly label: string
  readonly url: string
  readonly isPrimary: boolean
  readonly createdAt: string
}

export interface ApplicationEventRecord {
  readonly id: string
  readonly applicationId: string
  readonly type: string
  readonly occurredAt: string
  readonly summary: string
  readonly actor: ApplicationActor
  readonly createdAt: string
}

export interface ApplicationAttemptRecord {
  readonly id: string
  readonly applicationId: string
  readonly state: ApplicationAttemptState
  readonly startedAt: string
  readonly completedAt: string | null
  readonly summary: string | null
  readonly createdAt: string
}

export interface ApplicationHistoryEntry {
  readonly revision: number
  readonly kind: ApplicationHistoryKind
  readonly actor: ApplicationActor
  readonly createdAt: string
}

export type CreateApplicationResult = { readonly ok: true; readonly application: ApplicationRecord; readonly created: boolean } | ApplicationFailure
export type MutateApplicationResult = { readonly ok: true; readonly application: ApplicationRecord } | ApplicationFailure
export type AddLinkResult = { readonly ok: true; readonly link: ApplicationLinkRecord; readonly application: ApplicationRecord } | ApplicationFailure

/** A read+write executor — the workspace database OR an open transaction. */
export type ApplicationExec = Pick<PgliteDatabase, 'select' | 'insert' | 'update'>
/** A read+write+delete executor, for cascade removal of dependent children. */
export type ApplicationDeleteExec = Pick<PgliteDatabase, 'select' | 'insert' | 'update' | 'delete'>

export interface ApplicationAggregateService {
  create(input: CreateApplicationInput): Promise<CreateApplicationResult>
  /** Composable core: mint on the caller's transaction executor (no internal tx). */
  createOn(exec: ApplicationExec, input: CreateApplicationInput): Promise<CreateApplicationResult>
  get(workspaceId: string, applicationId: string): Promise<ApplicationRecord | null>
  list(workspaceId: string, query?: ApplicationListQuery): Promise<readonly ApplicationRecord[]>
  editCompany(input: EditCompanyInput): Promise<MutateApplicationResult>
  editSource(input: EditSourceInput): Promise<MutateApplicationResult>
  transitionStatus(input: TransitionStatusInput): Promise<MutateApplicationResult>
  refreshSnapshot(input: RefreshSnapshotInput): Promise<MutateApplicationResult>
  addLink(input: AddLinkInput): Promise<AddLinkResult>
  /** Composable core for the promotion's initial links (no internal tx). */
  addLinkOn(exec: ApplicationExec, input: AddLinkInput): Promise<AddLinkResult>
  updateLink(input: UpdateLinkInput): Promise<MutateApplicationResult>
  removeLink(input: RemoveLinkInput): Promise<MutateApplicationResult>
  listLinks(workspaceId: string, applicationId: string): Promise<readonly ApplicationLinkRecord[]>
  recordEvent(input: RecordEventInput): Promise<{ readonly ok: true; readonly event: ApplicationEventRecord } | ApplicationFailure>
  /** Composable core for the promotion's initial event (no internal tx). */
  recordEventOn(exec: ApplicationExec, input: RecordEventInput): Promise<{ readonly ok: true; readonly event: ApplicationEventRecord } | ApplicationFailure>
  listEvents(workspaceId: string, applicationId: string): Promise<readonly ApplicationEventRecord[]>
  recordAttempt(input: RecordAttemptInput): Promise<{ readonly ok: true; readonly attempt: ApplicationAttemptRecord } | ApplicationFailure>
  listAttempts(workspaceId: string, applicationId: string): Promise<readonly ApplicationAttemptRecord[]>
  remove(input: RemoveApplicationInput): Promise<MutateApplicationResult>
  /** Composable tombstone core: tombstone an Application (with its dependent choice) on the caller's transaction executor (no internal tx). */
  removeOn(exec: ApplicationDeleteExec, input: RemoveApplicationInput): Promise<MutateApplicationResult>
  restore(input: ApplicationMutationInput): Promise<MutateApplicationResult>
  /** Composable restore core: clear an Application tombstone on the caller's transaction executor (no internal tx). */
  restoreOn(exec: ApplicationExec, input: ApplicationMutationInput): Promise<MutateApplicationResult>
  history(workspaceId: string, applicationId: string): Promise<readonly ApplicationHistoryEntry[]>
}

export interface ApplicationAggregateServiceOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

interface ApplicationRow {
  id: string
  workspaceId: string
  opportunityId: string
  jobId: string
  revision: number
  status: string
  jobFactsRevision: number
  snapshotJson: string
  companyName: string
  sourceName: string
  createdAt: string
  updatedAt: string
  removedAt: string | null
  idempotencyKey?: string | null
}

const IDEMPOTENCY_KEY_MAX = 200
const OVERRIDE_MAX = 16_384
const APPLICATION_ACTOR_TYPES = ['user', 'agent', 'system'] as const

/**
 * Validate the contract warning override to a plain object recorded in the history
 * audit envelope (the Application resource carries no override column), or null when
 * absent. Throws a typed ApplicationInputError on a malformed override.
 */
function validateApplicationOverride(
  override: ApplicationWarningOverrideInput | null | undefined,
): { actor: { id: string; type: ApplicationActorType; displayName?: string }; rationale: string; warningCodes: ApplicationWarningCode[] } | null {
  if (override === undefined || override === null) return null
  const type = requireOneOf(override.actor?.type, APPLICATION_ACTOR_TYPES, 'override.actor.type')
  const id = requireText(override.actor?.id, 'override.actor.id', 1, WORKSPACE_MAX)
  const rationale = requireText(override.rationale, 'override.rationale', 1, SUMMARY_MAX)
  if (!Array.isArray(override.warningCodes)) {
    throw new ApplicationInputError('invalid_input', 'override.warningCodes must be an array')
  }
  const warningCodes = override.warningCodes.map((code) => requireOneOf(code, lifecycleWarningCodes, 'override.warningCodes'))
  const displayName = override.actor.displayName === undefined
    ? undefined
    : requireText(override.actor.displayName, 'override.actor.displayName', 1, WORKSPACE_MAX)
  return { actor: displayName === undefined ? { id, type } : { id, type, displayName }, rationale, warningCodes }
}

function toRecord(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    opportunityId: row.opportunityId,
    jobId: row.jobId,
    revision: row.revision,
    status: row.status as ApplicationStatus,
    jobFactsRevision: row.jobFactsRevision,
    snapshot: safeParse(row.snapshotJson),
    companyName: row.companyName,
    sourceName: row.sourceName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    removedAt: row.removedAt,
  }
}

function deriveCompany(facts: JsonValue): string {
  if (facts !== null && typeof facts === 'object' && !Array.isArray(facts)) {
    const candidate = facts.companyName ?? facts.company
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim().slice(0, DISPLAY_MAX)
  }
  return 'Unknown'
}

/** #304: the Job's source name, used when a refresh adopts the refreshed source; keeps the current head value when facts carry none. */
function deriveSource(facts: JsonValue, current: string): string {
  if (facts !== null && typeof facts === 'object' && !Array.isArray(facts)) {
    const candidate = facts.sourceName
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim().slice(0, DISPLAY_MAX)
  }
  return current
}

type HeadUpdate = Partial<Pick<ApplicationRow, 'status' | 'companyName' | 'sourceName' | 'snapshotJson' | 'jobFactsRevision' | 'removedAt'>>

export function createPgliteApplicationAggregateService(
  database: PgliteDatabase,
  options: ApplicationAggregateServiceOptions = {},
): ApplicationAggregateService {
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const newId = options.newId ?? createUuidV7Generator(clock)

  async function selectById(workspaceId: string, applicationId: string): Promise<ApplicationRow | null> {
    const [row] = await database
      .select()
      .from(applications)
      .where(and(eq(applications.workspaceId, workspaceId), eq(applications.id, applicationId)))
      .limit(1)
    return (row as ApplicationRow | undefined) ?? null
  }

  async function selectByIdempotencyKey(exec: ApplicationExec, workspaceId: string, key: string): Promise<ApplicationRow | null> {
    const [row] = await exec
      .select()
      .from(applications)
      .where(and(eq(applications.workspaceId, workspaceId), eq(applications.idempotencyKey, key)))
      .limit(1)
    return (row as ApplicationRow | undefined) ?? null
  }

  /** The single active (non-tombstoned) Application for an Opportunity — the attach target. */
  async function selectActiveByOpportunity(exec: ApplicationExec, workspaceId: string, opportunityId: string): Promise<ApplicationRow | null> {
    const [row] = await exec
      .select()
      .from(applications)
      .where(and(
        eq(applications.workspaceId, workspaceId),
        eq(applications.opportunityId, opportunityId),
        isNull(applications.removedAt),
      ))
      .limit(1)
    return (row as ApplicationRow | undefined) ?? null
  }

  async function resolveLineage(exec: Pick<PgliteDatabase, 'select'>, workspaceId: string, opportunityId: string) {
    const [opportunity] = await exec
      .select({ id: opportunities.id, jobId: opportunities.jobId, removedAt: opportunities.removedAt })
      .from(opportunities)
      .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.id, opportunityId)))
      .limit(1)
    if (!opportunity) return null
    const [job] = await exec
      .select({ factsRevision: jobs.factsRevision, factsJson: jobs.factsJson })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, opportunity.jobId)))
      .limit(1)
    if (!job) return null
    return {
      jobId: opportunity.jobId,
      opportunityRemoved: opportunity.removedAt !== null,
      jobFactsRevision: job.factsRevision,
      jobFacts: safeParse(job.factsJson),
    }
  }

  // #304: `capturedAt` is persisted additively so the HTTP read-model can present the
  // contract `applicationPursuitSnapshot.capturedAt` as the honest capture time (create
  // or the most recent refreshSnapshot), rather than falling back to the head createdAt
  // which a refresh would render false. No migration: it is a new JSON field on a blob
  // both create and refresh already write.
  //
  // #304 initialLinks upgrade: the creation-time links are ALSO persisted additively
  // into the snapshot blob (the same mechanism as `capturedAt`). The HTTP read-model
  // prefers these stored values for `applicationPursuitSnapshot.initialLinks`, so the
  // frozen creation-time links remain durably attributable even after the mutable
  // `pursuit_links` set is edited. A refresh carries the prior initialLinks forward
  // unchanged (they are the CREATION-time links, not the current set).
  function buildSnapshot(
    jobFacts: JsonValue,
    jobFactsRevision: number,
    capturedAt: string,
    scores?: JsonValue,
    initialLinks?: readonly { readonly kind: string; readonly label: string; readonly url: string }[],
  ): JsonValue {
    return {
      job: { facts: jobFacts, factsRevision: jobFactsRevision },
      capturedAt,
      scores: scores ?? null,
      initialLinks: (initialLinks ?? []).map((link) => ({ kind: link.kind, label: link.label, url: link.url })),
    }
  }

  /** Read the creation-time `initialLinks` frozen in a stored snapshot blob (empty if absent). */
  function priorInitialLinks(snapshotJson: string): { kind: string; label: string; url: string }[] {
    const parsed = safeParse(snapshotJson)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const raw = (parsed as Record<string, unknown>).initialLinks
    if (!Array.isArray(raw)) return []
    const links: { kind: string; label: string; url: string }[] = []
    for (const entry of raw) {
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>
        if (typeof record.kind === 'string' && typeof record.label === 'string' && typeof record.url === 'string') {
          links.push({ kind: record.kind, label: record.label, url: record.url })
        }
      }
    }
    return links
  }

  async function appendHistory(
    exec: ApplicationExec,
    applicationId: string,
    revision: number,
    kind: ApplicationHistoryKind,
    snapshot: JsonValue,
    actor: ApplicationActor,
    createdAt: string,
    override?: ReturnType<typeof validateApplicationOverride>,
  ) {
    // #304: the warning override rides in the audit envelope (the resource has no
    // override column). auditJson bounds the actor; the override extends it bounded.
    const auditValue = override
      ? boundedJson({ actor: { type: actor.type, id: actor.id ?? null }, override }, 'audit', OVERRIDE_MAX)
      : auditJson(actor)
    await insertApplicationHistoryRecords(exec).values({
      applicationId,
      revision,
      kind,
      snapshotJson: boundedJson(snapshot, 'snapshot', SNAPSHOT_MAX),
      auditJson: auditValue,
      createdAt,
    })
  }

  // Composable commit core: conditional head update + history append on the caller's
  // executor (no internal tx) so the removal orchestration composes an Application
  // tombstone into ONE atomic cross-aggregate transaction. May THROW a unique-violation.
  async function commitOn(
    exec: ApplicationExec,
    row: ApplicationRow,
    actor: ApplicationActor,
    kind: ApplicationHistoryKind,
    snapshot: JsonValue,
    headUpdate: HeadUpdate,
    guard: SQL,
  ): Promise<MutateApplicationResult> {
    const createdAt = nowIso()
    const nextRevision = row.revision + 1
    const updated = await updateApplications(exec)
      .set({ ...headUpdate, revision: nextRevision, updatedAt: createdAt })
      .where(and(eq(applications.id, row.id), guard))
      .returning({ id: applications.id })
    if (updated.length === 0) return fail('revision_conflict', 'application was modified concurrently')
    await appendHistory(exec, row.id, nextRevision, kind, snapshot, actor, createdAt)
    return { ok: true as const, application: toRecord({ ...row, ...headUpdate, revision: nextRevision, updatedAt: createdAt }) }
  }

  async function commit(
    row: ApplicationRow,
    actor: ApplicationActor,
    kind: ApplicationHistoryKind,
    snapshot: JsonValue,
    headUpdate: HeadUpdate,
    guard: SQL,
    onUnique: 'revision_conflict' | 'deterministic_duplicate',
  ): Promise<MutateApplicationResult> {
    try {
      return await database.transaction((tx) => commitOn(tx, row, actor, kind, snapshot, headUpdate, guard))
    } catch (error) {
      if (isUniqueViolation(error)) {
        return onUnique === 'deterministic_duplicate'
          ? fail('deterministic_duplicate', 'an active application already exists for this opportunity')
          : fail('revision_conflict', 'application was modified concurrently')
      }
      throw error
    }
  }

  /** Count an Application's own dependents (links + events + attempts) on the caller's executor. */
  async function countOwnDependents(exec: ApplicationExec, applicationId: string): Promise<number> {
    const [{ dependents }] = await exec
      .select({ dependents: sql<number>`
        (select count(*) from ${pursuitLinks} where ${pursuitLinks.applicationId} = ${applicationId})
        + (select count(*) from ${applicationEventRecords} where ${applicationEventRecords.applicationId} = ${applicationId})
        + (select count(*) from ${applicationAttemptRecords} where ${applicationAttemptRecords.applicationId} = ${applicationId})` })
      .from(applications)
      .where(eq(applications.id, applicationId))
    return Number(dependents)
  }

  // Composable tombstone/restore cores for the removal orchestration. removeOn needs a
  // delete-capable executor for the 'cascade' dependent choice.
  async function removeOn(exec: ApplicationDeleteExec, input: RemoveApplicationInput): Promise<MutateApplicationResult> {
    let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
    try {
      resolved = await ids(input)
    } catch (error) {
      if (error instanceof ApplicationInputError) return fail(error.code, error.message)
      throw error
    }
    const [row] = await exec.select().from(applications)
      .where(and(eq(applications.workspaceId, resolved.workspaceId), eq(applications.id, resolved.applicationId))).limit(1)
    const typed = (row as ApplicationRow | undefined) ?? null
    if (!typed) return fail('not_found', 'application not found in this workspace')
    if (typed.removedAt !== null) return { ok: true, application: toRecord(typed) }
    const dependentCount = await countOwnDependents(exec, typed.id)
    if (dependentCount > 0 && input.dependents === undefined) {
      return fail('dependent_choice_required', 'application has dependent links/events/attempts; pass dependents: cascade | preserve')
    }
    if (input.dependents === 'cascade') {
      await deletePursuitLinks(exec).where(eq(pursuitLinks.applicationId, typed.id))
      await deleteApplicationEventRecords(exec).where(eq(applicationEventRecords.applicationId, typed.id))
      await deleteApplicationAttemptRecords(exec).where(eq(applicationAttemptRecords.applicationId, typed.id))
    }
    return commitOn(exec, typed, resolved.actor, 'removed', { dependents: input.dependents ?? 'none' },
      { removedAt: nowIso() }, isNull(applications.removedAt))
  }

  async function restoreOn(exec: ApplicationExec, input: ApplicationMutationInput): Promise<MutateApplicationResult> {
    let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
    try {
      resolved = await ids(input)
    } catch (error) {
      if (error instanceof ApplicationInputError) return fail(error.code, error.message)
      throw error
    }
    const [row] = await exec.select().from(applications)
      .where(and(eq(applications.workspaceId, resolved.workspaceId), eq(applications.id, resolved.applicationId))).limit(1)
    const typed = (row as ApplicationRow | undefined) ?? null
    if (!typed) return fail('not_found', 'application not found in this workspace')
    if (typed.removedAt === null) return { ok: true, application: toRecord(typed) }
    return commitOn(exec, typed, resolved.actor, 'restored', { kind: 'restored', priorRevision: typed.revision },
      { removedAt: null }, sql`${applications.removedAt} is not null`)
  }

  async function ids(input: { workspaceId: unknown; applicationId: unknown; actor: unknown }) {
    return {
      workspaceId: requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX),
      applicationId: requireText(input.applicationId, 'applicationId', 1, WORKSPACE_MAX),
      actor: requireActor(input.actor),
    }
  }

  async function linkRows(applicationId: string) {
    const rows = await database
      .select()
      .from(pursuitLinks)
      .where(eq(pursuitLinks.applicationId, applicationId))
      .orderBy(asc(pursuitLinks.createdAt), asc(pursuitLinks.id))
    return rows
  }

  const service: ApplicationAggregateService = {
    async createOn(exec, input) {
      let workspaceId: string
      let opportunityId: string
      let actor: ApplicationActor
      let status: ApplicationStatus
      let companyOverride: string | null
      let sourceOverride: string | null
      let scores: JsonValue | undefined
      let idempotencyKey: string | null
      let override: ReturnType<typeof validateApplicationOverride>
      try {
        workspaceId = requireText(input.workspaceId, 'workspaceId', 1, WORKSPACE_MAX)
        opportunityId = requireText(input.opportunityId, 'opportunityId', 1, WORKSPACE_MAX)
        actor = requireActor(input.actor)
        status = input.status === undefined ? 'active' : requireOneOf(input.status, pursuitApplicationStatuses, 'status')
        companyOverride = optionalText(input.companyName, 'companyName', DISPLAY_MAX)
        sourceOverride = optionalText(input.sourceName, 'sourceName', DISPLAY_MAX)
        scores = input.scores
        idempotencyKey = input.idempotencyKey === undefined ? null : requireText(input.idempotencyKey, 'idempotencyKey', 1, IDEMPOTENCY_KEY_MAX)
        override = validateApplicationOverride(input.override)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      // Create-dedup: a keyed re-create converges to the existing Application.
      if (idempotencyKey !== null) {
        const existing = await selectByIdempotencyKey(exec, workspaceId, idempotencyKey)
        if (existing) return { ok: true, application: toRecord(existing), created: false }
      }
      const lineage = await resolveLineage(exec, workspaceId, opportunityId)
      if (!lineage) return fail('missing_lineage', 'opportunity or its job not found in this workspace')
      if (lineage.opportunityRemoved) return fail('missing_lineage', 'opportunity is removed')
      // #304 optimistic lineage guards: the Opportunity must still point at the expected
      // Job, and the Job's facts must not have advanced since the caller evaluated them.
      if (input.expectedJobId !== undefined && input.expectedJobId !== lineage.jobId) {
        return fail('missing_lineage', 'opportunity no longer points at the expected job')
      }
      if (input.expectedJobFactsRevision !== undefined && input.expectedJobFactsRevision !== lineage.jobFactsRevision) {
        return fail('revision_conflict', 'job facts advanced since evaluation; refresh before promoting')
      }
      // Duplicate pre-check (attach/merge): resolve BEFORE inserting since an aborted
      // unique violation cannot recover on the same transaction. attach/merge reduce to
      // the same target for this 1:1 (workspace, opportunity) aggregate.
      const activeForOpportunity = await selectActiveByOpportunity(exec, workspaceId, opportunityId)
      if (activeForOpportunity) {
        if (input.duplicateResolution) {
          if (input.duplicateResolution.targetResourceId !== activeForOpportunity.id) {
            return fail('invalid_input', 'duplicateResolution.targetResourceId does not match the existing application for this opportunity')
          }
          return { ok: true, application: toRecord(activeForOpportunity), created: false }
        }
        return fail('deterministic_duplicate', 'an active application already exists for this opportunity')
      }
      const createdAt = nowIso()
      let snapshotJson: string
      try {
        snapshotJson = boundedJson(buildSnapshot(lineage.jobFacts, lineage.jobFactsRevision, createdAt, scores, input.initialLinks), 'snapshot', SNAPSHOT_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row: ApplicationRow = {
        id: newId(),
        workspaceId,
        opportunityId,
        jobId: lineage.jobId,
        revision: 1,
        status,
        jobFactsRevision: lineage.jobFactsRevision,
        snapshotJson,
        companyName: companyOverride ?? deriveCompany(lineage.jobFacts),
        sourceName: sourceOverride ?? 'Unknown',
        createdAt,
        updatedAt: createdAt,
        removedAt: null,
        idempotencyKey,
      }
      await insertApplications(exec).values(row)
      await appendHistory(exec, row.id, 1, 'created', { status, opportunityId, jobId: lineage.jobId }, actor, createdAt, override)
      return { ok: true, application: toRecord(row), created: true }
    },

    async create(input) {
      try {
        return await database.transaction((tx) => service.createOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('deterministic_duplicate', 'an active application already exists for this opportunity')
        throw error
      }
    },

    async get(workspaceId, applicationId) {
      const row = await selectById(workspaceId, applicationId)
      return row ? toRecord(row) : null
    },

    async list(workspaceId, query) {
      const rows = await database
        .select()
        .from(applications)
        .where(
          query?.includeRemoved
            ? eq(applications.workspaceId, workspaceId)
            : and(eq(applications.workspaceId, workspaceId), isNull(applications.removedAt)),
        )
        .orderBy(desc(applications.createdAt), asc(applications.id))
        .limit(query?.limit ?? 200)
      return (rows as ApplicationRow[]).map(toRecord)
    },

    async editCompany(input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let companyName: string
      try {
        resolved = await ids(input)
        companyName = requireText(input.companyName, 'companyName', 1, DISPLAY_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(resolved.workspaceId, resolved.applicationId)
      if (!row) return fail('not_found', 'application not found in this workspace')
      if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) return fail('revision_conflict', 'application was modified concurrently')
      return commit(row, resolved.actor, 'company_edited', { companyName }, { companyName }, eq(applications.revision, row.revision), 'revision_conflict')
    },

    async editSource(input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let sourceName: string
      try {
        resolved = await ids(input)
        sourceName = requireText(input.sourceName, 'sourceName', 1, DISPLAY_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(resolved.workspaceId, resolved.applicationId)
      if (!row) return fail('not_found', 'application not found in this workspace')
      if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) return fail('revision_conflict', 'application was modified concurrently')
      return commit(row, resolved.actor, 'source_edited', { sourceName }, { sourceName }, eq(applications.revision, row.revision), 'revision_conflict')
    },

    async transitionStatus(input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let status: ApplicationStatus
      try {
        resolved = await ids(input)
        status = requireOneOf(input.status, pursuitApplicationStatuses, 'status')
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(resolved.workspaceId, resolved.applicationId)
      if (!row) return fail('not_found', 'application not found in this workspace')
      if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) return fail('revision_conflict', 'application was modified concurrently')
      return commit(row, resolved.actor, 'status_changed', { status, priorStatus: row.status }, { status }, eq(applications.revision, row.revision), 'revision_conflict')
    },

    async refreshSnapshot(input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      try {
        resolved = await ids(input)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(resolved.workspaceId, resolved.applicationId)
      if (!row) return fail('not_found', 'application not found in this workspace')
      if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) return fail('revision_conflict', 'application was modified concurrently')
      const lineage = await resolveLineage(database, resolved.workspaceId, row.opportunityId)
      if (!lineage) return fail('missing_lineage', 'opportunity or its job no longer resolvable')
      if (input.expectedJobFactsRevision !== undefined && input.expectedJobFactsRevision !== lineage.jobFactsRevision) {
        return fail('revision_conflict', 'job facts advanced since evaluation; re-read before refreshing')
      }
      const priorScores = (() => {
        const parsed = safeParse(row.snapshotJson)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.scores ?? null : null
      })()
      // A refresh re-captures now; capturedAt reflects this refresh, not the create.
      // The creation-time initialLinks are carried forward unchanged (they freeze the
      // create, not the current mutable link set).
      const capturedAt = nowIso()
      let snapshotJson: string
      try {
        snapshotJson = boundedJson(buildSnapshot(lineage.jobFacts, lineage.jobFactsRevision, capturedAt, priorScores, priorInitialLinks(row.snapshotJson)), 'snapshot', SNAPSHOT_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      // #304 caller-driven reconciliation: adopt the refreshed Job company/source into the
      // head display fields only when the caller did NOT pin the corresponding preserve
      // flag. `undefined` (legacy callers) preserves — the head is untouched, matching the
      // pre-#304 refresh behavior. Links are never sourced from facts, so preserveLinkEdits
      // has no head effect (documented no-op).
      const headUpdate: HeadUpdate = { snapshotJson, jobFactsRevision: lineage.jobFactsRevision }
      if (input.preserveCompanyEdit === false) headUpdate.companyName = deriveCompany(lineage.jobFacts)
      if (input.preserveSourceEdit === false) headUpdate.sourceName = deriveSource(lineage.jobFacts, row.sourceName)
      return commit(
        row,
        resolved.actor,
        'snapshot_refreshed',
        {
          jobFactsRevision: lineage.jobFactsRevision,
          priorJobFactsRevision: row.jobFactsRevision,
          preserveCompanyEdit: input.preserveCompanyEdit ?? true,
          preserveSourceEdit: input.preserveSourceEdit ?? true,
          preserveLinkEdits: input.preserveLinkEdits ?? true,
        },
        headUpdate,
        eq(applications.revision, row.revision),
        'revision_conflict',
      )
    },

    async addLinkOn(exec, input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let link: ApplicationLinkInput
      try {
        resolved = await ids(input)
        link = {
          kind: requireText(input.link?.kind, 'link.kind', 1, LINK_KIND_MAX),
          label: requireText(input.link?.label, 'link.label', 1, LINK_LABEL_MAX),
          url: requireText(input.link?.url, 'link.url', 1, LINK_URL_MAX),
          isPrimary: Boolean(input.link?.isPrimary),
        }
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const [row] = await exec
        .select()
        .from(applications)
        .where(and(eq(applications.workspaceId, resolved.workspaceId), eq(applications.id, resolved.applicationId)))
        .limit(1)
      if (!row) return fail('not_found', 'application not found in this workspace')
      const [{ existing }] = await exec
        .select({ existing: sql<number>`count(*)` })
        .from(pursuitLinks)
        .where(eq(pursuitLinks.applicationId, resolved.applicationId))
      if (Number(existing) >= LINKS_LIMIT) return fail('links_limit_exceeded', `an application may have at most ${LINKS_LIMIT} links`)
      const createdAt = nowIso()
      const nextRevision = (row as ApplicationRow).revision + 1
      if (link.isPrimary) {
        await updatePursuitLinks(exec).set({ isPrimary: false }).where(and(eq(pursuitLinks.applicationId, resolved.applicationId), eq(pursuitLinks.isPrimary, true)))
      }
      const linkId = newId()
      await insertPursuitLinks(exec).values({ id: linkId, applicationId: resolved.applicationId, kind: link.kind, label: link.label, url: link.url, isPrimary: link.isPrimary, createdAt })
      const updated = await updateApplications(exec)
        .set({ revision: nextRevision, updatedAt: createdAt })
        .where(and(eq(applications.id, resolved.applicationId), eq(applications.revision, (row as ApplicationRow).revision)))
        .returning({ id: applications.id })
      if (updated.length === 0) return fail('revision_conflict', 'application was modified concurrently')
      await appendHistory(exec, resolved.applicationId, nextRevision, 'link_created', { linkId, kind: link.kind, isPrimary: link.isPrimary }, resolved.actor, createdAt)
      const record: ApplicationLinkRecord = { id: linkId, applicationId: resolved.applicationId, kind: link.kind, label: link.label, url: link.url, isPrimary: link.isPrimary, createdAt }
      return { ok: true, link: record, application: toRecord({ ...(row as ApplicationRow), revision: nextRevision, updatedAt: createdAt }) }
    },

    async addLink(input) {
      try {
        return await database.transaction((tx) => service.addLinkOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'application was modified concurrently')
        throw error
      }
    },

    async updateLink(input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let linkId: string
      try {
        resolved = await ids(input)
        linkId = requireText(input.linkId, 'linkId', 1, WORKSPACE_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(resolved.workspaceId, resolved.applicationId)
      if (!row) return fail('not_found', 'application not found in this workspace')
      const [existing] = await database.select().from(pursuitLinks).where(and(eq(pursuitLinks.id, linkId), eq(pursuitLinks.applicationId, resolved.applicationId))).limit(1)
      if (!existing) return fail('not_found', 'link not found on this application')
      let patch: { kind?: string; label?: string; url?: string; isPrimary?: boolean }
      try {
        patch = {}
        if (input.patch.kind !== undefined) patch.kind = requireText(input.patch.kind, 'link.kind', 1, LINK_KIND_MAX)
        if (input.patch.label !== undefined) patch.label = requireText(input.patch.label, 'link.label', 1, LINK_LABEL_MAX)
        if (input.patch.url !== undefined) patch.url = requireText(input.patch.url, 'link.url', 1, LINK_URL_MAX)
        if (input.patch.isPrimary !== undefined) patch.isPrimary = Boolean(input.patch.isPrimary)
        if (Object.keys(patch).length === 0) throw new ApplicationInputError('invalid_input', 'link patch is empty')
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const createdAt = nowIso()
      const nextRevision = row.revision + 1
      try {
        return await database.transaction(async (tx) => {
          if (patch.isPrimary === true) {
            await updatePursuitLinks(tx).set({ isPrimary: false }).where(and(eq(pursuitLinks.applicationId, resolved.applicationId), eq(pursuitLinks.isPrimary, true)))
          }
          await updatePursuitLinks(tx).set(patch).where(eq(pursuitLinks.id, linkId))
          const updated = await updateApplications(tx).set({ revision: nextRevision, updatedAt: createdAt }).where(and(eq(applications.id, row.id), eq(applications.revision, row.revision))).returning({ id: applications.id })
          if (updated.length === 0) return fail('revision_conflict', 'application was modified concurrently')
          await appendHistory(tx, row.id, nextRevision, 'link_updated', { linkId }, resolved.actor, createdAt)
          return { ok: true as const, application: toRecord({ ...row, revision: nextRevision, updatedAt: createdAt }) }
        })
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'application was modified concurrently')
        throw error
      }
    },

    async removeLink(input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let linkId: string
      try {
        resolved = await ids(input)
        linkId = requireText(input.linkId, 'linkId', 1, WORKSPACE_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(resolved.workspaceId, resolved.applicationId)
      if (!row) return fail('not_found', 'application not found in this workspace')
      const [existing] = await database.select().from(pursuitLinks).where(and(eq(pursuitLinks.id, linkId), eq(pursuitLinks.applicationId, resolved.applicationId))).limit(1)
      if (!existing) return fail('not_found', 'link not found on this application')
      const createdAt = nowIso()
      const nextRevision = row.revision + 1
      return database.transaction(async (tx) => {
        await deletePursuitLinks(tx).where(eq(pursuitLinks.id, linkId))
        const updated = await updateApplications(tx).set({ revision: nextRevision, updatedAt: createdAt }).where(and(eq(applications.id, row.id), eq(applications.revision, row.revision))).returning({ id: applications.id })
        if (updated.length === 0) return fail('revision_conflict', 'application was modified concurrently')
        await appendHistory(tx, row.id, nextRevision, 'link_removed', { linkId }, resolved.actor, createdAt)
        return { ok: true as const, application: toRecord({ ...row, revision: nextRevision, updatedAt: createdAt }) }
      })
    },

    async listLinks(workspaceId, applicationId) {
      const row = await selectById(workspaceId, applicationId)
      if (!row) return []
      const rows = await linkRows(applicationId)
      return rows.map((r) => ({ id: r.id, applicationId: r.applicationId, kind: r.kind, label: r.label, url: r.url, isPrimary: r.isPrimary, createdAt: r.createdAt }))
    },

    async recordEventOn(exec, input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let type: string
      let summary: string
      let occurredAt: string
      try {
        resolved = await ids(input)
        type = requireText(input.event?.type, 'event.type', 1, EVENT_TYPE_MAX)
        summary = requireText(input.event?.summary, 'event.summary', 1, SUMMARY_MAX)
        occurredAt = input.event?.occurredAt === undefined ? nowIso() : requireText(input.event.occurredAt, 'event.occurredAt', 1, TIMESTAMP_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const [row] = await exec
        .select({ id: applications.id })
        .from(applications)
        .where(and(eq(applications.workspaceId, resolved.workspaceId), eq(applications.id, resolved.applicationId)))
        .limit(1)
      if (!row) return fail('not_found', 'application not found in this workspace')
      const createdAt = nowIso()
      const id = newId()
      await insertApplicationEventRecords(exec).values({
        id,
        workspaceId: resolved.workspaceId,
        applicationId: resolved.applicationId,
        type,
        occurredAt,
        actorId: resolved.actor.id ?? resolved.actor.type,
        actorType: resolved.actor.type,
        actorDisplayName: null,
        summary,
        createdAt,
      })
      return { ok: true, event: { id, applicationId: resolved.applicationId, type, occurredAt, summary, actor: resolved.actor, createdAt } }
    },

    async recordEvent(input) {
      return database.transaction((tx) => service.recordEventOn(tx, input))
    },

    async listEvents(workspaceId, applicationId) {
      const row = await selectById(workspaceId, applicationId)
      if (!row) return []
      const rows = await database.select().from(applicationEventRecords).where(eq(applicationEventRecords.applicationId, applicationId)).orderBy(asc(applicationEventRecords.occurredAt), asc(applicationEventRecords.id))
      return rows.map((r) => ({ id: r.id, applicationId: r.applicationId, type: r.type, occurredAt: r.occurredAt, summary: r.summary, actor: { type: r.actorType as ApplicationActorType, id: r.actorId }, createdAt: r.createdAt }))
    },

    async recordAttempt(input) {
      let resolved: { workspaceId: string; applicationId: string; actor: ApplicationActor }
      let state: ApplicationAttemptState
      let startedAt: string
      let completedAt: string | null
      let summary: string | null
      try {
        resolved = await ids(input)
        state = requireOneOf(input.attempt?.state, attemptStates, 'attempt.state')
        startedAt = requireText(input.attempt?.startedAt, 'attempt.startedAt', 1, TIMESTAMP_MAX)
        completedAt = optionalText(input.attempt?.completedAt, 'attempt.completedAt', TIMESTAMP_MAX)
        summary = optionalText(input.attempt?.summary, 'attempt.summary', SUMMARY_MAX)
      } catch (error) {
        if (error instanceof ApplicationInputError) return fail(error.code, error.message)
        throw error
      }
      const row = await selectById(resolved.workspaceId, resolved.applicationId)
      if (!row) return fail('not_found', 'application not found in this workspace')
      const createdAt = nowIso()
      const id = newId()
      await insertApplicationAttemptRecords(database).values({ id, workspaceId: resolved.workspaceId, applicationId: resolved.applicationId, state, startedAt, completedAt, summary, createdAt })
      return { ok: true, attempt: { id, applicationId: resolved.applicationId, state, startedAt, completedAt, summary, createdAt } }
    },

    async listAttempts(workspaceId, applicationId) {
      const row = await selectById(workspaceId, applicationId)
      if (!row) return []
      const rows = await database.select().from(applicationAttemptRecords).where(eq(applicationAttemptRecords.applicationId, applicationId)).orderBy(asc(applicationAttemptRecords.startedAt), asc(applicationAttemptRecords.id))
      return rows.map((r) => ({ id: r.id, applicationId: r.applicationId, state: r.state as ApplicationAttemptState, startedAt: r.startedAt, completedAt: r.completedAt, summary: r.summary, createdAt: r.createdAt }))
    },

    removeOn,
    restoreOn,

    async remove(input) {
      try {
        return await database.transaction((tx) => removeOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('revision_conflict', 'application was modified concurrently')
        throw error
      }
    },

    async restore(input) {
      try {
        return await database.transaction((tx) => restoreOn(tx, input))
      } catch (error) {
        if (isUniqueViolation(error)) return fail('deterministic_duplicate', 'an active application already exists for this opportunity')
        throw error
      }
    },

    async history(workspaceId, applicationId) {
      const row = await selectById(workspaceId, applicationId)
      if (!row) return []
      const rows = await database.select().from(applicationHistory).where(eq(applicationHistory.applicationId, applicationId)).orderBy(asc(applicationHistory.revision))
      return rows.map((entry) => {
        const audit = safeParse(entry.auditJson)
        const actor = (audit as { actor?: { type?: string; id?: string | null } }).actor
        return {
          revision: entry.revision,
          kind: entry.kind as ApplicationHistoryKind,
          actor: { type: (actor?.type ?? 'system') as ApplicationActorType, id: actor?.id ?? null },
          createdAt: entry.createdAt,
        }
      })
    },
  }

  return service
}
