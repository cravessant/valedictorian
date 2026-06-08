import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, isNull, like, type SQL } from 'drizzle-orm'
import type {
  CreateSourcingFindingInput,
  PromoteSourcingFindingInput,
  SetSourcingFindingDecisionInput,
  SourcingFinding,
  SourcingFindingsListInput,
  SourcingFindingsListResult,
  SourcingMergeStatus,
  UpdateSourcingFindingInput,
} from 'sparxie'
import { isManualSourcingDecisionStatus, isSourcingMergeStatus } from 'sparxie'
import {
  applicationEvents,
  applicationLinks,
  applications,
  companies,
  sources,
  sourcingFindings,
  workflowRuns,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  canonicalizeApplicationUrl,
  isRoleKind,
  isWorkMode,
} from '../applications/application.types'
import { createSqliteApplicationRepository } from '../applications/application.repository'
import {
  evaluateSourcingCandidatePolicy,
  readPolicyConfig,
} from '../policy/policy.repository'
import { createSqliteScoringRepository } from '../scoring/scoring.repository'

const DEFAULT_FINDINGS_LIST_LIMIT = 50

const sourcingFindingSelection = {
  id: sourcingFindings.id,
  workflowRunId: sourcingFindings.workflowRunId,
  sourceId: sourcingFindings.sourceId,
  sourceName: sources.name,
  companyName: sourcingFindings.companyName,
  roleTitle: sourcingFindings.roleTitle,
  roleKind: sourcingFindings.roleKind,
  term: sourcingFindings.term,
  city: sourcingFindings.city,
  region: sourcingFindings.region,
  country: sourcingFindings.country,
  workMode: sourcingFindings.workMode,
  locationRaw: sourcingFindings.locationRaw,
  officialUrl: sourcingFindings.officialUrl,
  sourceUrl: sourcingFindings.sourceUrl,
  postedAge: sourcingFindings.postedAge,
  priorityScore: sourcingFindings.priorityScore,
  priorityBand: sourcingFindings.priorityBand,
  fitNotes: sourcingFindings.fitNotes,
  duplicateNotes: sourcingFindings.duplicateNotes,
  blocker: sourcingFindings.blocker,
  mergeStatus: sourcingFindings.mergeStatus,
  mergedApplicationId: sourcingFindings.mergedApplicationId,
  mergedApplicationCompanyName: companies.name,
  mergedApplicationRoleTitle: applications.roleTitle,
  mergeNotes: sourcingFindings.mergeNotes,
  discoveredAt: sourcingFindings.discoveredAt,
  createdAt: sourcingFindings.createdAt,
  updatedAt: sourcingFindings.updatedAt,
}

