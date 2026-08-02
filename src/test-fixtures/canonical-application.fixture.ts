import { createHash } from 'node:crypto'
import {
  applicationWorkflowStates,
  applications,
  jobs,
  opportunities,
  workspaces,
} from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import type { PgliteDatabase } from '@sparxie/valedictorian-local-runtime/database'

export interface CanonicalApplicationFixtureInput {
  id: string
  companyName: string
  roleTitle: string
  sourceName?: string
  operationalStatus?: string
  hasApplied?: boolean
  location?: { city?: string; region?: string; country?: string; display?: string }
  workMode?: string
  createdAt: string
  updatedAt?: string
}

export async function seedCanonicalApplication(
  database: PgliteDatabase,
  input: CanonicalApplicationFixtureInput,
) {
  const workspaceId = 'fixture-workspace'
  const suffix = createHash('sha256').update(input.id).digest('hex').slice(0, 12)
  const jobId = `017f22e2-79b0-7cc3-98c4-${suffix}`
  const opportunityId = `opportunity-${suffix}`
  const updatedAt = input.updatedAt ?? input.createdAt
  const sourceName = input.sourceName ?? 'LinkedIn'
  const facts = {
    companyName: input.companyName,
    roleTitle: input.roleTitle,
    sourceName,
    roleKind: 'internship',
    timingMode: 'unknown',
    terms: [],
    location: {
      city: input.location?.city ?? null,
      region: input.location?.region ?? null,
      country: input.location?.country ?? 'US',
      display: input.location?.display ?? null,
    },
    workMode: input.workMode ?? 'unknown',
  }

  await database.insert(workspaces).values({
    id: workspaceId, name: 'Fixture workspace', createdAt: input.createdAt, updatedAt,
  }).onConflictDoNothing()
  await database.insert(jobs).values({
    id: jobId, workspaceId, factsRevision: 1, factsJson: JSON.stringify(facts),
    availabilityState: 'open', availabilityObservedAt: input.createdAt,
    availabilityRevision: 1, createdAt: input.createdAt, updatedAt,
  })
  await database.insert(opportunities).values({
    id: opportunityId, workspaceId, jobId, revision: 1, fit: 'fit', rank: null,
    cutoff: 'above', disposition: 'pursue', createdAt: input.createdAt, updatedAt,
  })
  await database.insert(applications).values({
    id: input.id, workspaceId, opportunityId, jobId, revision: 1, status: 'active',
    jobFactsRevision: 1,
    snapshotJson: JSON.stringify({ job: { facts, factsRevision: 1 }, capturedAt: input.createdAt }),
    companyName: input.companyName, sourceName, createdAt: input.createdAt, updatedAt,
  })
  await database.insert(applicationWorkflowStates).values({
    applicationId: input.id,
    operationalStatus: input.operationalStatus ?? 'queued',
    hasApplied: input.hasApplied ?? false,
    createdAt: input.createdAt,
    updatedAt,
  })

  return { applicationId: input.id, jobId, opportunityId, workspaceId }
}
