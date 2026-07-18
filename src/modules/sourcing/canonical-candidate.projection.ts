import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { CanonicalSourceCandidate, RoleKind } from 'sparxie'
import {
  applicationLinks,
  jobFactVersions,
  normalizationGates,
  normalizationRuns,
  captureEvidenceVersions,
  sources,
  opportunities,
  workflowRuns,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

export const SOURCING_PROJECTION_POLICY_VERSION = 'canonical-sourcing-policy/v1'

export function createCanonicalCandidateProjectionService(
  now: () => Date = () => new Date(),
) {
  const projectPersisted = async (
    transaction: Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0],
    candidateId: string,
    rawRevisionId: string,
  ) => {
        const [persisted] = await transaction
          .select({
            candidateJson: jobFactVersions.jobFactVersionJson,
            candidateId: jobFactVersions.id,
            gateCandidateId: normalizationGates.jobFactVersionId,
            gateStatus: normalizationGates.status,
            adapterId: captureEvidenceVersions.adapterId,
            adapterKind: captureEvidenceVersions.adapterKind,
            adapterVersion: captureEvidenceVersions.adapterVersion,
            reportedOriginName: captureEvidenceVersions.reportedOriginName,
            rawRevisionId: captureEvidenceVersions.id,
            rawRecordId: captureEvidenceVersions.captureLineageId,
            revision: captureEvidenceVersions.revision,
            observedAt: captureEvidenceVersions.observedAt,
            runStatus: normalizationRuns.status,
          })
          .from(jobFactVersions)
          .innerJoin(normalizationRuns, eq(jobFactVersions.runId, normalizationRuns.id))
          .innerJoin(normalizationGates, eq(normalizationGates.runId, normalizationRuns.id))
          .innerJoin(captureEvidenceVersions, eq(captureEvidenceVersions.id, jobFactVersions.captureEvidenceVersionId))
          .where(and(
            eq(jobFactVersions.id, candidateId),
            eq(jobFactVersions.captureEvidenceVersionId, rawRevisionId),
          ))
          .limit(1)

        if (
          !persisted ||
          persisted.gateStatus !== 'passed' ||
          persisted.gateCandidateId !== persisted.candidateId ||
          persisted.runStatus !== 'completed'
        ) {
          return null
        }

        const candidate = JSON.parse(persisted.candidateJson) as CanonicalSourceCandidate
        if (!candidate.destination) return null
        const timestamp = now().toISOString()
        const identityKeys = sourcingProjectionIdentityKeys(candidate)
        const identityKey = identityKeys[0]
        const sourceName = persisted.reportedOriginName?.trim() || persisted.adapterId
        const identityMatches = (await transaction
          .select()
          .from(opportunities)
          .orderBy(asc(opportunities.id)))
          .filter((finding) => {
            const aliases = parseProjectionAliases(finding.projectionAliasesJson)
            return identityKeys.some((key) =>
              finding.projectionIdentityKey === key || aliases.includes(key))
          })
        const matchedFindingIds = [...new Set(identityMatches.map(({ id }) => id))]
        if (matchedFindingIds.length > 1) {
          throw new Error(`Conflicting sourcing findings own canonical identities: ${matchedFindingIds.join(', ')}`)
        }
        const existing = identityMatches[0]
        const projectionAliasesJson = JSON.stringify([
          ...new Set([
            ...(existing ? parseProjectionAliases(existing.projectionAliasesJson) : []),
            ...(existing?.projectionIdentityKey ? [existing.projectionIdentityKey] : []),
            ...identityKeys,
          ]),
        ].sort())
        if (existing?.captureEvidenceVersionId) {
          const [currentRevision] = await transaction.select({
            id: captureEvidenceVersions.id,
            rawRecordId: captureEvidenceVersions.captureLineageId,
            revision: captureEvidenceVersions.revision,
            observedAt: captureEvidenceVersions.observedAt,
          })
            .from(captureEvidenceVersions)
            .where(eq(captureEvidenceVersions.id, existing.captureEvidenceVersionId))
            .limit(1)
          if (currentRevision && !isNewerSourceRevision(persisted, currentRevision)) {
            const [updated] = await transaction.update(opportunities).set({ projectionAliasesJson })
              .where(eq(opportunities.id, existing.id))
              .returning({ id: opportunities.id })
            if (!updated) throw new Error(`Sourcing finding not found: ${existing.id}`)
            return existing.id
          }
        }
        let [source] = await transaction
          .select()
          .from(sources)
          .where(eq(sources.name, sourceName))
          .orderBy(asc(sources.id))
          .limit(1)
        if (!source) {
          const sourceValues = {
            id: randomUUID(),
            name: sourceName,
            accountHint: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          }
          const [insertedSource] = await transaction.insert(sources).values(sourceValues).returning()
          if (!insertedSource) throw new Error('Canonical sourcing source was not created')
          source = insertedSource
        }
        let workflowRunId = existing?.workflowRunId
        if (!workflowRunId) {
          workflowRunId = randomUUID()
          const [workflowRun] = await transaction.insert(workflowRuns).values({
            id: workflowRunId,
            runType: 'sourcing',
            status: 'completed',
            actorType: 'system',
            actorName: 'canonical-sourcing-policy',
            sourceId: source.id,
            subjectApplicationId: null,
            startedAt: timestamp,
            completedAt: timestamp,
            coverageStartedAt: null,
            coverageEndedAt: null,
            timezone: null,
            inputJson: JSON.stringify({
              canonicalCandidateId: candidate.id,
              rawRevisionId: candidate.rawRevisionId,
            }),
            summary: `Projected canonical candidate ${candidate.id}.`,
            outcome: 'projected',
            blocker: null,
            metadataJson: JSON.stringify({ policyVersion: SOURCING_PROJECTION_POLICY_VERSION }),
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          }).returning({ id: workflowRuns.id })
          workflowRunId = workflowRun?.id
          if (!workflowRunId) throw new Error('Canonical sourcing workflow run was not created')
        }

        const destination = candidate.destination
        const roleKind = canonicalRoleKind(candidate)
        const roleFit = roleKind === 'internship'
        const strongApplicationDuplicate = roleFit && destination.class === 'employer_or_ats'
          ? (await transaction.select({ applicationId: applicationLinks.applicationId })
              .from(applicationLinks)
              .where(and(
                eq(applicationLinks.kind, 'official'),
                eq(applicationLinks.url, destination.url),
                isNull(applicationLinks.deletedAt),
              ))
              .orderBy(asc(applicationLinks.applicationId))
              .limit(1))[0]
          : null
        const officialUrl = destination.class === 'employer_or_ats' ? destination.url : null
        const sourceUrl = destination.class === 'third_party_job_posting'
          ? destination.url
          : candidate.sourceUrl
        const possibleMatch = !roleFit || strongApplicationDuplicate ? null : (await transaction
          .select({
            id: opportunities.id,
            companyName: opportunities.companyName,
            roleTitle: opportunities.roleTitle,
            locationRaw: opportunities.locationRaw,
            postedAtJson: opportunities.postedAtJson,
          })
          .from(opportunities)
          .where(isNull(opportunities.deletedAt))
          .orderBy(asc(opportunities.id)))
          .find((finding) => finding.id !== existing?.id && weakCandidateFactsMatch(finding, candidate))
        const possibleMatchQuestion = possibleMatch
          ? `Possible match with sourcing finding ${possibleMatch.id}: are these the same job? Approve a merge or reject the match.`
          : null
        const missingCountryQuestion = roleFit && !strongApplicationDuplicate && !possibleMatch && !candidate.location?.country
          ? 'What country is this role located in? Provide a country before adding it to the application queue.'
          : null
        const thirdPartyQuestion = roleFit && !strongApplicationDuplicate && !possibleMatch && !missingCountryQuestion && destination.class === 'third_party_job_posting'
          ? `Approve or reject this third-party job destination before promotion: ${destination.url}`
          : null
        const notFitReason = roleFit
          ? null
          : 'Role does not match the current internship sourcing profile.'
        const duplicateReason = strongApplicationDuplicate
          ? 'Duplicate official destination matched an existing application.'
          : null
        const preservesSourcingDecision = existing && (
          existing.mergeStatus === 'merged' ||
          existing.mergeStatus === 'not_pursued' ||
          existing.mergeStatus === 'archived' ||
          (existing.mergeStatus === 'not_fit' && existing.policyBlocker !== 'role_not_fit') ||
          (existing.mergeStatus === 'blocked' && Boolean(existing.dispositionReason))
        )
        const preservesCutoff = existing?.mergeStatus === 'below_cutoff'
        const policyMergeStatus = notFitReason
          ? 'not_fit'
          : duplicateReason
            ? 'duplicate'
            : possibleMatch
              ? 'blocked'
              : preservesCutoff
                ? 'below_cutoff'
                : missingCountryQuestion
                  ? 'blocked'
                  : thirdPartyQuestion
                    ? 'blocked'
                    : 'new'
        const values = {
          projectionIdentityKey: existing?.projectionIdentityKey ?? identityKey,
          projectionAliasesJson,
          jobId: candidate.sourceEntityId,
          jobFactVersionId: candidate.id,
          captureEvidenceVersionId: persisted.rawRevisionId,
          adapterId: persisted.adapterId,
          adapterKind: persisted.adapterKind,
          adapterVersion: persisted.adapterVersion,
          workflowRunId,
          sourceId: source.id,
          companyName: candidate.companyName,
          roleTitle: candidate.roleTitle,
          roleKind,
          term: null,
          timingMode: 'unknown',
          termsJson: '[]',
          startDate: null,
          endDate: null,
          city: candidate.location?.city ?? null,
          region: candidate.location?.region ?? null,
          country: candidate.location?.country ?? null,
          workMode: candidate.workMode,
          locationRaw: candidate.location?.raw ?? null,
          employmentType: candidate.employmentType,
          seniority: candidate.seniority,
          locationJson: candidate.location ? JSON.stringify(candidate.location) : null,
          compensationJson: candidate.compensation ? JSON.stringify(candidate.compensation) : null,
          postedAtJson: JSON.stringify(candidate.postedAt),
          officialUrl,
          sourceUrl,
          destinationClass: destination.class,
          destinationUrl: destination.url,
          intermediaryUrl: destination.intermediaryUrl ?? null,
          usability: destination.class === 'third_party_job_posting' ? 'review_only' : 'usable',
          postedAge: null,
          priorityScore: existing?.priorityScore ?? null,
          priorityBand: existing?.priorityBand ?? null,
          fitNotes: existing?.fitNotes ?? null,
          duplicateNotes: preservesSourcingDecision ? existing.duplicateNotes : duplicateReason,
          blocker: preservesSourcingDecision
            ? existing.blocker
            : possibleMatchQuestion ?? missingCountryQuestion ?? thirdPartyQuestion,
          policyBlocker: preservesSourcingDecision
            ? existing.policyBlocker
            : notFitReason
              ? 'role_not_fit'
              : possibleMatch
                ? 'possible_match'
                : missingCountryQuestion
                  ? 'missing_country'
                  : thirdPartyQuestion
                    ? 'third_party_destination'
                    : null,
          dispositionReason: preservesSourcingDecision ? existing.dispositionReason : notFitReason,
          mergeStatus: preservesSourcingDecision ? existing.mergeStatus : policyMergeStatus,
          applicationId: preservesSourcingDecision
            ? existing.applicationId
            : strongApplicationDuplicate?.applicationId ?? null,
          mergeNotes: preservesSourcingDecision
            ? existing.mergeNotes
            : preservesCutoff
              ? existing?.mergeNotes ?? null
              : notFitReason ?? duplicateReason ?? possibleMatchQuestion ?? missingCountryQuestion ?? thirdPartyQuestion,
          discoveredAt: candidate.observedAt,
          updatedAt: timestamp,
          deletedAt: null,
        } as const

        if (existing) {
          const [updated] = await transaction.update(opportunities).set(values)
            .where(eq(opportunities.id, existing.id))
            .returning({ id: opportunities.id })
          if (!updated) throw new Error(`Sourcing finding not found: ${existing.id}`)
          return updated.id
        }

        const findingId = randomUUID()
        const [inserted] = await transaction.insert(opportunities).values({
          id: findingId,
          ...values,
          createdAt: timestamp,
        }).returning({ id: opportunities.id })
        if (!inserted) throw new Error('Canonical sourcing finding was not created')
        return inserted.id
  }

  return {
    projectPersisted,
  }
}