export function createSqliteSourcingRepository(database: DrizzleDatabase) {
  return {
    async createFinding(input: CreateSourcingFindingInput): Promise<SourcingFinding> {
      const now = new Date().toISOString()
      const normalizedInput = normalizeCreateFindingInput(input, now)

      return database.transaction((transaction) => {
        const run = transaction
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, normalizedInput.workflowRunId))
          .get()

        if (!run) {
          throw new Error(`Workflow run not found: ${normalizedInput.workflowRunId}`)
        }

        const source = resolveFindingSource(transaction, normalizedInput, run.sourceId, now)

        if (!source) {
          throw new Error('Sourcing finding requires a sourceName or a run source')
        }

        const findingId = randomUUID()

        transaction
          .insert(sourcingFindings)
          .values({
            id: findingId,
            workflowRunId: normalizedInput.workflowRunId,
            sourceId: source.id,
            companyName: normalizedInput.companyName,
            roleTitle: normalizedInput.roleTitle,
            roleKind: normalizedInput.roleKind,
            term: normalizedInput.term ?? null,
            city: normalizedInput.city ?? null,
            region: normalizedInput.region ?? null,
            country: normalizedInput.country,
            workMode: normalizedInput.workMode,
            locationRaw: normalizedInput.locationRaw ?? null,
            officialUrl: normalizedInput.officialUrl ?? null,
            sourceUrl: normalizedInput.sourceUrl ?? null,
            postedAge: normalizedInput.postedAge ?? null,
            priorityScore: normalizedInput.priorityScore ?? null,
            priorityBand: normalizedInput.priorityBand ?? null,
            fitNotes: normalizedInput.fitNotes ?? null,
            duplicateNotes: normalizedInput.duplicateNotes ?? null,
            blocker: normalizedInput.blocker ?? null,
            mergeStatus: normalizedInput.mergeStatus,
            mergedApplicationId: null,
            mergeNotes: null,
            discoveredAt: normalizedInput.discoveredAt,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .run()

        return reclassifySourcingFinding(transaction, findingId, now)
      })
    },
    async listFindings(
      input: SourcingFindingsListInput = {},
    ): Promise<SourcingFindingsListResult> {
      const limit = input.limit ?? DEFAULT_FINDINGS_LIST_LIMIT
      const offset = input.offset ?? 0
      const where = buildFindingsWhere(input)
      const totalRow = database
        .select({ value: count() })
        .from(sourcingFindings)
        .innerJoin(sources, eq(sourcingFindings.sourceId, sources.id))
        .where(where)
        .get()
      const rows = database
        .select(sourcingFindingSelection)
        .from(sourcingFindings)
        .innerJoin(sources, eq(sourcingFindings.sourceId, sources.id))
        .leftJoin(applications, eq(sourcingFindings.mergedApplicationId, applications.id))
        .leftJoin(companies, eq(applications.companyId, companies.id))
        .where(where)
        .orderBy(desc(sourcingFindings.discoveredAt))
        .limit(limit)
        .offset(offset)
        .all()
      const items = rows.map(mapSourcingFinding)
      const total = totalRow?.value ?? 0

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }
    },
    async updateFinding(input: UpdateSourcingFindingInput): Promise<SourcingFinding> {
      const now = new Date().toISOString()
      const patch: Partial<typeof sourcingFindings.$inferInsert> = {
        updatedAt: now,
      }

      if (input.sourceName !== undefined || input.sourceId !== undefined) {
        const current = selectSourcingFindingById(database, input.findingId)
        const source = resolveFindingSource(
          database,
          {
            sourceId:
              input.sourceId !== undefined
                ? input.sourceId
                  ? requiredTrimmedText(input.sourceId, 'sourceId')
                  : null
                : null,
            sourceName:
              input.sourceName !== undefined
                ? input.sourceName
                  ? requiredTrimmedText(input.sourceName, 'sourceName')
                  : null
                : null,
          },
          current.sourceId,
          now,
        )

        if (!source) {
          throw new Error('Sourcing finding requires a sourceName or a run source')
        }

        patch.sourceId = source.id
      }

      if (input.companyName !== undefined) {
        patch.companyName = requiredTrimmedText(input.companyName, 'companyName')
      }

      if (input.roleTitle !== undefined) {
        patch.roleTitle = requiredTrimmedText(input.roleTitle, 'roleTitle')
      }

      if (input.roleKind !== undefined) {
        if (!isRoleKind(input.roleKind)) {
          throw new Error(`Invalid roleKind: ${input.roleKind}`)
        }

        patch.roleKind = input.roleKind
      }

      if (input.term !== undefined) {
        patch.term = nullableTrimmedText(input.term)
      }

      if (input.city !== undefined) {
        patch.city = nullableTrimmedText(input.city)
      }

      if (input.region !== undefined) {
        patch.region = nullableTrimmedText(input.region)
      }

      if (input.country !== undefined) {
        patch.country = requiredTrimmedText(input.country, 'country')
      }

      if (input.workMode !== undefined) {
        if (!isWorkMode(input.workMode)) {
          throw new Error(`Invalid workMode: ${input.workMode}`)
        }

        patch.workMode = input.workMode
      }

      if (input.locationRaw !== undefined) {
        patch.locationRaw = nullableTrimmedText(input.locationRaw)
      }

      if (input.officialUrl !== undefined) {
        patch.officialUrl = input.officialUrl ? canonicalizeApplicationUrl(input.officialUrl) : null
      }

      if (input.sourceUrl !== undefined) {
        patch.sourceUrl = input.sourceUrl ? canonicalizeApplicationUrl(input.sourceUrl) : null
      }

      if (input.postedAge !== undefined) {
        patch.postedAge = nullableTrimmedText(input.postedAge)
      }

      if (input.priorityScore !== undefined) {
        patch.priorityScore = input.priorityScore
      }

      if (input.priorityBand !== undefined) {
        patch.priorityBand = nullableTrimmedText(input.priorityBand)
      }

      if (input.fitNotes !== undefined) {
        patch.fitNotes = nullableTrimmedText(input.fitNotes)
      }

      if (input.duplicateNotes !== undefined) {
        patch.duplicateNotes = nullableTrimmedText(input.duplicateNotes)
      }

      if (input.blocker !== undefined) {
        patch.blocker = nullableTrimmedText(input.blocker)
      }

      if (input.mergeStatus !== undefined) {
        if (!isSourcingMergeStatus(input.mergeStatus)) {
          throw new Error(`Invalid sourcing merge status: ${input.mergeStatus}`)
        }

        patch.mergeStatus = input.mergeStatus
      }

      if (input.mergeNotes !== undefined) {
        patch.mergeNotes = nullableTrimmedText(input.mergeNotes)
      }

      return database.transaction((transaction) => {
        transaction
          .update(sourcingFindings)
          .set(patch)
          .where(eq(sourcingFindings.id, input.findingId))
          .run()

        return reclassifySourcingFinding(transaction, input.findingId, now)
      })
    },
    async decideFinding(input: SetSourcingFindingDecisionInput): Promise<SourcingFinding> {
      if (!isManualSourcingDecisionStatus(input.mergeStatus)) {
        throw new Error(`Invalid manual sourcing decision: ${input.mergeStatus}`)
      }

      const now = new Date().toISOString()

      database
        .update(sourcingFindings)
        .set({
          blocker: null,
          duplicateNotes: null,
          mergeStatus: input.mergeStatus,
          mergedApplicationId: null,
          mergeNotes: input.mergeNotes === undefined ? null : nullableTrimmedText(input.mergeNotes),
          updatedAt: now,
        })
        .where(eq(sourcingFindings.id, input.findingId))
        .run()

      return selectSourcingFindingById(database, input.findingId)
    },
    async promoteFinding(input: PromoteSourcingFindingInput): Promise<SourcingFinding> {
      const now = new Date().toISOString()
      const finding = reclassifySourcingFinding(database, input.findingId, now)

      if (finding.mergeStatus !== 'new') {
        return finding
      }

      const duplicate = findDuplicateApplication(database, finding)

      if (duplicate) {
        database
          .update(sourcingFindings)
          .set({
            mergeStatus: 'duplicate',
            mergedApplicationId: duplicate.applicationId,
            duplicateNotes: duplicate.note,
            mergeNotes: duplicate.note,
            updatedAt: now,
          })
          .where(eq(sourcingFindings.id, finding.id))
          .run()

        return selectSourcingFindingById(database, finding.id)
      }

      const application = await createSqliteApplicationRepository(database).createApplication({
        companyName: finding.companyName,
        roleTitle: finding.roleTitle,
        sourceName: finding.sourceName,
        roleKind: finding.roleKind,
        term: finding.term,
        city: finding.city,
        region: finding.region,
        country: finding.country,
        workMode: finding.workMode,
        locationRaw: finding.locationRaw,
        status: 'queued',
        primaryLink: finding.officialUrl
          ? {
              kind: 'official',
              label: 'official',
              url: finding.officialUrl,
            }
          : undefined,
        sourceLink: finding.sourceUrl
          ? {
              kind: 'source',
              label: 'source',
              url: finding.sourceUrl,
            }
          : undefined,
        initialNote: finding.fitNotes ?? undefined,
      })

      if (finding.priorityScore !== null) {
        await createSqliteScoringRepository(database).recordScore({
          applicationId: application.id,
          score: finding.priorityScore,
          band: finding.priorityBand ?? priorityBandForScore(finding.priorityScore),
          roleRelevance: 0,
          careerSignal: 0,
          cityWorkMode: 0,
          compensationLogistics: 0,
          penalties: [],
          rationale: finding.fitNotes ?? 'Score imported from sourcing finding.',
          rubricVersion: 'sourcing-finding',
        })
      }

      database
        .insert(applicationEvents)
        .values({
          id: randomUUID(),
          applicationId: application.id,
          type: 'merged_from_sourcing_finding',
          message: 'Application merged from sourcing finding.',
          payloadJson: JSON.stringify({ findingId: finding.id }),
          actor: 'agent',
          createdAt: now,
        })
        .run()

      database
        .update(sourcingFindings)
        .set({
          mergeStatus: 'merged',
          mergedApplicationId: application.id,
          mergeNotes: 'Merged into application queue.',
          updatedAt: now,
        })
        .where(eq(sourcingFindings.id, finding.id))
        .run()

      return selectSourcingFindingById(database, finding.id)
    },
  }
}

