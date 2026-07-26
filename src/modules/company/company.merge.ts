import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import {
  mergeCompaniesInputSchema,
  type CompanyCommandFailure,
  type CompanyDuplicateCandidateRow,
  type MergeCompaniesResult,
  type WorkspaceCompaniesClient,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { createUuidV7Generator, type Clock, type UuidV7Generator } from '../../db/uuidv7'
import {
  admitCompanyCommand,
  appendCompanyHistory,
  capabilityFailure,
  companyCommandFingerprint,
  runCompanyCommand,
  successCompany,
  updateCompanyHead,
  type CompanyTx,
} from './company.command-support'
import { enqueueCompanyDuplicateReconsideration } from './company.duplicate-maintenance'
import {
  companyAliases,
  companyDuplicateCandidateReviews,
  companyDuplicateCandidates,
  jobCompanyAssignmentHistory,
  jobCompanyAssignments,
  workspaceCompanies,
} from './company.schema'
import { lifecycleFailure, normalizeCompanyText } from './company.values'

type MergeClient = WorkspaceCompaniesClient['duplicates']['merge']
type MergeInput = ReturnType<typeof mergeCompaniesInputSchema.parse>
type CompanyRow = typeof workspaceCompanies.$inferSelect
type CandidateRow = typeof companyDuplicateCandidates.$inferSelect

export function createCompanyMergeService(
  database: PgliteDatabase,
  workspaceId: string,
  options: {
    readonly now?: Clock
    readonly newId?: UuidV7Generator
  } = {},
): MergeClient {
  const clock = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(clock)
  const nowIso = () => clock().toISOString()

  return async (input: unknown): Promise<MergeCompaniesResult> => {
    const parsed = admitCompanyCommand(() => mergeCompaniesInputSchema.parse(input))
    if (parsed.workspaceId !== workspaceId) {
      return blocked(parsed, lifecycleFailure(
        'workspace_ownership',
        'The Companies do not belong to this workspace.',
      ))
    }
    const unavailable = await capabilityFailure(database, workspaceId)
    if (unavailable) return blocked(parsed, unavailable)
    return runCompanyCommand(database, {
      workspaceId,
      idempotencyKey: parsed.idempotencyKey,
      operation: 'merge',
      requestFingerprint: companyCommandFingerprint(parsed),
      now: nowIso,
    }, (tx) => executeMerge(tx, parsed, { newId, nowIso, workspaceId }))
  }
}

async function executeMerge(
  tx: CompanyTx,
  input: MergeInput,
  options: {
    readonly newId: UuidV7Generator
    readonly nowIso: () => string
    readonly workspaceId: string
  },
): Promise<MergeCompaniesResult> {
  const companyIds = [input.winnerCompanyId, input.loserCompanyId].sort()
  const companies = await tx
    .select()
    .from(workspaceCompanies)
    .where(and(
      eq(workspaceCompanies.workspaceId, options.workspaceId),
      inArray(workspaceCompanies.id, companyIds),
    ))
    .orderBy(asc(workspaceCompanies.id))
    .for('update')
  if (companies.length !== 2) {
    return blocked(input, lifecycleFailure(
      'invalid_input',
      'Both Companies must exist in this workspace.',
    ))
  }
  const byId = new Map(companies.map((company) => [company.id, company]))
  const winner = byId.get(input.winnerCompanyId)!
  const loser = byId.get(input.loserCompanyId)!
  const stale = mergeStaleFailure(input, winner, loser)
  if (stale) return blocked(input, stale)
  if (winner.status !== 'active' || loser.status !== 'active') {
    return blocked(input, lifecycleFailure(
      'impossible_state',
      'Only active Companies can be merged.',
    ))
  }
  if (input.loserDisplayNameConfirmation !== loser.displayName) {
    return blocked(input, {
      kind: 'lifecycle_failure',
      blocker: {
        code: 'invalid_input',
        field: 'loserDisplayNameConfirmation',
        message: 'Type the exact losing Company display name to confirm the merge.',
      },
    })
  }

  const timestamp = options.nowIso()
  const redirects = await selectRedirects(tx, options.workspaceId, loser.id)
  const candidates = await selectCandidates(tx, options.workspaceId, loser.id)
  const candidateSnapshots = await snapshotCandidates(tx, candidates)
  const assignments = await selectAssignments(tx, options.workspaceId, loser.id)
  await copyAliases(tx, winner, loser, timestamp, options.newId)
  const canonical = await updateCompanyHead(tx, winner, {}, timestamp)
  const merged = await updateCompanyHead(tx, loser, {
    status: 'merged',
    mergedIntoCompanyId: winner.id,
  }, timestamp)

  for (const redirect of redirects) {
    const flattened = await updateCompanyHead(tx, redirect, {
      mergedIntoCompanyId: winner.id,
    }, timestamp)
    await appendCompanyHistory(tx, {
      newId: options.newId,
      row: flattened,
      kind: 'merged',
      changedFields: ['merged_into_company_id'],
      actor: input.actor,
      rationale: input.rationale,
      relatedCompanyId: winner.id,
      occurredAt: timestamp,
    })
    await enqueueCompanyDuplicateReconsideration(tx, flattened, timestamp)
  }

  for (const assignment of assignments) {
    const [updated] = await tx
      .update(jobCompanyAssignments)
      .set({
        companyId: winner.id,
        revision: assignment.revision + 1,
        updatedAt: timestamp,
      })
      .where(and(
        eq(jobCompanyAssignments.workspaceId, options.workspaceId),
        eq(jobCompanyAssignments.jobId, assignment.jobId),
        eq(jobCompanyAssignments.companyId, loser.id),
        eq(jobCompanyAssignments.revision, assignment.revision),
      ))
      .returning()
    if (!updated) throw new Error('Job Company assignment changed during merge.')
    await tx.insert(jobCompanyAssignmentHistory).values({
      id: options.newId(),
      workspaceId: options.workspaceId,
      jobId: assignment.jobId,
      assignmentRevision: updated.revision,
      priorCompanyId: loser.id,
      companyId: winner.id,
      kind: 'merged',
      actorJson: JSON.stringify(input.actor),
      rationale: input.rationale,
      createdAt: timestamp,
    })
  }

  for (const candidate of candidates) {
    const snapshots = candidateSnapshots.get(candidate.id)!
    const [resolved] = await tx
      .update(companyDuplicateCandidates)
      .set({
        revision: candidate.revision + 1,
        status: 'resolved_by_merge',
        lowerResolvedSnapshotJson: JSON.stringify(snapshots.lower),
        higherResolvedSnapshotJson: JSON.stringify(snapshots.higher),
        updatedAt: timestamp,
      })
      .where(and(
        eq(companyDuplicateCandidates.id, candidate.id),
        eq(companyDuplicateCandidates.revision, candidate.revision),
        ne(companyDuplicateCandidates.status, 'resolved_by_merge'),
      ))
      .returning()
    if (!resolved) throw new Error('Duplicate candidate changed during merge.')
    await tx.insert(companyDuplicateCandidateReviews).values({
      id: options.newId(),
      workspaceId: options.workspaceId,
      candidateId: candidate.id,
      candidateRevision: resolved.revision,
      decision: 'merge',
      actorJson: JSON.stringify(input.actor),
      rationale: input.rationale,
      createdAt: timestamp,
    })
  }

  await appendCompanyHistory(tx, {
    newId: options.newId,
    row: canonical,
    kind: 'merged',
    changedFields: ['aliases'],
    actor: input.actor,
    rationale: input.rationale,
    relatedCompanyId: loser.id,
    occurredAt: timestamp,
  })
  await appendCompanyHistory(tx, {
    newId: options.newId,
    row: merged,
    kind: 'merged',
    changedFields: ['status', 'merged_into_company_id'],
    actor: input.actor,
    rationale: input.rationale,
    relatedCompanyId: winner.id,
    occurredAt: timestamp,
  })
  await enqueueCompanyDuplicateReconsideration(tx, canonical, timestamp)
  await enqueueCompanyDuplicateReconsideration(tx, merged, timestamp)

  return {
    status: 'merged',
    workspaceId: options.workspaceId,
    idempotencyKey: input.idempotencyKey,
    requestWinnerCompanyRevision: input.expectedWinnerCompanyRevision,
    requestLoserCompanyRevision: input.expectedLoserCompanyRevision,
    canonical: await successCompany(tx, canonical),
    merged: await successCompany(tx, merged),
    redirectPath: [input.winnerCompanyId],
    reassignedJobCount: assignments.length,
    flattenedRedirectCount: redirects.length,
    resolvedCandidateCount: candidates.length,
    historyPreserved: true,
    notesPreserved: { winner: true, loser: true },
  }
}

async function copyAliases(
  tx: CompanyTx,
  winner: CompanyRow,
  loser: CompanyRow,
  timestamp: string,
  newId: UuidV7Generator,
) {
  const aliases = await tx
    .select()
    .from(companyAliases)
    .where(and(
      eq(companyAliases.workspaceId, winner.workspaceId),
      inArray(companyAliases.companyId, [winner.id, loser.id]),
      isNull(companyAliases.removedAt),
    ))
    .orderBy(asc(companyAliases.companyId), asc(companyAliases.id))
    .for('update')
  const existing = new Set([
    winner.normalizedDisplayName,
    ...aliases
      .filter((alias) => alias.companyId === winner.id)
      .map((alias) => alias.normalizedValue),
  ])
  const sources = [
    { value: loser.displayName, normalizedValue: loser.normalizedDisplayName },
    ...aliases.filter((alias) => alias.companyId === loser.id),
  ]
  for (const source of sources) {
    if (existing.has(source.normalizedValue)) continue
    existing.add(source.normalizedValue)
    await tx.insert(companyAliases).values({
      id: newId(),
      workspaceId: winner.workspaceId,
      companyId: winner.id,
      value: source.value,
      normalizedValue: normalizeCompanyText(source.value),
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null,
    })
  }
}

async function selectRedirects(
  tx: CompanyTx,
  workspaceId: string,
  loserId: string,
) {
  return tx
    .select()
    .from(workspaceCompanies)
    .where(and(
      eq(workspaceCompanies.workspaceId, workspaceId),
      eq(workspaceCompanies.status, 'merged'),
      eq(workspaceCompanies.mergedIntoCompanyId, loserId),
    ))
    .orderBy(asc(workspaceCompanies.id))
    .for('update')
}

async function selectAssignments(
  tx: CompanyTx,
  workspaceId: string,
  loserId: string,
) {
  return tx
    .select()
    .from(jobCompanyAssignments)
    .where(and(
      eq(jobCompanyAssignments.workspaceId, workspaceId),
      eq(jobCompanyAssignments.companyId, loserId),
    ))
    .orderBy(asc(jobCompanyAssignments.jobId))
    .for('update')
}

async function selectCandidates(
  tx: CompanyTx,
  workspaceId: string,
  loserId: string,
) {
  return tx
    .select()
    .from(companyDuplicateCandidates)
    .where(and(
      eq(companyDuplicateCandidates.workspaceId, workspaceId),
      ne(companyDuplicateCandidates.status, 'resolved_by_merge'),
      or(
        eq(companyDuplicateCandidates.lowerCompanyId, loserId),
        eq(companyDuplicateCandidates.higherCompanyId, loserId),
      ),
    ))
    .orderBy(asc(companyDuplicateCandidates.id))
    .for('update')
}

async function snapshotCandidates(
  tx: CompanyTx,
  candidates: readonly CandidateRow[],
) {
  const result = new Map<string, {
    lower: CompanyDuplicateCandidateRow['left']
    higher: CompanyDuplicateCandidateRow['right']
  }>()
  for (const candidate of candidates) {
    const companies = await tx
      .select({
        id: workspaceCompanies.id,
        revision: workspaceCompanies.revision,
        displayName: workspaceCompanies.displayName,
        websiteUrl: workspaceCompanies.websiteUrl,
        status: workspaceCompanies.status,
        assignedJobCount: sql<number>`(
          select count(*)::int from job_company_assignments
          where job_company_assignments.workspace_id = ${candidate.workspaceId}
            and job_company_assignments.company_id = ${workspaceCompanies.id}
        )`,
      })
      .from(workspaceCompanies)
      .where(and(
        eq(workspaceCompanies.workspaceId, candidate.workspaceId),
        inArray(workspaceCompanies.id, [
          candidate.lowerCompanyId,
          candidate.higherCompanyId,
        ]),
      ))
    const byId = new Map(companies.map((company) => [company.id, company]))
    result.set(candidate.id, {
      lower: snapshotCompany(byId.get(candidate.lowerCompanyId)),
      higher: snapshotCompany(byId.get(candidate.higherCompanyId)),
    })
  }
  return result
}

function snapshotCompany(
  company: {
    id: string
    revision: number
    displayName: string
    websiteUrl: string | null
    status: string
    assignedJobCount: number
  } | undefined,
): CompanyDuplicateCandidateRow['left'] {
  if (!company || (company.status !== 'active' && company.status !== 'archived')) {
    throw new Error('Duplicate candidate Company snapshot is unavailable.')
  }
  return {
    companyId: company.id as CompanyDuplicateCandidateRow['left']['companyId'],
    revision: company.revision,
    displayName: company.displayName,
    websiteUrl: company.websiteUrl,
    status: company.status,
    assignedJobCount: Number(company.assignedJobCount),
  }
}

function mergeStaleFailure(
  input: MergeInput,
  winner: CompanyRow,
  loser: CompanyRow,
): CompanyCommandFailure | null {
  const guards: Extract<
    CompanyCommandFailure,
    { kind: 'stale_guard' }
  >['recovery']['guards'] = []
  if (winner.revision !== input.expectedWinnerCompanyRevision) {
    guards.push({
      kind: 'company_revision',
      companyId: input.winnerCompanyId,
      expectedRevision: input.expectedWinnerCompanyRevision,
      currentRevision: winner.revision,
    })
  }
  if (loser.revision !== input.expectedLoserCompanyRevision) {
    guards.push({
      kind: 'company_revision',
      companyId: input.loserCompanyId,
      expectedRevision: input.expectedLoserCompanyRevision,
      currentRevision: loser.revision,
    })
  }
  return guards.length === 0 ? null : {
    kind: 'stale_guard',
    blocker: {
      code: 'impossible_state',
      message: 'A Company changed. Refresh and review the merge again.',
    },
    recovery: { action: 'refresh_and_resubmit', guards },
  }
}

function blocked(
  input: MergeInput,
  failure: CompanyCommandFailure,
): MergeCompaniesResult {
  return {
    status: 'blocked',
    workspaceId: input.workspaceId,
    idempotencyKey: input.idempotencyKey,
    winnerCompanyId: input.winnerCompanyId,
    requestWinnerCompanyRevision: input.expectedWinnerCompanyRevision,
    loserCompanyId: input.loserCompanyId,
    requestLoserCompanyRevision: input.expectedLoserCompanyRevision,
    failure,
  }
}
