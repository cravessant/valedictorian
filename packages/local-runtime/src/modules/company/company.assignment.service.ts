import { and, eq } from 'drizzle-orm'
import {
  jobFactsSchema,
  jobFactsV2Schema,
  reassignJobCompanyInputSchema,
  type CompanyCommandFailure,
  type JobCompanyAssignmentPresentation,
  type ReassignJobCompanyResult,
  type WorkspaceCompanyAssignmentsClient,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite.js'
import { createUuidV7Generator, type Clock, type UuidV7Generator } from '../../db/uuidv7.js'
import { jobs } from '../job/job.schema.js'
import type { InitialCompanyAssignmentPort, JobExec, JsonValue } from '../job/job.service.js'
import {
  admitCompanyCommand,
  companyCommandFingerprint,
  lockCompanyWorkspace,
  runCompanyCommand,
  type CompanyTx,
} from './company.command-support.js'
import {
  companyHistory,
  jobCompanyAssignmentHistory,
  jobCompanyAssignments,
  workspaceCompanies,
} from './company.schema.js'
import { lifecycleFailure, normalizeCompanyText, roleAndAssertedCompany } from './company.values.js'

export interface CompanyAssignmentServiceOptions {
  readonly workspaceId: string
  readonly now?: Clock
  readonly newId?: UuidV7Generator
}

const UNKNOWN_COMPANY = 'Unknown company'
const JOB_CREATION_ACTOR = { id: 'job-creation', type: 'system' } as const
const JOB_CREATION_RATIONALE = 'Established the canonical Company for a new Job.'
const CREATED_FIELDS = JSON.stringify(['display_name'])
const NO_AFFECTED_JOBS = JSON.stringify([])

/**
 * Company-owned canonical assignment for a Job created without an explicit
 * Company selection: mint the Company named by the Job's facts and assign it.
 * The Company id is the Job id, so a re-issued create converges on the same
 * canonical record instead of minting a second one.
 */
export function createInitialCompanyAssignment(
  options: { readonly now?: Clock; readonly newId?: UuidV7Generator } = {},
): InitialCompanyAssignmentPort {
  const clock = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(clock)

  return {
    async establishInitialCompanyOn(exec: JobExec, input): Promise<void> {
      await lockCompanyWorkspace(exec, input.workspaceId)
      const [existing] = await exec
        .select({ jobId: jobCompanyAssignments.jobId })
        .from(jobCompanyAssignments)
        .where(eq(jobCompanyAssignments.jobId, input.jobId))
        .limit(1)
      if (existing) return

      const companyId = input.jobId
      const displayName = companyNameFromFacts(input.facts)
      const timestamp = clock().toISOString()
      await exec.insert(workspaceCompanies).values({
        id: companyId,
        workspaceId: input.workspaceId,
        displayName,
        normalizedDisplayName: normalizeCompanyText(displayName),
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
        changedFieldsJson: CREATED_FIELDS,
        actorJson: JSON.stringify(JOB_CREATION_ACTOR),
        rationale: JOB_CREATION_RATIONALE,
        relatedCompanyId: null,
        affectedJobIdsJson: NO_AFFECTED_JOBS,
        createdAt: timestamp,
      }).onConflictDoNothing()
      await assignInitialCompanyOn(exec, {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        companyId,
        actor: JOB_CREATION_ACTOR,
        rationale: JOB_CREATION_RATIONALE,
        now: timestamp,
        newId,
      })
    },
  }
}

function companyNameFromFacts(facts: JsonValue): string {
  const v2 = jobFactsV2Schema.safeParse(facts)
  if (v2.success) return v2.data.companyName
  const v1 = jobFactsSchema.safeParse(facts)
  return v1.success ? v1.data.companyName : UNKNOWN_COMPANY
}

/** Company-owned initial assignment conversation for an atomically created Job. */
export async function assignInitialCompanyOn(
  tx: JobExec,
  input: {
    readonly workspaceId: string
    readonly jobId: string
    readonly companyId: string
    readonly actor: { readonly id: string; readonly type: 'user' | 'agent' | 'system'; readonly displayName?: string }
    readonly rationale: string
    readonly now: string
    readonly newId: () => string
  },
): Promise<void> {
  const [created] = await tx.insert(jobCompanyAssignments).values({
    jobId: input.jobId,
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoNothing().returning({ jobId: jobCompanyAssignments.jobId })
  if (!created) {
    const [existing] = await tx.select({
      workspaceId: jobCompanyAssignments.workspaceId,
      companyId: jobCompanyAssignments.companyId,
    }).from(jobCompanyAssignments).where(eq(jobCompanyAssignments.jobId, input.jobId)).limit(1)
    if (!existing || existing.workspaceId !== input.workspaceId || existing.companyId !== input.companyId) {
      throw new Error('Initial Company assignment conflicts with the selected Company.')
    }
    return
  }
  await tx.insert(jobCompanyAssignmentHistory).values({
    id: input.newId(),
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    assignmentRevision: 1,
    priorCompanyId: null,
    companyId: input.companyId,
    kind: 'assigned',
    actorJson: JSON.stringify(input.actor),
    rationale: input.rationale,
    createdAt: input.now,
  })
}

type ReassignInput = ReturnType<typeof reassignJobCompanyInputSchema.parse>
type AssignmentRow = typeof jobCompanyAssignments.$inferSelect
type CompanyRow = typeof workspaceCompanies.$inferSelect
type JobRow = typeof jobs.$inferSelect

export function createPgliteCompanyAssignmentService(
  database: PgliteDatabase,
  options: CompanyAssignmentServiceOptions,
): WorkspaceCompanyAssignmentsClient {
  const { workspaceId } = options
  const clock = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(clock)
  const nowIso = () => clock().toISOString()

  async function get(jobId: string): Promise<JobCompanyAssignmentPresentation> {
    const rows = await assignmentRows(database, workspaceId, jobId)
    if (!rows) throw new CompanyAssignmentNotFoundError()
    return presentation(rows.assignment, rows.company, rows.job)
  }

  async function reassign(input: unknown): Promise<ReassignJobCompanyResult> {
    const parsed = admitCompanyCommand(() => reassignJobCompanyInputSchema.parse(input))
    if (parsed.workspaceId !== workspaceId) {
      return blocked(parsed, lifecycleFailure(
        'workspace_ownership',
        'The Job assignment does not belong to this workspace.',
      ))
    }
    return runCompanyCommand(database, {
      workspaceId,
      idempotencyKey: parsed.idempotencyKey,
      operation: 'reassign',
      requestFingerprint: companyCommandFingerprint(parsed),
      now: nowIso,
    }, async (tx) => executeReassignment(tx, parsed, {
      workspaceId,
      newId,
      nowIso,
    }))
  }

  return { get, reassign }
}

async function executeReassignment(
  tx: CompanyTx,
  input: ReassignInput,
  options: {
    readonly workspaceId: string
    readonly newId: UuidV7Generator
    readonly nowIso: () => string
  },
): Promise<ReassignJobCompanyResult> {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.id, input.jobId))
    .limit(1)
    .for('update')
  if (!job) {
    return blocked(input, lifecycleFailure('invalid_input', 'The Job does not exist.'))
  }
  if (job.workspaceId !== options.workspaceId) {
    return blocked(input, lifecycleFailure(
      'workspace_ownership',
      'The Job does not belong to this workspace.',
    ))
  }
  if (job.removedAt) {
    return blocked(input, lifecycleFailure(
      'impossible_state',
      'Removed Jobs cannot be reassigned.',
    ))
  }
  const [assignment] = await tx
    .select()
    .from(jobCompanyAssignments)
    .where(and(
      eq(jobCompanyAssignments.workspaceId, options.workspaceId),
      eq(jobCompanyAssignments.jobId, input.jobId),
    ))
    .limit(1)
    .for('update')
  if (!assignment) {
    return blocked(input, lifecycleFailure(
      'missing_lineage',
      'The Job has no current Company assignment.',
    ))
  }
  const [destination] = await tx
    .select()
    .from(workspaceCompanies)
    .where(eq(workspaceCompanies.id, input.destinationCompanyId))
    .limit(1)
    .for('update')
  if (!destination) {
    return blocked(input, lifecycleFailure(
      'invalid_input',
      'The destination Company does not exist.',
    ))
  }
  if (destination.workspaceId !== options.workspaceId) {
    return blocked(input, lifecycleFailure(
      'workspace_ownership',
      'The destination Company does not belong to this workspace.',
    ))
  }
  const stale = staleFailure(input, assignment, destination)
  if (stale) return blocked(input, stale)
  if (destination.status === 'merged') {
    return blocked(input, {
      kind: 'lifecycle_failure',
      blocker: {
        code: 'impossible_state',
        message: 'Choose the active canonical Company instead of the merged record.',
        ...(destination.mergedIntoCompanyId
          ? { conflictingResourceId: destination.mergedIntoCompanyId }
          : {}),
      },
    })
  }
  if (destination.status !== 'active') {
    return blocked(input, lifecycleFailure(
      'impossible_state',
      'Only an active Company can receive a Job assignment.',
    ))
  }
  if (assignment.companyId === destination.id) {
    return blocked(input, lifecycleFailure(
      'invalid_input',
      'The Job is already assigned to that Company.',
    ))
  }
  const timestamp = options.nowIso()
  const [updated] = await tx
    .update(jobCompanyAssignments)
    .set({
      companyId: destination.id,
      revision: assignment.revision + 1,
      updatedAt: timestamp,
    })
    .where(and(
      eq(jobCompanyAssignments.workspaceId, options.workspaceId),
      eq(jobCompanyAssignments.jobId, input.jobId),
      eq(jobCompanyAssignments.companyId, assignment.companyId),
      eq(jobCompanyAssignments.revision, input.expectedAssignmentRevision),
    ))
    .returning()
  if (!updated) {
    const [current] = await tx
      .select({ revision: jobCompanyAssignments.revision })
      .from(jobCompanyAssignments)
      .where(eq(jobCompanyAssignments.jobId, input.jobId))
      .limit(1)
    return blocked(input, assignmentStale(
      input.jobId,
      input.expectedAssignmentRevision,
      current?.revision ?? input.expectedAssignmentRevision + 1,
    ))
  }
  await tx.insert(jobCompanyAssignmentHistory).values({
    id: options.newId(),
    workspaceId: options.workspaceId,
    jobId: input.jobId,
    assignmentRevision: updated.revision,
    priorCompanyId: assignment.companyId,
    companyId: destination.id,
    kind: 'reassigned',
    actorJson: JSON.stringify(input.actor),
    rationale: input.rationale,
    createdAt: timestamp,
  })
  return {
    status: 'reassigned',
    workspaceId: options.workspaceId,
    jobId: input.jobId,
    requestAssignmentRevision: input.expectedAssignmentRevision,
    requestDestinationCompanyRevision: input.expectedDestinationCompanyRevision,
    idempotencyKey: input.idempotencyKey,
    assignment: presentation(updated, destination, job),
    jobFactsChanged: false,
  }
}

async function assignmentRows(
  database: PgliteDatabase,
  workspaceId: string,
  jobId: string,
): Promise<{
  assignment: AssignmentRow
  company: CompanyRow
  job: JobRow
} | null> {
  const [row] = await database
    .select({
      assignment: jobCompanyAssignments,
      company: workspaceCompanies,
      job: jobs,
    })
    .from(jobCompanyAssignments)
    .innerJoin(jobs, and(
      eq(jobs.id, jobCompanyAssignments.jobId),
      eq(jobs.workspaceId, jobCompanyAssignments.workspaceId),
    ))
    .innerJoin(workspaceCompanies, and(
      eq(workspaceCompanies.id, jobCompanyAssignments.companyId),
      eq(workspaceCompanies.workspaceId, jobCompanyAssignments.workspaceId),
    ))
    .where(and(
      eq(jobCompanyAssignments.workspaceId, workspaceId),
      eq(jobCompanyAssignments.jobId, jobId),
    ))
    .limit(1)
  return row ?? null
}

function presentation(
  assignment: AssignmentRow,
  company: CompanyRow,
  job: JobRow,
): JobCompanyAssignmentPresentation {
  if (company.status === 'merged') {
    throw new Error('A current Job assignment cannot target a merged Company.')
  }
  const facts = roleAndAssertedCompany(job.factsJson)
  return {
    jobId: job.id as JobCompanyAssignmentPresentation['jobId'],
    assignmentRevision: assignment.revision,
    workspaceCompany: {
      companyId: company.id as JobCompanyAssignmentPresentation['workspaceCompany']['companyId'],
      revision: company.revision,
      displayName: company.displayName,
      status: company.status as 'active' | 'archived',
    },
    jobFactsCompanyName: facts.companyName,
    roleTitle: facts.roleTitle,
    namesDiffer: normalizeCompanyText(facts.companyName) !== company.normalizedDisplayName,
  }
}

function staleFailure(
  input: ReassignInput,
  assignment: AssignmentRow,
  destination: CompanyRow,
): CompanyCommandFailure | null {
  const guards: Array<
    Extract<CompanyCommandFailure, { kind: 'stale_guard' }>['recovery']['guards'][number]
  > = []
  if (assignment.revision !== input.expectedAssignmentRevision) {
    guards.push({
      kind: 'assignment_revision',
      jobId: input.jobId,
      expectedRevision: input.expectedAssignmentRevision,
      currentRevision: assignment.revision,
    })
  }
  if (destination.revision !== input.expectedDestinationCompanyRevision) {
    guards.push({
      kind: 'company_revision',
      companyId: input.destinationCompanyId,
      expectedRevision: input.expectedDestinationCompanyRevision,
      currentRevision: destination.revision,
    })
  }
  return guards.length === 0 ? null : {
    kind: 'stale_guard',
    blocker: {
      code: 'impossible_state',
      message: 'The assignment or destination Company changed. Refresh and submit again.',
    },
    recovery: { action: 'refresh_and_resubmit', guards },
  }
}

function assignmentStale(
  jobId: ReassignInput['jobId'],
  expectedRevision: number,
  currentRevision: number,
): CompanyCommandFailure {
  return {
    kind: 'stale_guard',
    blocker: {
      code: 'impossible_state',
      message: 'The assignment changed. Refresh and submit again.',
    },
    recovery: {
      action: 'refresh_and_resubmit',
      guards: [{
        kind: 'assignment_revision',
        jobId,
        expectedRevision,
        currentRevision,
      }],
    },
  }
}

function blocked(
  input: ReassignInput,
  failure: CompanyCommandFailure,
): ReassignJobCompanyResult {
  return {
    status: 'blocked',
    workspaceId: input.workspaceId,
    idempotencyKey: input.idempotencyKey,
    jobId: input.jobId,
    requestAssignmentRevision: input.expectedAssignmentRevision,
    destinationCompanyId: input.destinationCompanyId,
    requestDestinationCompanyRevision: input.expectedDestinationCompanyRevision,
    failure,
  }
}

class CompanyAssignmentNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('The requested Job Company assignment was not found.')
    this.name = 'CompanyAssignmentNotFoundError'
  }
}