function reclassifySourcingFinding(
  database: Pick<DrizzleDatabase, 'select' | 'update'>,
  findingId: string,
  now: string,
) {
  const finding = selectSourcingFindingById(database, findingId)

  if (finding.mergeStatus === 'merged') {
    return finding
  }

  const classification = classifySourcingFinding(database as DrizzleDatabase, finding)

  database
    .update(sourcingFindings)
    .set({
      blocker: classification.blocker,
      duplicateNotes: classification.duplicateNotes,
      mergeStatus: classification.mergeStatus,
      mergedApplicationId: classification.mergedApplicationId,
      mergeNotes: classification.mergeNotes,
      updatedAt: now,
    })
    .where(eq(sourcingFindings.id, findingId))
    .run()

  return selectSourcingFindingById(database, findingId)
}

function classifySourcingFinding(
  database: DrizzleDatabase,
  finding: SourcingFinding,
): Pick<
  typeof sourcingFindings.$inferInsert,
  'blocker' | 'duplicateNotes' | 'mergeStatus' | 'mergedApplicationId' | 'mergeNotes'
> {
  if (!finding.officialUrl && !finding.sourceUrl) {
    const note = 'Candidate requires an officialUrl or sourceUrl before promotion.'

    return {
      blocker: note,
      duplicateNotes: null,
      mergeStatus: 'blocked',
      mergedApplicationId: null,
      mergeNotes: note,
    }
  }

  const duplicate = findDuplicateApplication(database, finding)

  if (duplicate) {
    return {
      blocker: null,
      duplicateNotes: duplicate.note,
      mergeStatus: 'duplicate',
      mergedApplicationId: duplicate.applicationId,
      mergeNotes: duplicate.note,
    }
  }

  const policyDecision = evaluateSourcingCandidatePolicy(database, readPolicyConfig(database), {
    findingId: finding.id,
    companyName: finding.companyName,
    roleTitle: finding.roleTitle,
    officialUrl: finding.officialUrl,
    sourceUrl: finding.sourceUrl,
    priorityScore: finding.priorityScore,
  })

  if (policyDecision.status === 'skip') {
    return {
      blocker: null,
      duplicateNotes: null,
      mergeStatus: 'below_cutoff',
      mergedApplicationId: null,
      mergeNotes: policyDecision.reasons[0]?.message ?? 'Priority score is below policy cutoff.',
    }
  }

  if (policyDecision.status === 'needs_evidence') {
    const note = policyDecision.reasons[0]?.message ?? 'Candidate requires additional policy evidence.'

    return {
      blocker: note,
      duplicateNotes: null,
      mergeStatus: 'blocked',
      mergedApplicationId: null,
      mergeNotes: note,
    }
  }

  return {
    blocker: null,
    duplicateNotes: null,
    mergeStatus: 'new',
    mergedApplicationId: null,
    mergeNotes: null,
  }
}