function canonicalRoleKind(candidate: CanonicalSourceCandidate): RoleKind {
  if (candidate.seniority === 'internship' || candidate.employmentType === 'internship' || /\bintern(?:ship)?\b/i.test(candidate.roleTitle)) {
    return 'internship'
  }
  if (candidate.employmentType === 'full_time') return 'full_time'
  if (candidate.employmentType === 'part_time') return 'part_time'
  if (candidate.employmentType === 'contract') return 'contract'
  return 'other'
}

function sourcingProjectionIdentityKeys(candidate: CanonicalSourceCandidate) {
  return [...new Set([
    `source_entity:${candidate.sourceEntityId}`,
    `${candidate.canonicalIdentity.kind}:${candidate.canonicalIdentity.value}`,
    ...(candidate.destination
      ? [`destination:${candidate.destination.class}:${candidate.destination.url}`]
      : []),
    `raw_record:${candidate.rawRecordId}`,
  ])]
}

function parseProjectionAliases(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function isNewerSourceRevision(
  incoming: { id?: string; rawRevisionId: string; rawRecordId: string; revision: number; observedAt: string },
  current: { id: string; rawRecordId: string; revision: number; observedAt: string },
) {
  if (incoming.rawRecordId === current.rawRecordId) {
    return incoming.revision > current.revision
  }
  if (incoming.observedAt !== current.observedAt) {
    return incoming.observedAt > current.observedAt
  }
  return incoming.rawRevisionId > current.id
}

function weakCandidateFactsMatch(
  finding: {
    companyName: string
    roleTitle: string
    locationRaw: string | null
    postedAtJson: string | null
  },
  candidate: CanonicalSourceCandidate,
) {
  if (!candidate.location?.raw || candidate.postedAt.precision === 'unknown') return false
  if (
    normalizeFact(finding.companyName) !== normalizeFact(candidate.companyName) ||
    normalizeFact(finding.roleTitle) !== normalizeFact(candidate.roleTitle) ||
    normalizeFact(finding.locationRaw) !== normalizeFact(candidate.location?.raw ?? null)
  ) {
    return false
  }
  if (!finding.postedAtJson) return false
  try {
    const postedAt = JSON.parse(finding.postedAtJson) as CanonicalSourceCandidate['postedAt']
    if (postedAt.precision !== candidate.postedAt.precision) return false
    return postedAt.precision === 'relative'
      ? normalizeFact(postedAt.raw) === normalizeFact(candidate.postedAt.raw)
      : postedAt.value === candidate.postedAt.value
  } catch {
    return false
  }
}

function normalizeFact(value: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
}
