import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { PgliteDatabase } from '../../db/pglite'
import type { UuidV7Generator } from '../../db/uuidv7'
import {
  companyAliases,
  companyDuplicateCandidates,
  companyDuplicateIndexState,
  companyDuplicateMaintenanceWork,
  workspaceCompanies,
} from './company.schema'
import {
  lockCompanyWorkspace,
  type CompanyTx,
} from './company.command-support'
import {
  COMPANY_DUPLICATE_MATCHER_VERSION,
  companyDuplicateFingerprint,
  scoreCompanyDuplicatePair,
  type CompanyDuplicateInput,
} from './company.duplicate-scorer'

const SEED_BATCH = 25
const WORK_BATCH = 20
const SIGNAL_LIMIT = 100
const MAX_CANDIDATES_PER_COMPANY = 300

type CompanyRow = typeof workspaceCompanies.$inferSelect
type CandidateRow = typeof companyDuplicateCandidates.$inferSelect

export async function enqueueCompanyDuplicateReconsideration(
  tx: CompanyTx,
  row: Pick<CompanyRow, 'workspaceId' | 'id' | 'revision'>,
  timestamp: string,
) {
  await tx.insert(companyDuplicateMaintenanceWork).values({
    workspaceId: row.workspaceId,
    companyId: row.id,
    requestedRevision: row.revision,
    processedRevision: null,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoUpdate({
    target: [
      companyDuplicateMaintenanceWork.workspaceId,
      companyDuplicateMaintenanceWork.companyId,
    ],
    set: {
      requestedRevision: sql`greatest(
        ${companyDuplicateMaintenanceWork.requestedRevision},
        excluded.requested_revision
      )`,
      status: 'pending',
      updatedAt: timestamp,
    },
  })
}

export async function runCompanyDuplicateMaintenance(
  database: PgliteDatabase,
  workspaceId: string,
  options: {
    readonly newId: UuidV7Generator
    readonly nowIso: () => string
  },
) {
  await seedMaintenanceBatch(database, workspaceId, options.nowIso())
  for (let processed = 0; processed < WORK_BATCH; processed += 1) {
    const found = await processNextWork(database, workspaceId, options)
    if (!found) break
  }
}

async function seedMaintenanceBatch(
  database: PgliteDatabase,
  workspaceId: string,
  timestamp: string,
) {
  await database.transaction(async (tx) => {
    await lockCompanyWorkspace(tx, workspaceId)
    let [state] = await tx
      .select()
      .from(companyDuplicateIndexState)
      .where(eq(companyDuplicateIndexState.workspaceId, workspaceId))
      .limit(1)
      .for('update')
    if (!state) {
      [state] = await tx.insert(companyDuplicateIndexState).values({
        workspaceId,
        matcherVersion: COMPANY_DUPLICATE_MATCHER_VERSION,
        afterCompanyId: null,
        status: 'indexing',
        updatedAt: timestamp,
      }).onConflictDoNothing({
        target: companyDuplicateIndexState.workspaceId,
      }).returning()
      if (!state) {
        [state] = await tx
          .select()
          .from(companyDuplicateIndexState)
          .where(eq(companyDuplicateIndexState.workspaceId, workspaceId))
          .limit(1)
          .for('update')
      }
    }
    if (state && state.matcherVersion !== COMPANY_DUPLICATE_MATCHER_VERSION) {
      [state] = await tx.update(companyDuplicateIndexState).set({
        matcherVersion: COMPANY_DUPLICATE_MATCHER_VERSION,
        afterCompanyId: null,
        status: 'indexing',
        updatedAt: timestamp,
      }).where(eq(companyDuplicateIndexState.workspaceId, workspaceId)).returning()
    }
    if (!state || state.status === 'ready') return
    const rows = await tx
      .select({
        workspaceId: workspaceCompanies.workspaceId,
        id: workspaceCompanies.id,
        revision: workspaceCompanies.revision,
      })
      .from(workspaceCompanies)
      .where(and(
        eq(workspaceCompanies.workspaceId, workspaceId),
        ne(workspaceCompanies.status, 'merged'),
        ...(state.afterCompanyId ? [gt(workspaceCompanies.id, state.afterCompanyId)] : []),
      ))
      .orderBy(asc(workspaceCompanies.id))
      .limit(SEED_BATCH + 1)
    const page = rows.slice(0, SEED_BATCH)
    for (const row of page) {
      await enqueueCompanyDuplicateReconsideration(tx, row, timestamp)
    }
    await tx.update(companyDuplicateIndexState).set({
      afterCompanyId: page.at(-1)?.id ?? state.afterCompanyId,
      status: rows.length <= SEED_BATCH ? 'ready' : 'indexing',
      updatedAt: timestamp,
    }).where(eq(companyDuplicateIndexState.workspaceId, workspaceId))
  })
}

async function processNextWork(
  database: PgliteDatabase,
  workspaceId: string,
  options: {
    readonly newId: UuidV7Generator
    readonly nowIso: () => string
  },
): Promise<boolean> {
  return database.transaction(async (tx) => {
    await lockCompanyWorkspace(tx, workspaceId)
    const [indexState] = await tx
      .select({ workspaceId: companyDuplicateIndexState.workspaceId })
      .from(companyDuplicateIndexState)
      .where(eq(companyDuplicateIndexState.workspaceId, workspaceId))
      .limit(1)
      .for('update')
    if (!indexState) return false
    const [work] = await tx
      .select()
      .from(companyDuplicateMaintenanceWork)
      .where(and(
        eq(companyDuplicateMaintenanceWork.workspaceId, workspaceId),
        or(
          eq(companyDuplicateMaintenanceWork.status, 'pending'),
          eq(companyDuplicateMaintenanceWork.status, 'processing'),
        ),
      ))
      .orderBy(
        asc(companyDuplicateMaintenanceWork.updatedAt),
        asc(companyDuplicateMaintenanceWork.companyId),
      )
      .limit(1)
      .for('update', { skipLocked: true })
    if (!work) return false
    const timestamp = options.nowIso()
    await tx.update(companyDuplicateMaintenanceWork).set({
      status: 'processing',
      updatedAt: timestamp,
    }).where(and(
      eq(companyDuplicateMaintenanceWork.workspaceId, workspaceId),
      eq(companyDuplicateMaintenanceWork.companyId, work.companyId),
    ))
    const subject = await duplicateInput(tx, workspaceId, work.companyId)
    if (!subject || subject.row.status !== 'active') {
      await completeWork(tx, work.companyId, workspaceId, subject?.row.revision ?? null, timestamp)
      return true
    }
    await reconcileSubject(tx, subject, options.newId, timestamp)
    await completeWork(tx, work.companyId, workspaceId, subject.row.revision, timestamp)
    return true
  })
}

async function reconcileSubject(
  tx: CompanyTx,
  subject: DuplicateInputRow,
  newId: UuidV7Generator,
  timestamp: string,
) {
  const existing = await tx
    .select()
    .from(companyDuplicateCandidates)
    .where(and(
      eq(companyDuplicateCandidates.workspaceId, subject.row.workspaceId),
      or(
        eq(companyDuplicateCandidates.lowerCompanyId, subject.row.id),
        eq(companyDuplicateCandidates.higherCompanyId, subject.row.id),
      ),
      ne(companyDuplicateCandidates.status, 'resolved_by_merge'),
    ))
    .limit(MAX_CANDIDATES_PER_COMPANY + 1)
  if (existing.length > MAX_CANDIDATES_PER_COMPANY) {
    throw new Error('Company duplicate candidate bound exceeded.')
  }
  const existingPartnerIds = new Set(existing.map((candidate) =>
    candidate.lowerCompanyId === subject.row.id
      ? candidate.higherCompanyId
      : candidate.lowerCompanyId))
  const signalPartnerIds = await signalCandidateIds(tx, subject)
  signalPartnerIds.delete(subject.row.id)
  const boundedPartnerIds = [
    ...[...existingPartnerIds].sort(),
    ...[...signalPartnerIds]
      .filter((companyId) => !existingPartnerIds.has(companyId))
      .sort(),
  ].slice(0, MAX_CANDIDATES_PER_COMPANY)
  const partners = await duplicateInputs(tx, subject.row.workspaceId, boundedPartnerIds)
  const existingByPair = new Map(existing.map((candidate) => [
    pairKey(candidate.lowerCompanyId, candidate.higherCompanyId),
    candidate,
  ]))
  for (const partner of partners) {
    if (partner.row.status !== 'active') continue
    const [lower, higher] = subject.row.id < partner.row.id
      ? [subject, partner]
      : [partner, subject]
    const current = existingByPair.get(pairKey(lower.row.id, higher.row.id))
    await reconcilePair(tx, lower, higher, current, newId, timestamp)
    existingByPair.delete(pairKey(lower.row.id, higher.row.id))
  }
  for (const stale of existingByPair.values()) {
    if (stale.status === 'open') {
      await tx.delete(companyDuplicateCandidates).where(and(
        eq(companyDuplicateCandidates.id, stale.id),
        eq(companyDuplicateCandidates.revision, stale.revision),
        eq(companyDuplicateCandidates.status, stale.status),
      ))
    }
  }
}

async function reconcilePair(
  tx: CompanyTx,
  lower: DuplicateInputRow,
  higher: DuplicateInputRow,
  current: CandidateRow | undefined,
  newId: UuidV7Generator,
  timestamp: string,
) {
  const score = scoreCompanyDuplicatePair(lower.input, higher.input)
  if (!score) {
    if (current?.status === 'open') {
      await tx.delete(companyDuplicateCandidates).where(and(
        eq(companyDuplicateCandidates.id, current.id),
        eq(companyDuplicateCandidates.revision, current.revision),
        eq(companyDuplicateCandidates.status, current.status),
      ))
    }
    return
  }
  const lowerFingerprint = companyDuplicateFingerprint(lower.input)
  const higherFingerprint = companyDuplicateFingerprint(higher.input)
  if (
    current?.status === 'marked_distinct'
    && current.lowerInputFingerprint === lowerFingerprint
    && current.higherInputFingerprint === higherFingerprint
  ) {
    return
  }
  const values = {
    score: score.score,
    reasonCodesJson: JSON.stringify(score.reasons.map((reason) => reason.code)),
    matcherVersion: COMPANY_DUPLICATE_MATCHER_VERSION,
    lowerInputFingerprint: lowerFingerprint,
    higherInputFingerprint: higherFingerprint,
    status: 'open',
    updatedAt: timestamp,
  }
  if (!current) {
    if (!await pairHasCapacity(
      tx,
      lower.row.workspaceId,
      lower.row.id,
      higher.row.id,
    )) {
      return
    }
    await tx.insert(companyDuplicateCandidates).values({
      id: newId(),
      workspaceId: lower.row.workspaceId,
      lowerCompanyId: lower.row.id,
      higherCompanyId: higher.row.id,
      revision: 1,
      createdAt: timestamp,
      ...values,
    }).onConflictDoNothing({
      target: [
        companyDuplicateCandidates.workspaceId,
        companyDuplicateCandidates.lowerCompanyId,
        companyDuplicateCandidates.higherCompanyId,
      ],
    })
    return
  }
  const unchanged = current.status === 'open'
    && current.score === values.score
    && current.reasonCodesJson === values.reasonCodesJson
    && current.matcherVersion === values.matcherVersion
    && current.lowerInputFingerprint === values.lowerInputFingerprint
    && current.higherInputFingerprint === values.higherInputFingerprint
  if (unchanged) return
  await tx.update(companyDuplicateCandidates).set({
    ...values,
    revision: current.revision + 1,
  }).where(and(
    eq(companyDuplicateCandidates.id, current.id),
    eq(companyDuplicateCandidates.revision, current.revision),
    eq(companyDuplicateCandidates.status, current.status),
  ))
}

async function pairHasCapacity(
  tx: CompanyTx,
  workspaceId: string,
  lowerCompanyId: string,
  higherCompanyId: string,
) {
  const rows = await tx
    .select({
      lowerCompanyId: companyDuplicateCandidates.lowerCompanyId,
      higherCompanyId: companyDuplicateCandidates.higherCompanyId,
    })
    .from(companyDuplicateCandidates)
    .where(and(
      eq(companyDuplicateCandidates.workspaceId, workspaceId),
      ne(companyDuplicateCandidates.status, 'resolved_by_merge'),
      or(
        inArray(companyDuplicateCandidates.lowerCompanyId, [
          lowerCompanyId,
          higherCompanyId,
        ]),
        inArray(companyDuplicateCandidates.higherCompanyId, [
          lowerCompanyId,
          higherCompanyId,
        ]),
      ),
    ))
    .limit((MAX_CANDIDATES_PER_COMPANY * 2) + 1)
  let lowerCount = 0
  let higherCount = 0
  for (const row of rows) {
    if (
      row.lowerCompanyId === lowerCompanyId
      || row.higherCompanyId === lowerCompanyId
    ) {
      lowerCount += 1
    }
    if (
      row.lowerCompanyId === higherCompanyId
      || row.higherCompanyId === higherCompanyId
    ) {
      higherCount += 1
    }
  }
  return lowerCount < MAX_CANDIDATES_PER_COMPANY
    && higherCount < MAX_CANDIDATES_PER_COMPANY
}

async function signalCandidateIds(
  tx: CompanyTx,
  subject: DuplicateInputRow,
): Promise<Set<string>> {
  const ids = new Set<string>()
  const prefixes = [subject.input.normalizedName, ...subject.input.normalizedAliases]
    .map((value) => value.slice(0, 3))
    .filter((value) => value.length > 0)
    .slice(0, 20)
  if (prefixes.length > 0) {
    const nameRows = await tx
      .select({ id: workspaceCompanies.id })
      .from(workspaceCompanies)
      .where(and(
        eq(workspaceCompanies.workspaceId, subject.row.workspaceId),
        eq(workspaceCompanies.status, 'active'),
        or(...prefixes.map((prefix) =>
          like(workspaceCompanies.normalizedDisplayName, `${prefix}%`))),
      ))
      .orderBy(asc(workspaceCompanies.normalizedDisplayName), asc(workspaceCompanies.id))
      .limit(SIGNAL_LIMIT)
    nameRows.forEach((row) => ids.add(row.id))
    const aliasRows = await tx
      .select({ companyId: companyAliases.companyId })
      .from(companyAliases)
      .where(and(
        eq(companyAliases.workspaceId, subject.row.workspaceId),
        isNull(companyAliases.removedAt),
        or(...prefixes.map((prefix) =>
          like(companyAliases.normalizedValue, `${prefix}%`))),
      ))
      .orderBy(asc(companyAliases.normalizedValue), asc(companyAliases.companyId))
      .limit(SIGNAL_LIMIT)
    aliasRows.forEach((row) => ids.add(row.companyId))
  }
  if (subject.row.websiteHost) {
    const domainRows = await tx
      .select({ id: workspaceCompanies.id })
      .from(workspaceCompanies)
      .where(and(
        eq(workspaceCompanies.workspaceId, subject.row.workspaceId),
        eq(workspaceCompanies.status, 'active'),
        eq(workspaceCompanies.websiteHost, subject.row.websiteHost),
      ))
      .orderBy(asc(workspaceCompanies.id))
      .limit(SIGNAL_LIMIT)
    domainRows.forEach((row) => ids.add(row.id))
  }
  return ids
}

interface DuplicateInputRow {
  readonly row: CompanyRow
  readonly input: CompanyDuplicateInput
}

async function duplicateInput(
  tx: CompanyTx,
  workspaceId: string,
  companyId: string,
): Promise<DuplicateInputRow | null> {
  const rows = await duplicateInputs(tx, workspaceId, [companyId])
  return rows[0] ?? null
}

async function duplicateInputs(
  tx: CompanyTx,
  workspaceId: string,
  companyIds: readonly string[],
): Promise<DuplicateInputRow[]> {
  if (companyIds.length === 0) return []
  const rows = await tx
    .select()
    .from(workspaceCompanies)
    .where(and(
      eq(workspaceCompanies.workspaceId, workspaceId),
      inArray(workspaceCompanies.id, [...companyIds]),
    ))
  const aliases = await tx
    .select({
      companyId: companyAliases.companyId,
      normalizedValue: companyAliases.normalizedValue,
    })
    .from(companyAliases)
    .where(and(
      eq(companyAliases.workspaceId, workspaceId),
      inArray(companyAliases.companyId, [...companyIds]),
      isNull(companyAliases.removedAt),
    ))
    .orderBy(asc(companyAliases.normalizedValue), asc(companyAliases.id))
  const aliasesByCompany = new Map<string, string[]>()
  for (const alias of aliases) {
    const values = aliasesByCompany.get(alias.companyId) ?? []
    values.push(alias.normalizedValue)
    aliasesByCompany.set(alias.companyId, values)
  }
  return rows.map((row) => ({
    row,
    input: {
      companyId: row.id,
      revision: row.revision,
      normalizedName: row.normalizedDisplayName,
      normalizedAliases: aliasesByCompany.get(row.id) ?? [],
      websiteHost: row.websiteHost,
    },
  }))
}

async function completeWork(
  tx: CompanyTx,
  companyId: string,
  workspaceId: string,
  processedRevision: number | null,
  timestamp: string,
) {
  await tx.update(companyDuplicateMaintenanceWork).set({
    processedRevision,
    status: 'idle',
    updatedAt: timestamp,
  }).where(and(
    eq(companyDuplicateMaintenanceWork.workspaceId, workspaceId),
    eq(companyDuplicateMaintenanceWork.companyId, companyId),
  ))
}

function pairKey(lowerCompanyId: string, higherCompanyId: string) {
  return `${lowerCompanyId}\0${higherCompanyId}`
}