function normalizeCreateFindingInput(input: CreateSourcingFindingInput, now: string) {
  if (!isRoleKind(input.roleKind)) {
    throw new Error(`Invalid roleKind: ${input.roleKind}`)
  }

  if (!isWorkMode(input.workMode)) {
    throw new Error(`Invalid workMode: ${input.workMode}`)
  }

  const mergeStatus = input.mergeStatus ?? 'new'

  if (!isSourcingMergeStatus(mergeStatus)) {
    throw new Error(`Invalid sourcing merge status: ${mergeStatus}`)
  }

  return {
    ...input,
    companyName: requiredTrimmedText(input.companyName, 'companyName'),
    roleTitle: requiredTrimmedText(input.roleTitle, 'roleTitle'),
    sourceId: input.sourceId ? requiredTrimmedText(input.sourceId, 'sourceId') : null,
    sourceName: input.sourceName ? requiredTrimmedText(input.sourceName, 'sourceName') : null,
    country: input.country ?? 'US',
    officialUrl: input.officialUrl ? canonicalizeApplicationUrl(input.officialUrl) : null,
    sourceUrl: input.sourceUrl ? canonicalizeApplicationUrl(input.sourceUrl) : null,
    mergeStatus,
    discoveredAt: input.discoveredAt ?? now,
  }
}

