import { and, asc, count, eq, isNull, ne, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  companyCapabilitySchema,
  jobFactsSchema,
  type CompanyCapability,
} from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import { createUuidV7Generator, type Clock, type UuidV7Generator } from '../../db/uuidv7'
import { jobs } from '../job/job.schema'
import type {
  JobCreationCoveragePort,
  JobExec,
  JsonValue,
} from '../job/job.service'
import {
  companyBackfillJournal,
  companyCapabilityState,
  companyHistory,
  jobCompanyAssignmentHistory,
  jobCompanyAssignments,
  workspaceCompanies,
} from './company.schema'

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]
type CapabilityReason =
  | 'migration_failed'
  | 'invalid_legacy_data'
  | 'integrity_check_failed'

const UNKNOWN_COMPANY = 'Unknown company'
const BACKFILL_ACTOR = JSON.stringify({ id: 'company-backfill', type: 'system' })
const BACKFILL_RATIONALE = 'Established baseline Workspace Company coverage.'
const CREATED_FIELD = JSON.stringify(['display_name'])
const NO_AFFECTED_JOBS = JSON.stringify([])
const canonicalCompanies = alias(workspaceCompanies, 'canonical_companies')

export interface CompanyCoverageOptions {
  readonly now?: Clock
  readonly newId?: UuidV7Generator
  readonly pageSize?: number
}

export interface CompanyCoverageVerification {
  readonly ok: boolean
  readonly issueCount: number
  readonly checks: readonly string[]
}

export interface CompanyCoverageService {
  readonly jobCreationCoverage: JobCreationCoveragePort
  getCapability(workspaceId: string): Promise<CompanyCapability>
  prepare(workspaceId: string): Promise<CompanyCapability>
  backfillNextPage(workspaceId: string): Promise<number>
  verify(workspaceId: string): Promise<CompanyCoverageVerification>
  migrateToReady(workspaceId: string): Promise<CompanyCapability>
}

