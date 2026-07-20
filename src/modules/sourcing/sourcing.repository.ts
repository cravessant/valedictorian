import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, ilike, isNull, type SQL } from 'drizzle-orm'
import type {
  CreateApplicationInput,
  CreateSourcingFindingInput,
  PromoteSourcingFindingInput,
  SetSourcingFindingDecisionInput,
  SourcingFinding,
  SourcingFindingsListInput,
  SourcingFindingsListResult,
  SourcingDestinationClass,
  SourcingMergeStatus,
  SourcingUsability,
  UpdateSourcingFindingInput,
} from 'sparxie'
import {
  isManualSourcingDecisionStatus,
  isSourcingMergeStatus,
  normalizeJobTimingInput,
  parseJobTermsJson,
  stringifyJobTerms,
} from 'sparxie'
import {
  applicationLinks,
  applications,
  companies,
  sources,
  opportunities,
  workflowRuns,
} from '../../db/schema'
import { insertOpportunities, updateOpportunities } from '../opportunity/opportunity.repository'
import { insertApplicationEvents } from '../applications/application.cross-writes'
import type { PgliteDatabase, PgliteRepositoryDatabase } from '../../db/pglite'
import {
  canonicalizeApplicationUrl,
  isRoleKind,
  isWorkMode,
  normalizeApplicationUrlPreservingQuery,
} from '../applications/application.types'
import { createPgliteApplicationRepository } from '../applications/application.repository'
import {
  evaluateSourcingCandidatePolicy,
  readPolicyConfig,
} from '../policy/policy.repository'
import { createPgliteScoringRepository } from '../scoring/scoring.repository'

const DEFAULT_FINDINGS_LIST_LIMIT = 50

const sourcingFindingSelection = {
  id: opportunities.id,
  rawRevisionId: opportunities.captureEvidenceVersionId,
  canonicalCandidateId: opportunities.jobFactVersionId,
  workflowRunId: opportunities.workflowRunId,
  sourceId: opportunities.sourceId,
  sourceName: sources.name,
  companyName: opportunities.companyName,
  roleTitle: opportunities.roleTitle,
  roleKind: opportunities.roleKind,
  term: opportunities.term,
  timingMode: opportunities.timingMode,
  termsJson: opportunities.termsJson,
  startDate: opportunities.startDate,
  endDate: opportunities.endDate,
  city: opportunities.city,
  region: opportunities.region,
  country: opportunities.country,
  workMode: opportunities.workMode,
  locationRaw: opportunities.locationRaw,
  employmentType: opportunities.employmentType,
  seniority: opportunities.seniority,
  locationJson: opportunities.locationJson,
  compensationJson: opportunities.compensationJson,
  postedAtJson: opportunities.postedAtJson,
  officialUrl: opportunities.officialUrl,
  sourceUrl: opportunities.sourceUrl,
  destinationClass: opportunities.destinationClass,
  destinationUrl: opportunities.destinationUrl,
  intermediaryUrl: opportunities.intermediaryUrl,
  usability: opportunities.usability,
  postedAge: opportunities.postedAge,
  priorityScore: opportunities.priorityScore,
  priorityBand: opportunities.priorityBand,
  fitNotes: opportunities.fitNotes,
  duplicateNotes: opportunities.duplicateNotes,
  blocker: opportunities.blocker,
  policyBlocker: opportunities.policyBlocker,
  dispositionReason: opportunities.dispositionReason,
  mergeStatus: opportunities.mergeStatus,
  mergedApplicationId: opportunities.applicationId,
  mergedApplicationCompanyName: companies.name,
  mergedApplicationRoleTitle: applications.roleTitle,
  mergeNotes: opportunities.mergeNotes,
  discoveredAt: opportunities.discoveredAt,
  createdAt: opportunities.createdAt,
  updatedAt: opportunities.updatedAt,
}