function buildFindingsWhere(input: SourcingFindingsListInput) {
  const filters: SQL[] = [isNull(sourcingFindings.deletedAt)]

  if (input.workflowRunId) {
    filters.push(eq(sourcingFindings.workflowRunId, input.workflowRunId))
  }

  if (input.mergeStatus) {
    filters.push(eq(sourcingFindings.mergeStatus, input.mergeStatus))
  }

  if (input.sourceId) {
    filters.push(eq(sourcingFindings.sourceId, input.sourceId))
  } else if (input.source) {
    filters.push(like(sources.name, `%${input.source}%`))
  }

  return and(...filters)
}

function selectSourcingFindingById(
  database: Pick<DrizzleDatabase, 'select'>,
  findingId: string,
) {
  const row = database
    .select(sourcingFindingSelection)
    .from(sourcingFindings)
    .innerJoin(sources, eq(sourcingFindings.sourceId, sources.id))
    .leftJoin(applications, eq(sourcingFindings.mergedApplicationId, applications.id))
    .leftJoin(companies, eq(applications.companyId, companies.id))
    .where(eq(sourcingFindings.id, findingId))
    .get()

  if (!row) {
    throw new Error(`Sourcing finding not found: ${findingId}`)
  }

  return mapSourcingFinding(row)
}

type SourcingFindingRow = Record<keyof typeof sourcingFindingSelection, unknown>