export function createCompanyCoverageService(
  database: PgliteDatabase,
  options: CompanyCoverageOptions = {},
): CompanyCoverageService {
  const clock = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(clock)
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50))
  const nowIso = () => clock().toISOString()

  async function ensureAssignmentOn(
    exec: JobExec,
    input: {
      readonly workspaceId: string
      readonly jobId: string
      readonly facts: JsonValue
      readonly createdAt: string
    },
    backfill = false,
  ): Promise<void> {
    const [existing] = await exec
      .select({ jobId: jobCompanyAssignments.jobId })
      .from(jobCompanyAssignments)
      .where(eq(jobCompanyAssignments.jobId, input.jobId))
      .limit(1)
    if (existing) return

    const companyId = input.jobId
    const companyName = companyNameFromFacts(input.facts)
    const timestamp = nowIso()
    await exec.insert(workspaceCompanies).values({
      id: companyId,
      workspaceId: input.workspaceId,
      displayName: companyName,
      normalizedDisplayName: normalizeCompanyName(companyName),
      websiteUrl: null,
      websiteHost: null,
      notes: null,
      revision: 1,
      status: 'active',
      mergedIntoCompanyId: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }).onConflictDoNothing()
    await exec.insert(companyHistory).values({
      id: newId(),
      workspaceId: input.workspaceId,
      companyId,
      sequence: 1,
      companyRevision: 1,
      kind: 'created',
      changedFieldsJson: CREATED_FIELD,
      actorJson: BACKFILL_ACTOR,
      rationale: BACKFILL_RATIONALE,
      relatedCompanyId: null,
      affectedJobIdsJson: NO_AFFECTED_JOBS,
      createdAt: timestamp,
    }).onConflictDoNothing()
    await exec.insert(jobCompanyAssignments).values({
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      companyId,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await exec.insert(jobCompanyAssignmentHistory).values({
      id: newId(),
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      assignmentRevision: 1,
      priorCompanyId: null,
      companyId,
      kind: backfill ? 'baseline' : 'assigned',
      actorJson: BACKFILL_ACTOR,
      rationale: BACKFILL_RATIONALE,
      createdAt: timestamp,
    })
    if (backfill) {
      await exec.insert(companyBackfillJournal).values({
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        companyId,
        usedUnknownName: companyName === UNKNOWN_COMPANY ? 1 : 0,
        completedAt: timestamp,
      }).onConflictDoNothing()
    }
  }

  async function getCapability(workspaceId: string): Promise<CompanyCapability> {
    const [row] = await database
      .select()
      .from(companyCapabilityState)
      .where(eq(companyCapabilityState.workspaceId, workspaceId))
      .limit(1)
    if (!row) {
      return { status: 'migrating', completed: 0, total: 0, issueCount: 0 }
    }
    return companyCapabilitySchema.parse(capabilityFromRow(row))
  }

  async function prepare(workspaceId: string): Promise<CompanyCapability> {
    const current = await getCapability(workspaceId)
    if (current.status === 'blocked') return current
    const total = await countJobs(database, workspaceId)
    const completed = await countAssignments(database, workspaceId)
    const timestamp = nowIso()
    await database.insert(companyCapabilityState).values({
      workspaceId,
      status: 'migrating',
      completed: Math.min(completed, total),
      total,
      issueCount: 0,
      blockedReason: null,
      message: null,
      updatedAt: timestamp,
    }).onConflictDoUpdate({
      target: companyCapabilityState.workspaceId,
      set: {
        status: 'migrating',
        completed: Math.min(completed, total),
        total,
        issueCount: 0,
        blockedReason: null,
        message: null,
        updatedAt: timestamp,
      },
    })
    return getCapability(workspaceId)
  }

  async function backfillNextPage(workspaceId: string): Promise<number> {
    return database.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: jobs.id,
          workspaceId: jobs.workspaceId,
          factsJson: jobs.factsJson,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .leftJoin(jobCompanyAssignments, eq(jobCompanyAssignments.jobId, jobs.id))
        .where(and(
          eq(jobs.workspaceId, workspaceId),
          isNull(jobCompanyAssignments.jobId),
        ))
        .orderBy(asc(jobs.createdAt), asc(jobs.id))
        .limit(pageSize)
      for (const row of rows) {
        await ensureAssignmentOn(tx, {
          workspaceId: row.workspaceId,
          jobId: row.id,
          facts: parseFacts(row.factsJson),
          createdAt: row.createdAt,
        }, true)
      }
      await updateProgress(tx, workspaceId, nowIso())
      return rows.length
    })
  }

  async function verify(workspaceId: string): Promise<CompanyCoverageVerification> {
    const checks: string[] = []
    const jobCount = await countJobs(database, workspaceId)
    const assignmentCount = await countAssignments(database, workspaceId)
    if (assignmentCount !== jobCount) checks.push('assignment_count')

    const [missing] = await database
      .select({ id: jobs.id })
      .from(jobs)
      .leftJoin(jobCompanyAssignments, eq(jobCompanyAssignments.jobId, jobs.id))
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        isNull(jobCompanyAssignments.jobId),
      ))
      .limit(1)
    if (missing) checks.push('missing_assignment')

    const [foreign] = await database
      .select({ jobId: jobCompanyAssignments.jobId })
      .from(jobCompanyAssignments)
      .innerJoin(jobs, eq(jobs.id, jobCompanyAssignments.jobId))
      .where(and(
        eq(jobs.workspaceId, workspaceId),
        ne(jobCompanyAssignments.workspaceId, jobs.workspaceId),
      ))
      .limit(1)
    if (foreign) checks.push('workspace_ownership')

    const [missingHistory] = await database
      .select({ jobId: jobCompanyAssignments.jobId })
      .from(jobCompanyAssignments)
      .leftJoin(jobCompanyAssignmentHistory, and(
        eq(jobCompanyAssignmentHistory.jobId, jobCompanyAssignments.jobId),
        eq(
          jobCompanyAssignmentHistory.workspaceId,
          jobCompanyAssignments.workspaceId,
        ),
        eq(
          jobCompanyAssignmentHistory.companyId,
          jobCompanyAssignments.companyId,
        ),
        eq(
          jobCompanyAssignmentHistory.assignmentRevision,
          jobCompanyAssignments.revision,
        ),
      ))
      .where(and(
        eq(jobCompanyAssignments.workspaceId, workspaceId),
        isNull(jobCompanyAssignmentHistory.id),
      ))
      .limit(1)
    if (missingHistory) checks.push('assignment_history')

    const [missingBaseline] = await database
      .select({ jobId: companyBackfillJournal.jobId })
      .from(companyBackfillJournal)
      .leftJoin(jobCompanyAssignmentHistory, and(
        eq(jobCompanyAssignmentHistory.jobId, companyBackfillJournal.jobId),
        eq(
          jobCompanyAssignmentHistory.workspaceId,
          companyBackfillJournal.workspaceId,
        ),
        eq(
          jobCompanyAssignmentHistory.companyId,
          companyBackfillJournal.companyId,
        ),
        eq(jobCompanyAssignmentHistory.assignmentRevision, 1),
        eq(jobCompanyAssignmentHistory.kind, 'baseline'),
      ))
      .where(and(
        eq(companyBackfillJournal.workspaceId, workspaceId),
        isNull(jobCompanyAssignmentHistory.id),
      ))
      .limit(1)
    if (missingBaseline) checks.push('baseline_history')

    const [invalidMergedTarget] = await database
      .select({ companyId: workspaceCompanies.id })
      .from(jobCompanyAssignments)
      .innerJoin(
        workspaceCompanies,
        eq(workspaceCompanies.id, jobCompanyAssignments.companyId),
      )
      .leftJoin(canonicalCompanies, and(
        eq(canonicalCompanies.workspaceId, workspaceCompanies.workspaceId),
        eq(canonicalCompanies.id, workspaceCompanies.mergedIntoCompanyId),
      ))
      .where(and(
        eq(jobCompanyAssignments.workspaceId, workspaceId),
        eq(workspaceCompanies.status, 'merged'),
        or(
          isNull(canonicalCompanies.id),
          ne(canonicalCompanies.status, 'active'),
        ),
      ))
      .limit(1)
    if (invalidMergedTarget) checks.push('merged_target')

    return {
      ok: checks.length === 0,
      issueCount: checks.length,
      checks,
    }
  }

  async function migrateToReady(workspaceId: string): Promise<CompanyCapability> {
    try {
      const prepared = await prepare(workspaceId)
      if (prepared.status === 'blocked') return prepared
      while (await backfillNextPage(workspaceId) > 0) {
        // Each iteration is one bounded, journaled transaction.
      }
      const verification = await verify(workspaceId)
      if (!verification.ok) {
        return blockCapability(
          workspaceId,
          'integrity_check_failed',
          verification.issueCount,
          'Workspace Company coverage verification failed.',
        )
      }
      const total = await countJobs(database, workspaceId)
      await database.insert(companyCapabilityState).values({
        workspaceId,
        status: 'ready',
        completed: total,
        total,
        issueCount: 0,
        blockedReason: null,
        message: null,
        updatedAt: nowIso(),
      }).onConflictDoUpdate({
        target: companyCapabilityState.workspaceId,
        set: {
          status: 'ready',
          completed: total,
          total,
          issueCount: 0,
          blockedReason: null,
          message: null,
          updatedAt: nowIso(),
        },
      })
      return { status: 'ready' }
    } catch {
      return blockCapability(
        workspaceId,
        'migration_failed',
        1,
        'Workspace Company migration could not be completed.',
      )
    }
  }

  async function blockCapability(
    workspaceId: string,
    reason: CapabilityReason,
    issueCount: number,
    message: string,
  ): Promise<CompanyCapability> {
    const total = await countJobs(database, workspaceId)
    const completed = Math.min(await countAssignments(database, workspaceId), total)
    await database.insert(companyCapabilityState).values({
      workspaceId,
      status: 'blocked',
      completed,
      total,
      issueCount: Math.max(1, issueCount),
      blockedReason: reason,
      message,
      updatedAt: nowIso(),
    }).onConflictDoUpdate({
      target: companyCapabilityState.workspaceId,
      set: {
        status: 'blocked',
        completed,
        total,
        issueCount: Math.max(1, issueCount),
        blockedReason: reason,
        message,
        updatedAt: nowIso(),
      },
    })
    return getCapability(workspaceId)
  }

  return {
    jobCreationCoverage: { ensureAssignmentOn },
    getCapability,
    prepare,
    backfillNextPage,
    verify,
    migrateToReady,
  }
}

