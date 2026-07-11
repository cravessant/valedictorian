import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { CanonicalSourceCandidate, RoleKind } from 'sparxie'
import {
  applicationLinks,
  canonicalSourceCandidates,
  normalizationGates,
  normalizationRuns,
  rawSourceRevisions,
  sources,
  sourcingFindings,
  workflowRuns,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

export const SOURCING_PROJECTION_POLICY_VERSION = 'canonical-sourcing-policy/v1'

export function createCanonicalCandidateProjectionService(
  now: () => Date = () => new Date(),
) {
  const projectPersisted = (
    transaction: Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0],
    candidateId: string,
    rawRevisionId: string,
  ) => {
        const persisted = transaction
          .select({
            candidateJson: canonicalSourceCandidates.candidateJson,
            candidateId: canonicalSourceCandidates.id,
            gateCandidateId: normalizationGates.candidateId,
            gateStatus: normalizationGates.status,
            adapterId: rawSourceRevisions.adapterId,
            adapterKind: rawSourceRevisions.adapterKind,
            adapterVersion: rawSourceRevisions.adapterVersion,
            reportedOriginName: rawSourceRevisions.reportedOriginName,
            rawRevisionId: rawSourceRevisions.id,
            rawRecordId: rawSourceRevisions.rawRecordId,
            revision: rawSourceRevisions.revision,
            observedAt: rawSourceRevisions.observedAt,
            runStatus: normalizationRuns.status,
          })
          .from(canonicalSourceCandidates)
          .innerJoin(normalizationRuns, eq(canonicalSourceCandidates.runId, normalizationRuns.id))
          .innerJoin(normalizationGates, eq(normalizationGates.runId, normalizationRuns.id))
          .innerJoin(rawSourceRevisions, eq(rawSourceRevisions.id, canonicalSourceCandidates.rawRevisionId))
          .where(and(
            eq(canonicalSourceCandidates.id, candidateId),
            eq(canonicalSourceCandidates.rawRevisionId, rawRevisionId),
          ))
          .get()

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
        const identityMatches = transaction.select().from(sourcingFindings).all().filter((finding) => {
          const aliases = parseProjectionAliases(finding.projectionAliasesJson)
          return identityKeys.some((key) => finding.projectionIdentityKey === key || aliases.includes(key))
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
        if (existing?.rawRevisionId) {
          const currentRevision = transaction.select({
            id: rawSourceRevisions.id,
            rawRecordId: rawSourceRevisions.rawRecordId,
            revision: rawSourceRevisions.revision,
            observedAt: rawSourceRevisions.observedAt,
          }).from(rawSourceRevisions).where(eq(rawSourceRevisions.id, existing.rawRevisionId)).get()
          if (currentRevision && !isNewerSourceRevision(persisted, currentRevision)) {
            transaction.update(sourcingFindings).set({ projectionAliasesJson })
              .where(eq(sourcingFindings.id, existing.id)).run()
            return existing.id
          }
        }
        let source = transaction.select().from(sources).where(eq(sources.name, sourceName)).get()
        if (!source) {
          source = {
            id: randomUUID(),
            name: sourceName,
            accountHint: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          }
          transaction.insert(sources).values(source).run()
        }
        let workflowRunId = existing?.workflowRunId
        if (!workflowRunId) {
          workflowRunId = randomUUID()
          transaction.insert(workflowRuns).values({
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
          }).run()
        }

        const destination = candidate.destination
        const roleKind = canonicalRoleKind(candidate)
        const roleFit = roleKind === 'internship'
        const strongApplicationDuplicate = roleFit && destination.class === 'employer_or_ats'
          ? transaction.select({ applicationId: applicationLinks.applicationId })
              .from(applicationLinks)
              .where(and(
                eq(applicationLinks.kind, 'official'),
                eq(applicationLinks.url, destination.url),
                isNull(applicationLinks.deletedAt),
              )).get()
          : null
        const officialUrl = destination.class === 'employer_or_ats' ? destination.url : null
        const sourceUrl = destination.class === 'third_party_job_posting'
          ? destination.url
          : candidate.sourceUrl
        const possibleMatch = !roleFit || strongApplicationDuplicate ? null : transaction
          .select({
            id: sourcingFindings.id,
            companyName: sourcingFindings.companyName,
            roleTitle: sourcingFindings.roleTitle,
            locationRaw: sourcingFindings.locationRaw,
            postedAtJson: sourcingFindings.postedAtJson,
          })
          .from(sourcingFindings)
          .where(isNull(sourcingFindings.deletedAt))
          .all()
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
          sourceEntityId: candidate.sourceEntityId,
          canonicalCandidateId: candidate.id,
          rawRevisionId: persisted.rawRevisionId,
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
          mergedApplicationId: preservesSourcingDecision
            ? existing.mergedApplicationId
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
          transaction.update(sourcingFindings).set(values)
            .where(eq(sourcingFindings.id, existing.id)).run()
          return existing.id
        }

        const findingId = randomUUID()
        transaction.insert(sourcingFindings).values({
          id: findingId,
          ...values,
          createdAt: timestamp,
        }).run()
        return findingId
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