function mapSourcingFinding(row: SourcingFindingRow): SourcingFinding {
  return {
    id: row.id as string,
    workflowRunId: row.workflowRunId as string,
    sourceId: row.sourceId as string,
    sourceName: row.sourceName as string,
    companyName: row.companyName as string,
    roleTitle: row.roleTitle as string,
    roleKind: row.roleKind as SourcingFinding['roleKind'],
    term: row.term as string | null,
    city: row.city as string | null,
    region: row.region as string | null,
    country: row.country as string,
    workMode: row.workMode as SourcingFinding['workMode'],
    locationRaw: row.locationRaw as string | null,
    officialUrl: row.officialUrl as string | null,
    sourceUrl: row.sourceUrl as string | null,
    postedAge: row.postedAge as string | null,
    priorityScore: row.priorityScore as number | null,
    priorityBand: row.priorityBand as string | null,
    fitNotes: row.fitNotes as string | null,
    duplicateNotes: row.duplicateNotes as string | null,
    blocker: row.blocker as string | null,
    mergeStatus: row.mergeStatus as SourcingMergeStatus,
    mergedApplicationId: row.mergedApplicationId as string | null,
    mergedApplicationCompanyName: row.mergedApplicationCompanyName as string | null,
    mergedApplicationRoleTitle: row.mergedApplicationRoleTitle as string | null,
    mergeNotes: row.mergeNotes as string | null,
    discoveredAt: row.discoveredAt as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

export function findDuplicateApplication(database: DrizzleDatabase, finding: SourcingFinding) {
  if (finding.officialUrl) {
    const duplicate = database
      .select({ applicationId: applicationLinks.applicationId })
      .from(applicationLinks)
      .where(
        and(
          eq(applicationLinks.kind, 'official'),
          eq(applicationLinks.url, finding.officialUrl),
          isNull(applicationLinks.deletedAt),
        ),
      )
      .get()

    if (duplicate) {
      return {
        applicationId: duplicate.applicationId,
        note: 'Duplicate official URL matched an existing application.',
        reason: 'official_url' as const,
      }
    }
  }

  const normalizedCompanyName = normalizeText(finding.companyName)
  const normalizedRoleTitle = normalizeText(finding.roleTitle)

  if (finding.sourceUrl) {
    const sourceUrlDuplicate = database
      .select({
        applicationId: applications.id,
        normalizedCompanyName: companies.normalizedName,
        roleTitle: applications.roleTitle,
      })
      .from(applicationLinks)
      .innerJoin(applications, eq(applicationLinks.applicationId, applications.id))
      .innerJoin(companies, eq(applications.companyId, companies.id))
      .where(
        and(
          eq(applicationLinks.kind, 'source'),
          eq(applicationLinks.url, finding.sourceUrl),
          isNull(applicationLinks.deletedAt),
          isNull(applications.deletedAt),
        ),
      )
      .all()
      .find(
        (application) =>
          application.normalizedCompanyName === normalizedCompanyName &&
          normalizeText(application.roleTitle) === normalizedRoleTitle,
      )

    if (sourceUrlDuplicate) {
      return {
        applicationId: sourceUrlDuplicate.applicationId,
        note: 'Duplicate company, role, and source URL fingerprint matched an existing application.',
        reason: 'fingerprint' as const,
      }
    }
  }

  const sourceDuplicate = database
    .select({ applicationId: applications.id, roleTitle: applications.roleTitle })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(
      and(
        eq(companies.normalizedName, normalizedCompanyName),
        eq(applications.sourceId, finding.sourceId),
        isNull(applications.deletedAt),
      ),
    )
    .all()
    .find((application) => normalizeText(application.roleTitle) === normalizedRoleTitle)

  return sourceDuplicate
    ? {
        applicationId: sourceDuplicate.applicationId,
        note: 'Duplicate company, role, and source fingerprint matched an existing application.',
        reason: 'fingerprint' as const,
      }
    : null
}

function resolveFindingSource(
  database: Pick<DrizzleDatabase, 'insert' | 'select'>,
  input: { sourceId?: string | null; sourceName?: string | null },
  runSourceId: string | null,
  now: string,
) {
  if (input.sourceName) {
    return findOrCreateSource(database, input.sourceName, now)
  }

  const sourceId = input.sourceId ?? runSourceId

  return sourceId ? database.select().from(sources).where(eq(sources.id, sourceId)).get() : null
}

function findOrCreateSource(
  database: Pick<DrizzleDatabase, 'insert' | 'select'>,
  sourceName: string,
  now: string,
) {
  const normalizedName = sourceName.trim().toLowerCase()
  const existing = database
    .select()
    .from(sources)
    .where(eq(sources.name, sourceName.trim()))
    .get()

  if (existing) {
    return existing
  }

  const source = {
    id: `source-${normalizedName.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    name: sourceName.trim(),
    accountHint: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  database.insert(sources).values(source).run()

  return source
}

function priorityBandForScore(score: number) {
  if (score >= 7) {
    return 'high'
  }

  if (score >= 6) {
    return 'medium'
  }

  return 'skip'
}

function requiredTrimmedText(value: string, label: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${label} is required`)
  }

  return trimmed
}

function nullableTrimmedText(value: string | null) {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