async function countJobs(exec: JobExec, workspaceId: string): Promise<number> {
  const [row] = await exec
    .select({ value: count() })
    .from(jobs)
    .where(eq(jobs.workspaceId, workspaceId))
  return Number(row?.value ?? 0)
}

async function countAssignments(exec: JobExec, workspaceId: string): Promise<number> {
  const [row] = await exec
    .select({ value: count() })
    .from(jobCompanyAssignments)
    .where(eq(jobCompanyAssignments.workspaceId, workspaceId))
  return Number(row?.value ?? 0)
}

async function updateProgress(tx: Tx, workspaceId: string, updatedAt: string) {
  const total = await countJobs(tx, workspaceId)
  const completed = Math.min(await countAssignments(tx, workspaceId), total)
  await tx.update(companyCapabilityState).set({
    completed,
    total,
    updatedAt,
  }).where(eq(companyCapabilityState.workspaceId, workspaceId))
}

function capabilityFromRow(
  row: typeof companyCapabilityState.$inferSelect,
): CompanyCapability {
  if (row.status === 'ready') return { status: 'ready' }
  if (row.status === 'blocked') {
    return {
      status: 'blocked',
      issueCount: Math.max(1, row.issueCount),
      reason: row.blockedReason as CapabilityReason,
      message: row.message ?? 'Workspace Company capability is blocked.',
      remediation: null,
    }
  }
  return {
    status: 'migrating',
    completed: row.completed,
    total: row.total,
    issueCount: row.issueCount,
  }
}

function parseFacts(factsJson: string): JsonValue {
  try {
    return JSON.parse(factsJson) as JsonValue
  } catch {
    return null
  }
}

function companyNameFromFacts(facts: JsonValue): string {
  const parsed = jobFactsSchema.safeParse(facts)
  return parsed.success ? parsed.data.companyName : UNKNOWN_COMPANY
}

function normalizeCompanyName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}