export function createPgliteSourcingRepository(database: PgliteRepositoryDatabase) {
  return {
    async createFinding(input: CreateSourcingFindingInput): Promise<SourcingFinding> {
      const now = new Date().toISOString()
      assertCompatibleSourcingDispositionInput(input)
      const normalizedInput = normalizeCreateFindingInput(input, now)

      return database.transaction(async (transaction) => {
        const [run] = await transaction
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, normalizedInput.workflowRunId))
          .limit(1)

        if (!run) {
          throw new Error(`Workflow run not found: ${normalizedInput.workflowRunId}`)
        }

        const source = await resolveFindingSource(transaction, normalizedInput, run.sourceId, now)

        if (!source) {
          throw new Error('Sourcing finding requires a sourceName or a run source')
        }

        const findingId = randomUUID()

        await insertOpportunities(transaction)
          .values({
            id: findingId,
            workflowRunId: normalizedInput.workflowRunId,
            sourceId: source.id,
            companyName: normalizedInput.companyName,
            roleTitle: normalizedInput.roleTitle,
            roleKind: normalizedInput.roleKind,
            term: normalizedInput.term ?? null,
            timingMode: normalizedInput.timingMode,
            termsJson: stringifyJobTerms(normalizedInput.terms),
            startDate: normalizedInput.startDate,
            endDate: normalizedInput.endDate,
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
            policyBlocker: normalizedInput.policyBlocker ?? null,
            dispositionReason: normalizedInput.dispositionReason ?? null,
            mergeStatus: normalizedInput.mergeStatus,
            applicationId: null,
            mergeNotes: null,
            discoveredAt: normalizedInput.discoveredAt,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })

        return reclassifySourcingFinding(transaction, findingId, now)
      })
    },
    async getFinding(findingId: string): Promise<SourcingFinding> {
      return selectSourcingFindingById(database, findingId)
    },
    async listFindings(
      input: SourcingFindingsListInput = {},
    ): Promise<SourcingFindingsListResult> {
      const limit = input.limit ?? DEFAULT_FINDINGS_LIST_LIMIT
      const offset = input.offset ?? 0
      const where = buildFindingsWhere(input)
      const [totalRow] = await database
        .select({ value: count() })
        .from(opportunities)
        .innerJoin(sources, eq(opportunities.sourceId, sources.id))
        .where(where)
      const rows = await database
        .select(sourcingFindingSelection)
        .from(opportunities)
        .innerJoin(sources, eq(opportunities.sourceId, sources.id))
        .leftJoin(applications, eq(opportunities.applicationId, applications.id))
        .leftJoin(companies, eq(applications.companyId, companies.id))
        .where(where)
        .orderBy(desc(opportunities.discoveredAt), asc(opportunities.id))
        .limit(limit)
        .offset(offset)
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
      assertCompatibleSourcingDispositionInput(input)
      const patch: Partial<typeof opportunities.$inferInsert> = {
        updatedAt: now,
      }

      if (input.sourceName !== undefined || input.sourceId !== undefined) {
        const current = await selectSourcingFindingById(database, input.findingId)
        const source = await resolveFindingSource(
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
          throw new Error(`Invalid roleKind: ${String(input.roleKind)}`)
        }

        patch.roleKind = input.roleKind
      }

      if (hasSourcingTimingPatch(input)) {
        const timing = normalizeJobTimingInput(input)
        patch.term = timing.term
        patch.timingMode = timing.timingMode
        patch.termsJson = stringifyJobTerms(timing.terms)
        patch.startDate = timing.startDate
        patch.endDate = timing.endDate
      }

      if (input.city !== undefined) {
        patch.city = nullableTrimmedText(input.city)
      }

      if (input.region !== undefined) {
        patch.region = nullableTrimmedText(input.region)
      }

      if (input.country !== undefined) {
        patch.country = nullableTrimmedText(input.country)
      }

      if (input.workMode !== undefined) {
        if (!isWorkMode(input.workMode)) {
          throw new Error(`Invalid workMode: ${String(input.workMode)}`)
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
        patch.sourceUrl = input.sourceUrl
          ? normalizeApplicationUrlPreservingQuery(input.sourceUrl)
          : null
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

      if (input.policyBlocker !== undefined) {
        patch.policyBlocker = nullableTrimmedText(input.policyBlocker)
      }

      if (input.dispositionReason !== undefined) {
        patch.dispositionReason = nullableTrimmedText(input.dispositionReason)
      }

      if (input.mergeStatus !== undefined) {
        if (!isSourcingMergeStatus(input.mergeStatus)) {
          throw new Error(`Invalid sourcing merge status: ${String(input.mergeStatus)}`)
        }

        assertPromotionOnlyMergeStatus(input.mergeStatus)
        patch.mergeStatus = input.mergeStatus
      }

      if (input.mergeNotes !== undefined) {
        patch.mergeNotes = nullableTrimmedText(input.mergeNotes)
      }

      return database.transaction(async (transaction) => {
        await updateOpportunities(transaction)
          .set(patch)
          .where(eq(opportunities.id, input.findingId))

        return reclassifySourcingFinding(transaction, input.findingId, now)
      })
    },
    async decideFinding(input: SetSourcingFindingDecisionInput): Promise<SourcingFinding> {
      if (!isManualSourcingDecisionStatus(input.mergeStatus)) {
        throw new Error(`Invalid manual sourcing decision: ${String(input.mergeStatus)}`)
      }

      const now = new Date().toISOString()

      const [changed] = await updateOpportunities(database)
        .set({
          blocker: null,
          duplicateNotes: null,
          policyBlocker: input.policyBlocker === undefined ? null : nullableTrimmedText(input.policyBlocker),
          dispositionReason:
            input.dispositionReason === undefined
              ? input.mergeNotes === undefined
                ? null
                : nullableTrimmedText(input.mergeNotes)
              : nullableTrimmedText(input.dispositionReason),
          mergeStatus: input.mergeStatus,
          applicationId: null,
          mergeNotes: input.mergeNotes === undefined ? null : nullableTrimmedText(input.mergeNotes),
          updatedAt: now,
        })
        .where(eq(opportunities.id, input.findingId))
        .returning({ id: opportunities.id })

      if (!changed) {
        throw new Error(`Sourcing finding not found: ${input.findingId}`)
      }

      return selectSourcingFindingById(database, input.findingId)
    },
    async promoteFinding(input: PromoteSourcingFindingInput): Promise<SourcingFinding> {
      const now = new Date().toISOString()
      const finding = await reclassifySourcingFinding(database, input.findingId, now)
      const approvesThirdPartyDestination =
        finding.mergeStatus === 'blocked' &&
        finding.policyBlocker === 'third_party_destination' &&
        finding.destinationClass === 'third_party_job_posting' &&
        Boolean(finding.destinationUrl) &&
        hasText(finding.blocker) &&
        !hasText(finding.dispositionReason)

      if (finding.mergeStatus !== 'new' && !approvesThirdPartyDestination) {
        return finding
      }
      if (!finding.country) {
        throw new Error('Sourcing policy requires a country before promotion.')
      }

      const duplicate = await findDuplicateApplication(database, finding)

      if (duplicate) {
        await updateOpportunities(database)
          .set({
            mergeStatus: 'duplicate',
            applicationId: duplicate.applicationId,
            duplicateNotes: duplicate.note,
            mergeNotes: duplicate.note,
            updatedAt: now,
          })
          .where(eq(opportunities.id, finding.id))

        return selectSourcingFindingById(database, finding.id)
      }

      const application = await createPgliteApplicationRepository(database).createApplication({
        companyName: finding.companyName,
        roleTitle: finding.roleTitle,
        sourceName: finding.sourceName,
        roleKind: finding.roleKind,
        ...applicationTimingInputForFinding(finding),
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
        await createPgliteScoringRepository(database).recordScore({
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

      await insertApplicationEvents(database)
        .values({
          id: randomUUID(),
          applicationId: application.id,
          type: 'merged_from_sourcing_finding',
          message: 'Application merged from sourcing finding.',
          payloadJson: JSON.stringify({ findingId: finding.id }),
          actor: 'agent',
          createdAt: now,
        })

      await updateOpportunities(database)
        .set({
          mergeStatus: 'merged',
          applicationId: application.id,
          mergeNotes: 'Merged into applications.',
          updatedAt: now,
        })
        .where(eq(opportunities.id, finding.id))

      return selectSourcingFindingById(database, finding.id)
    },
  }
}

function applicationTimingInputForFinding(
  finding: SourcingFinding,
): Pick<CreateApplicationInput, 'endDate' | 'startDate' | 'term' | 'terms' | 'timingMode'> {
  if (finding.timingMode === 'dates') {
    return {
      timingMode: 'dates',
      startDate: finding.startDate,
      endDate: finding.endDate,
    }
  }

  if (finding.timingMode === 'terms') {
    return {
      timingMode: 'terms',
      terms: finding.terms,
    }
  }

  return {
    timingMode: 'unknown',
    term: finding.term,
  }
}

async function reclassifySourcingFinding(
  database: Pick<PgliteDatabase, 'select' | 'update'>,
  findingId: string,
  now: string,
) {
  const finding = await selectSourcingFindingById(database, findingId)

  if (finding.mergeStatus === 'merged' || isManualDispositionFinding(finding)) {
    return finding
  }

  const classification = await classifySourcingFinding(database as PgliteDatabase, finding)

  await updateOpportunities(database)
    .set({
      blocker: classification.blocker,
      duplicateNotes: classification.duplicateNotes,
      policyBlocker: classification.policyBlocker,
      mergeStatus: classification.mergeStatus,
      applicationId: classification.applicationId,
      mergeNotes: classification.mergeNotes,
      updatedAt: now,
    })
    .where(eq(opportunities.id, findingId))

  return selectSourcingFindingById(database, findingId)
}

async function classifySourcingFinding(
  database: PgliteDatabase,
  finding: SourcingFinding,
): Promise<Pick<
  typeof opportunities.$inferInsert,
  | 'blocker'
  | 'duplicateNotes'
  | 'policyBlocker'
  | 'mergeStatus'
  | 'applicationId'
  | 'mergeNotes'
>> {
  if (!finding.officialUrl && !finding.sourceUrl) {
    const note = 'Candidate requires an officialUrl or sourceUrl before promotion.'

    return {
      blocker: note,
      duplicateNotes: null,
      policyBlocker: null,
      mergeStatus: 'blocked',
      applicationId: null,
      mergeNotes: note,
    }
  }

  const duplicate = await findDuplicateApplication(database, finding)

  if (duplicate) {
    return {
      blocker: null,
      duplicateNotes: duplicate.note,
      policyBlocker: null,
      mergeStatus: 'duplicate',
      applicationId: duplicate.applicationId,
      mergeNotes: duplicate.note,
    }
  }

  if (!finding.country) {
    const note = 'What country is this role located in? Provide a country before adding it to the application queue.'

    return {
      blocker: note,
      duplicateNotes: null,
      policyBlocker: 'missing_country',
      mergeStatus: 'blocked',
      applicationId: null,
      mergeNotes: note,
    }
  }

  const policyDecision = await evaluateSourcingCandidatePolicy(database, await readPolicyConfig(database), {
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
      policyBlocker: null,
      mergeStatus: 'below_cutoff',
      applicationId: null,
      mergeNotes: policyDecision.reasons[0]?.message ?? 'Priority score is below policy cutoff.',
    }
  }

  if (policyDecision.status === 'needs_evidence') {
    const note = policyDecision.reasons[0]?.message ?? 'Candidate requires additional policy evidence.'

    return {
      blocker: note,
      duplicateNotes: null,
      policyBlocker: note,
      mergeStatus: 'blocked',
      applicationId: null,
      mergeNotes: note,
    }
  }

  if (finding.destinationClass === 'third_party_job_posting' && finding.destinationUrl) {
    const note = `Approve or reject this third-party job destination before promotion: ${finding.destinationUrl}`

    return {
      blocker: note,
      duplicateNotes: null,
      policyBlocker: 'third_party_destination',
      mergeStatus: 'blocked',
      applicationId: null,
      mergeNotes: note,
    }
  }

  return {
    blocker: null,
    duplicateNotes: null,
    policyBlocker: null,
    mergeStatus: 'new',
    applicationId: null,
    mergeNotes: null,
  }
}

function isManualDispositionFinding(finding: SourcingFinding) {
  if (finding.mergeStatus === 'not_fit' || finding.mergeStatus === 'not_pursued' || finding.mergeStatus === 'archived') {
    return true
  }

  return finding.mergeStatus === 'blocked' && (
    hasText(finding.dispositionReason) || finding.policyBlocker === 'possible_match'
  )
}

function assertCompatibleSourcingDispositionInput(input: {
  blocker?: string | null
  dispositionReason?: string | null
  duplicateNotes?: string | null
  mergeStatus?: string
  policyBlocker?: string | null
}) {
  if (input.duplicateNotes !== undefined) {
    throw new Error(
      'duplicateNotes is generated by duplicate detection; use dispositionReason or mergeNotes for manual notes.',
    )
  }

  if (input.blocker !== undefined && input.mergeStatus !== 'blocked') {
    throw new Error('blocker requires mergeStatus blocked.')
  }

  if (input.policyBlocker !== undefined && input.mergeStatus !== 'blocked') {
    throw new Error('policyBlocker requires mergeStatus blocked.')
  }

  if (
    input.dispositionReason !== undefined &&
    (input.mergeStatus === undefined || !isManualSourcingDecisionStatus(input.mergeStatus))
  ) {
    throw new Error('dispositionReason requires a manual mergeStatus.')
  }
}

function normalizeCreateFindingInput(input: CreateSourcingFindingInput, now: string) {
  if (!isRoleKind(input.roleKind)) {
    throw new Error(`Invalid roleKind: ${String(input.roleKind)}`)
  }

  if (!isWorkMode(input.workMode)) {
    throw new Error(`Invalid workMode: ${String(input.workMode)}`)
  }

  const mergeStatus = input.mergeStatus ?? 'new'

  if (!isSourcingMergeStatus(mergeStatus)) {
    throw new Error(`Invalid sourcing merge status: ${String(mergeStatus)}`)
  }

  assertPromotionOnlyMergeStatus(mergeStatus)

  return {
    ...input,
    companyName: requiredTrimmedText(input.companyName, 'companyName'),
    roleTitle: requiredTrimmedText(input.roleTitle, 'roleTitle'),
    ...normalizeJobTimingInput(input),
    sourceId: input.sourceId ? requiredTrimmedText(input.sourceId, 'sourceId') : null,
    sourceName: input.sourceName ? requiredTrimmedText(input.sourceName, 'sourceName') : null,
    country: input.country === undefined ? null : nullableTrimmedText(input.country),
    officialUrl: input.officialUrl ? canonicalizeApplicationUrl(input.officialUrl) : null,
    sourceUrl: input.sourceUrl ? normalizeApplicationUrlPreservingQuery(input.sourceUrl) : null,
    mergeStatus,
    discoveredAt: input.discoveredAt ?? now,
  }
}

function hasSourcingTimingPatch(input: UpdateSourcingFindingInput) {
  return (
    'term' in input ||
    'terms' in input ||
    'timingMode' in input ||
    'startDate' in input ||
    'endDate' in input
  )
}

function assertPromotionOnlyMergeStatus(mergeStatus: SourcingMergeStatus) {
  if (mergeStatus === 'merged') {
    throw new Error('Sourcing findings can only be marked merged by promotion.')
  }
}

function buildFindingsWhere(input: SourcingFindingsListInput) {
  const filters: SQL[] = [isNull(opportunities.deletedAt)]

  if (input.workflowRunId) {
    filters.push(eq(opportunities.workflowRunId, input.workflowRunId))
  }

  if (input.mergeStatus) {
    filters.push(eq(opportunities.mergeStatus, input.mergeStatus))
  }

  if (input.sourceId) {
    filters.push(eq(opportunities.sourceId, input.sourceId))
  } else if (input.source) {
    filters.push(ilike(sources.name, `%${input.source}%`))
  }

  if (input.destinationClass) {
    filters.push(eq(opportunities.destinationClass, input.destinationClass))
  }

  if (input.usability) {
    filters.push(eq(opportunities.usability, input.usability))
  }

  return and(...filters)
}

async function selectSourcingFindingById(
  database: Pick<PgliteDatabase, 'select'>,
  findingId: string,
) {
  const [row] = await database
    .select(sourcingFindingSelection)
    .from(opportunities)
    .innerJoin(sources, eq(opportunities.sourceId, sources.id))
    .leftJoin(applications, eq(opportunities.applicationId, applications.id))
    .leftJoin(companies, eq(applications.companyId, companies.id))
    .where(eq(opportunities.id, findingId))
    .limit(1)

  if (!row) {
    throw new Error(`Sourcing finding not found: ${findingId}`)
  }

  return mapSourcingFinding(row)
}

type SourcingFindingRow = Record<keyof typeof sourcingFindingSelection, unknown>

function mapSourcingFinding(row: SourcingFindingRow): SourcingFinding {
  const canonicalProjection = row.canonicalCandidateId && row.rawRevisionId
    ? {
        rawRevisionId: row.rawRevisionId as string,
        canonicalCandidateId: row.canonicalCandidateId as string,
        destination: row.destinationClass && row.destinationUrl
          ? {
              class: row.destinationClass as SourcingDestinationClass,
              url: row.destinationUrl as string,
              ...(row.intermediaryUrl ? { intermediaryUrl: row.intermediaryUrl as string } : {}),
            }
          : null,
        employmentType: row.employmentType as NonNullable<SourcingFinding['employmentType']>,
        seniority: row.seniority as NonNullable<SourcingFinding['seniority']>,
        location: row.locationJson ? JSON.parse(row.locationJson as string) : null,
        compensation: row.compensationJson ? JSON.parse(row.compensationJson as string) : null,
        postedAt: JSON.parse(row.postedAtJson as string),
      }
    : {}

  return {
    id: row.id as string,
    workflowRunId: row.workflowRunId as string,
    sourceId: row.sourceId as string,
    sourceName: row.sourceName as string,
    companyName: row.companyName as string,
    roleTitle: row.roleTitle as string,
    roleKind: row.roleKind as SourcingFinding['roleKind'],
    term: row.term as string | null,
    terms: parseJobTermsJson(row.termsJson as string),
    timingMode: row.timingMode as SourcingFinding['timingMode'],
    startDate: row.startDate as string | null,
    endDate: row.endDate as string | null,
    city: row.city as string | null,
    region: row.region as string | null,
    country: row.country as string | null,
    workMode: row.workMode as SourcingFinding['workMode'],
    locationRaw: row.locationRaw as string | null,
    officialUrl: row.officialUrl as string | null,
    sourceUrl: row.sourceUrl as string | null,
    destinationClass: row.destinationClass as SourcingDestinationClass | null,
    destinationUrl: row.destinationUrl as string | null,
    intermediaryUrl: row.intermediaryUrl as string | null,
    ...(row.usability === 'usable' || row.usability === 'review_only'
      ? { usability: row.usability as SourcingUsability }
      : {}),
    postedAge: row.postedAge as string | null,
    priorityScore: row.priorityScore as number | null,
    priorityBand: row.priorityBand as string | null,
    fitNotes: row.fitNotes as string | null,
    duplicateNotes: row.duplicateNotes as string | null,
    blocker: row.blocker as string | null,
    policyBlocker: row.policyBlocker as string | null,
    dispositionReason: row.dispositionReason as string | null,
    mergeStatus: row.mergeStatus as SourcingMergeStatus,
    mergedApplicationId: row.mergedApplicationId as string | null,
    mergedApplicationCompanyName: row.mergedApplicationCompanyName as string | null,
    mergedApplicationRoleTitle: row.mergedApplicationRoleTitle as string | null,
    mergeNotes: row.mergeNotes as string | null,
    discoveredAt: row.discoveredAt as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    ...canonicalProjection,
  }
}

export async function findDuplicateApplication(
  database: Pick<PgliteRepositoryDatabase, 'select'>,
  finding: SourcingFinding,
) {
  if (finding.officialUrl) {
    const [duplicate] = await database
      .select({ applicationId: applicationLinks.applicationId })
      .from(applicationLinks)
      .where(
        and(
          eq(applicationLinks.kind, 'official'),
          eq(applicationLinks.url, finding.officialUrl),
          isNull(applicationLinks.deletedAt),
        ),
      )
      .limit(1)

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
    const sourceUrlDuplicate = (await database
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
      ))
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

  const sourceDuplicate = (await database
    .select({ applicationId: applications.id, roleTitle: applications.roleTitle })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(
      and(
        eq(companies.normalizedName, normalizedCompanyName),
        eq(applications.sourceId, finding.sourceId),
        isNull(applications.deletedAt),
      ),
    ))
    .find((application) => normalizeText(application.roleTitle) === normalizedRoleTitle)

  return sourceDuplicate
    ? {
        applicationId: sourceDuplicate.applicationId,
        note: 'Duplicate company, role, and source fingerprint matched an existing application.',
        reason: 'fingerprint' as const,
      }
    : null
}

async function resolveFindingSource(
  database: Pick<PgliteDatabase, 'insert' | 'select'>,
  input: { sourceId?: string | null; sourceName?: string | null },
  runSourceId: string | null,
  now: string,
) {
  if (input.sourceName) {
    return findOrCreateSource(database, input.sourceName, now)
  }

  const sourceId = input.sourceId ?? runSourceId

  if (!sourceId) return null
  const [source] = await database.select().from(sources).where(eq(sources.id, sourceId)).limit(1)
  return source ?? null
}

async function findOrCreateSource(
  database: Pick<PgliteDatabase, 'insert' | 'select'>,
  sourceName: string,
  now: string,
) {
  const normalizedName = sourceName.trim().toLowerCase()
  const [existing] = await database
    .select()
    .from(sources)
    .where(eq(sources.name, sourceName.trim()))
    .limit(1)

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

  await database.insert(sources).values(source)
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

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
