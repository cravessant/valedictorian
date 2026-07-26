import { and, count, eq } from 'drizzle-orm'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import {
  createPgliteClient,
  migratePgliteDatabase,
} from '../src/db/pglite'
import { workspaces } from '../src/db/workspaces.schema'
import {
  captureResolutionStageResults,
  captureRevisions,
} from '../src/modules/capture/capture.schema'
import { createStaticConnectorRegistry } from '../src/modules/connectors/connector.registry'
import type {
  AppConnectorRuntime,
  AppJobConnector,
} from '../src/modules/connectors/connector.runner'
import {
  companyCapabilityState,
  jobCompanyAssignments,
} from '../src/modules/company/company.schema'
import { createCompanyCoverageService } from '../src/modules/company/company.coverage'
import { jobs } from '../src/modules/job/job.schema'
import { jobFactsTiming } from '../src/modules/job/job.timing'
import type { LocalScheduledWorkSource } from '../src/runtime/local-scheduler'
import { createLocalValedictorianClient } from '../src/runtime/local-valedictorian-client'

const BUILD_IDENTITY = process.env.VALEDICTORIAN_PACKAGE_MANUAL_WORKFLOW_BUILD_IDENTITY
  ?? 'unspecified-build'
const FIXTURE_ADAPTER_ID = 'jobright.resolver'
const FIXTURE_ADAPTER_VERSION = '0.18.2'
const FRESH_WORKSPACE_ID = 'package-proof-fresh-workspace'
const MIGRATED_WORKSPACE_ID = 'package-proof-migrated-workspace'
const FIXTURE_DESTINATION = 'https://jobs.lever.co/packageproof/fixture-engineer'
const FIXTURE_INTERMEDIARY_URL = 'https://jobright.ai/jobs/info/package-proof-jobright-001'
const FIXTURE_JOBRIGHT_DETAIL_URL = 'https://swan-api.jobright.ai/swan/share/job/package-proof-jobright-001'
const FIXTURE_PROVIDER_RECORD_ID = 'package-proof-jobright-001'
const ACTOR = { id: 'package-proof', type: 'system' as const }
type LocalClient = Awaited<ReturnType<typeof createLocalValedictorianClient>>
type JobId = Parameters<LocalClient['jobs']['externalIdentities']['add']>[0]['jobId']

export interface PackagedManualWorkflowProofResult {
  readonly buildIdentity: string
  readonly fixtures: {
    readonly adapter: string
    readonly destinationHost: string
    readonly intermediaryHost: string
    readonly resolver: string
  }
  readonly phase: 'verify' | 'write'
  readonly workspace: {
    readonly fresh: {
      readonly companyCount: number
      readonly completedCaptureCount: number
      readonly companyCapability: 'ready'
    }
    readonly migrated: {
      readonly assignmentCount: number
      readonly companyCapability: 'ready'
      readonly completed: number
      readonly total: number
    }
  }
  readonly observables: Record<string, boolean | number | string>
}

export interface RunPackagedManualWorkflowProofOptions {
  readonly dataDirectory: string
  readonly phase: 'verify' | 'write'
}

/**
 * Exercises the accepted #369 data workflow in the same local client and PGlite
 * runtime that the packaged app opens. It has no renderer or network dependency.
 * The fixture uses the shipped Jobright detail resolver against recorded I/O; it
 * does not claim to exercise Jobright network discovery.
 */
export async function runPackagedManualWorkflowProof({
  dataDirectory,
  phase,
}: RunPackagedManualWorkflowProofOptions): Promise<PackagedManualWorkflowProofResult> {
  const pglite = await createPgliteClient({ dataDir: dataDirectory })
  try {
    const database = await migratePgliteDatabase(pglite)
    if (phase === 'write') {
      return await writeProof(database, dataDirectory)
    }
    return await verifyProof(database, dataDirectory)
  } finally {
    await pglite.close()
  }
}

async function writeProof(
  database: Awaited<ReturnType<typeof migratePgliteDatabase>>,
  dataDirectory: string,
): Promise<PackagedManualWorkflowProofResult> {
  await seedMigratedWorkspace(database)
  const migrated = await createLocalValedictorianClient({
    database,
    deferCompanyCoverageMigration: true,
    pgliteDataPath: dataDirectory,
    registerScheduledWorkSource: () => undefined,
    scheduleCompanyCoverageMigration: () => undefined,
    workspaceId: MIGRATED_WORKSPACE_ID,
  })
  const migratingCapability = await migrated.companies.capability.get()
  assert(migratingCapability.status === 'migrating'
    && migratingCapability.completed < migratingCapability.total,
  'Migrated workspace did not expose incomplete Company coverage before backfill.')
  const unavailableWrite = await migrated.companies.create({
    actor: ACTOR,
    displayName: 'Blocked before Company backfill',
    idempotencyKey: 'package-proof-migrated-write-blocked',
    notes: null,
    rationale: 'Verify Company-backed writes remain unavailable during backfill.',
    websiteUrl: null,
    workspaceId: MIGRATED_WORKSPACE_ID,
  })
  assert(unavailableWrite.status === 'blocked'
    && unavailableWrite.failure.blocker.code === 'impossible_state',
  'Migrated workspace accepted a Company-backed write before coverage completed.')
  const migratedCoverage = createCompanyCoverageService(database)
  const migratedCapability = await migratedCoverage.migrateToReady(MIGRATED_WORKSPACE_ID)
  assert(migratedCapability.status === 'ready', 'Migrated workspace Company capability was not ready.')
  const availableWrite = await migrated.companies.create({
    actor: ACTOR,
    displayName: 'Available after Company backfill',
    idempotencyKey: 'package-proof-migrated-write-ready',
    notes: null,
    rationale: 'Verify Company-backed writes become available after complete coverage.',
    websiteUrl: null,
    workspaceId: MIGRATED_WORKSPACE_ID,
  })
  assert(availableWrite.status === 'created',
    'Migrated workspace did not allow a Company-backed write after coverage completed.')
  const migratedState = await capabilityState(database, MIGRATED_WORKSPACE_ID)
  assert(migratedState.completed === 1 && migratedState.total === 1,
    'Migrated workspace did not reach complete Company coverage.')
  const migratedAssignment = await migrated.companyAssignments.get('01990000-0000-7000-8000-000000000001')
  const migratedAssignmentRows = await database.select({ value: count() })
    .from(jobCompanyAssignments)
    .where(eq(jobCompanyAssignments.workspaceId, MIGRATED_WORKSPACE_ID))
  assert(Number(migratedAssignmentRows[0]?.value) === 1,
    'Migrated workspace left partial Company-assignment coverage.')

  const scheduledSources = new Map<string, LocalScheduledWorkSource>()
  const clock = monotonicClock()
  const jobrightFixture = createRecordedJobrightFixture(clock)
  const fresh = await createLocalValedictorianClient({
    connectorRegistry: createStaticConnectorRegistry([jobrightFixture.connector]),
    database,
    now: clock,
    pgliteDataPath: dataDirectory,
    registerScheduledWorkSource: (source) => scheduledSources.set(source.id, source),
    workspaceId: FRESH_WORKSPACE_ID,
  })
  const freshCapability = await fresh.companies.capability.get()
  assert(freshCapability.status === 'ready', 'Fresh workspace Company capability was not ready.')

  await fresh.connectors.create({
    connectorId: FIXTURE_ADAPTER_ID,
    connectorVersion: FIXTURE_ADAPTER_VERSION,
    displayName: 'Jobright package-proof fixture',
    earliestBackfillDate: '2026-07-01',
    enabled: true,
    filters: {
      jobTaxonomyList: [{ taxonomyId: 'software-engineering', title: 'Software Engineering' }],
    },
    id: 'package-proof-jobright',
  })
  const connectorRun = await fresh.connectors.runs.trigger({
    connectorInstanceId: 'package-proof-jobright',
    mode: 'manual',
    coverageEndedAt: clock().toISOString(),
  })
  assert(connectorRun.status === 'completed', 'Fixture Jobright Capture did not complete.')
  const destinationWork = scheduledSources.get('capture_destination_resolution')
  assert(destinationWork, 'Packaged client did not register destination-resolution work.')
  await destinationWork.runDue()
  assert(jobrightFixture.detailRequests.length === 1
    && jobrightFixture.detailRequests[0] === `GET ${FIXTURE_JOBRIGHT_DETAIL_URL}`,
  'The shipped Jobright resolver did not perform the expected recorded detail request.')

  const initialCapturePage = await fresh.captureResolution.list({ filter: 'all', sort: 'observed_desc' })
  const firstCapture = initialCapturePage.items.find((capture) => capture.source.provider === FIXTURE_ADAPTER_ID)
  assert(firstCapture, 'Fixture Jobright Capture was not visible in the Capture API All filter.')
  const [capturedFixtureInput] = await database.select({ payloadJson: captureRevisions.payloadJson })
    .from(captureRevisions)
    .where(eq(captureRevisions.captureId, firstCapture.captureId))
    .limit(1)
  assert(capturedFixtureInput?.payloadJson?.includes(FIXTURE_INTERMEDIARY_URL),
    'Fixture Jobright intermediary URL was not preserved in the recorded Capture input.')
  assert(firstCapture.destination.state === 'resolved',
    `Fixture Jobright destination was not resolved: ${firstCapture.destination.state}.`)
  const completionDetail = await fresh.captureResolution.get(firstCapture.captureId)
  assert(completionDetail.destination.url === FIXTURE_DESTINATION,
    'Fixture Jobright destination did not reach the completion detail.')
  const [destinationStage] = await database.select({ resultJson: captureResolutionStageResults.resultJson })
    .from(captureResolutionStageResults)
    .where(and(
      eq(captureResolutionStageResults.generationId, completionDetail.expectedGenerationId!),
      eq(captureResolutionStageResults.stage, 'destination'),
    ))
    .limit(1)
  assert(destinationStage && JSON.parse(destinationStage.resultJson).method
    === 'jobright_api_detail_apply_link',
  'The shipped Jobright resolver did not classify the recorded intermediary/detail response.')
  const completed = await fresh.captureResolution.complete({
    actor: ACTOR,
    captureId: completionDetail.captureId,
    companyResolution: {
      action: 'create_local',
      displayName: 'Package Proof Employer',
      websiteUrl: 'https://package-proof.example',
    },
    destination: { class: 'employer_or_ats', url: FIXTURE_DESTINATION },
    evidenceReferences: completionDetail.exactEvidenceReferences,
    expectedCaptureRevision: completionDetail.captureRevision,
    expectedGenerationId: completionDetail.expectedGenerationId,
    externalIdentities: [],
    idempotencyKey: 'package-proof-complete-jobright',
    jobFacts: jobFacts('Package Proof Employer', 'Package Fixture Engineer', FIXTURE_DESTINATION),
  })
  assert(completed.status === 'created' && completed.createdJob,
    'Fresh Jobright Capture did not complete into a new Job.')
  if (completed.status !== 'created') throw new Error('Unreachable completion result.')
  const attentionCapture = await createManualCapture(fresh, 'package-proof-needs-attention')
  await fresh.captureResolution.get(attentionCapture.id)
  const defaultCapturePage = await fresh.captureResolution.list({ sort: 'observed_desc' })
  const capturePage = await fresh.captureResolution.list({ filter: 'all', sort: 'observed_desc' })
  assertEquivalentPage(defaultCapturePage, capturePage, (capture) => capture.captureId,
    'Capture API default did not match its explicit All filter.')
  const needsAttentionPage = await fresh.captureResolution.list({
    filter: 'needs_attention', sort: 'observed_desc',
  })
  assert(needsAttentionPage.items.some((capture) => capture.captureId === attentionCapture.id),
    'Capture Needs attention filter did not include the unresolved manual Capture.')
  assert(!needsAttentionPage.items.some((capture) => capture.captureId === firstCapture.captureId),
    'Capture Needs attention filter included the completed Capture.')

  const originalAssignment = await fresh.companyAssignments.get(completed.jobId)
  assert(originalAssignment.workspaceCompany.companyId === completed.companyId,
    'Manual completion did not establish the selected initial Company assignment.')
  const maintenance = await exerciseCompanyMaintenance(fresh, completed.jobId, completed.companyId)
  const recovery = await exerciseCompletionRecovery(fresh)
  const finalAssignment = await fresh.companyAssignments.get(completed.jobId)
  assert(finalAssignment.workspaceCompany.companyId === maintenance.winnerCompanyId,
    'Company merge did not reassign the Job to the canonical Company.')
  const defaultDirectory = await fresh.companies.directory.list({
    limit: 50,
    sort: 'display_name_asc',
  })
  const finalDirectory = await fresh.companies.directory.list({
    filter: 'all',
    limit: 50,
    sort: 'display_name_asc',
  })
  assertEquivalentPage(defaultDirectory, finalDirectory, (company) => company.companyId,
    'Company API default did not match its explicit All filter.')
  const completedPage = await fresh.captureResolution.list({ filter: 'all', sort: 'observed_desc' })
  const freshAssignments = await database.select({ value: count() })
    .from(jobCompanyAssignments)
    .innerJoin(jobs, and(
      eq(jobs.id, jobCompanyAssignments.jobId),
      eq(jobs.workspaceId, jobCompanyAssignments.workspaceId),
    ))
    .where(eq(jobCompanyAssignments.workspaceId, FRESH_WORKSPACE_ID))
  const freshJobCount = await database.select({ value: count() })
    .from(jobs)
    .where(eq(jobs.workspaceId, FRESH_WORKSPACE_ID))
  assert(Number(freshAssignments[0]?.value) === Number(freshJobCount[0]?.value),
    'Fresh workspace has a Job without exactly one Company assignment.')

  return proofResult({
    workspace: {
      fresh: {
        companyCount: finalDirectory.totalCount,
        completedCaptureCount: completedPage.items.filter((capture) => capture.linkedJob !== null).length,
        companyCapability: 'ready',
      },
      migrated: {
        assignmentCount: Number(migratedAssignmentRows[0]?.value),
        companyCapability: 'ready',
        completed: migratedState.completed,
        total: migratedState.total,
      },
    },
    observables: {
      companyAliasAndNotesEdited: true,
      companyAssignmentRecoveryAttached: recovery.companyAssignmentAttached,
      companyArchiveAndRestoreRevisioned: true,
      companyMergePreservedHistory: true,
      companyMergeReassignedJobToCanonical: true,
      companyReassignmentCompleted: true,
      captureApiDefaultMatchesAll: true,
      captureNeedsAttentionFilterExercised: true,
      companyApiDefaultMatchesAll: true,
      destinationResolved: true,
      duplicateJobRecoveryAttached: recovery.duplicateAttached,
      duplicateReviewMarkedDistinct: true,
      initialCompanyAssignmentCreated: originalAssignment.assignmentRevision === 1,
      jobrightIntermediaryRecorded: true,
      jobrightRecordedDetailResolverUsed: true,
      migratedOneAssignmentPerJob: migratedAssignment.assignmentRevision === 1,
      migratedWriteAvailableAfterBackfill: true,
      migratedWriteRejectedBeforeBackfill: true,
      migratedWorkspaceReady: true,
    },
    phase: 'write',
  })
}

async function verifyProof(
  database: Awaited<ReturnType<typeof migratePgliteDatabase>>,
  dataDirectory: string,
): Promise<PackagedManualWorkflowProofResult> {
  const fresh = await createLocalValedictorianClient({
    database,
    pgliteDataPath: dataDirectory,
    registerScheduledWorkSource: () => undefined,
    workspaceId: FRESH_WORKSPACE_ID,
  })
  const migrated = await createLocalValedictorianClient({
    database,
    pgliteDataPath: dataDirectory,
    registerScheduledWorkSource: () => undefined,
    workspaceId: MIGRATED_WORKSPACE_ID,
  })
  const freshCapability = await fresh.companies.capability.get()
  const migratedCapability = await migrated.companies.capability.get()
  assert(freshCapability.status === 'ready' && migratedCapability.status === 'ready',
    'Company capability did not remain ready after the packaged restart.')
  const captures = await fresh.captureResolution.list({ filter: 'all', sort: 'observed_desc' })
  const companies = await fresh.companies.directory.list({
    filter: 'all', limit: 50, sort: 'display_name_asc',
  })
  const freshAssignments = await assignmentCoverage(database, FRESH_WORKSPACE_ID)
  const migratedAssignments = await assignmentCoverage(database, MIGRATED_WORKSPACE_ID)
  const fixtureCapture = captures.items.find((capture) =>
    capture.source.provider === FIXTURE_ADAPTER_ID && capture.linkedJob !== null)
  assert(fixtureCapture,
    'Completed Capture was not visible after the packaged restart.')
  const canonicalCompany = companies.items.find((company) =>
    company.displayName === 'Merge Package Systems' && company.status === 'active')
  const mergedCompany = companies.items.find((company) =>
    company.displayName === 'Merge Package System' && company.status === 'merged')
  assert(canonicalCompany && mergedCompany,
    'Merged Company history was not visible after the packaged restart.')
  const fixtureAssignment = await fresh.companyAssignments.get(fixtureCapture.linkedJob!.jobId)
  assert(fixtureAssignment.workspaceCompany.companyId === canonicalCompany.companyId,
    'Company merge assignment did not persist after the packaged restart.')
  assert(freshAssignments.assignments === freshAssignments.jobs,
    'Fresh workspace lost one-assignment-per-Job coverage after restart.')
  assert(migratedAssignments.assignments === migratedAssignments.jobs,
    'Migrated workspace lost one-assignment-per-Job coverage after restart.')

  const migratedState = await capabilityState(database, MIGRATED_WORKSPACE_ID)
  return proofResult({
    workspace: {
      fresh: {
        companyCount: companies.totalCount,
        completedCaptureCount: captures.items.filter((capture) => capture.linkedJob !== null).length,
        companyCapability: 'ready',
      },
      migrated: {
        assignmentCount: migratedAssignments.assignments,
        companyCapability: 'ready',
        completed: migratedState.completed,
        total: migratedState.total,
      },
    },
    observables: {
      companyHistoryPersistedAcrossRestart: true,
      companyMergeAssignmentPersistedAcrossRestart: true,
      completedCapturePersistedAcrossRestart: true,
      freshOneAssignmentPerJobAfterRestart: true,
      migratedOneAssignmentPerJobAfterRestart: true,
    },
    phase: 'verify',
  })
}

async function exerciseCompanyMaintenance(
  client: LocalClient,
  jobId: string,
  originalCompanyId: string,
) {
  const original = await client.companies.get(originalCompanyId)
  const notes = await client.companies.notes.update({
    ...companyContext('package-proof-original-notes'),
    companyId: originalCompanyId,
    expectedCompanyRevision: original.lookup.requested.revision,
    notes: 'Packaged workflow proof notes.',
  })
  assert(notes.status === 'updated', 'Company notes did not update.')
  const alias = await client.companies.aliases.add({
    ...companyContext('package-proof-original-alias'),
    companyId: originalCompanyId,
    expectedCompanyRevision: notes.company.revision,
    value: 'Package Proof Co.',
  })
  assert(alias.status === 'updated', 'Company alias did not update.')
  const archived = await client.companies.archive({
    ...companyContext('package-proof-original-archive'),
    companyId: originalCompanyId,
    expectedCompanyRevision: alias.company.revision,
  })
  assert(archived.status === 'archived', 'Company did not archive.')
  const restored = await client.companies.restore({
    ...companyContext('package-proof-original-restore'),
    companyId: originalCompanyId,
    expectedCompanyRevision: archived.company.revision,
  })
  assert(restored.status === 'restored', 'Company did not restore.')

  const reassignmentTarget = await createCompany(client, 'package-proof-reassignment',
    'Package Proof Reassignment', 'https://reassignment.package-proof.example', null)
  const beforeReassignment = await client.companyAssignments.get(jobId)
  const reassigned = await client.companyAssignments.reassign({
    ...companyContext('package-proof-reassign'),
    jobId,
    expectedAssignmentRevision: beforeReassignment.assignmentRevision,
    destinationCompanyId: reassignmentTarget.companyId,
    expectedDestinationCompanyRevision: reassignmentTarget.company.revision,
  })
  assert(reassigned.status === 'reassigned', 'Job Company reassignment did not succeed.')

  const distinctLeft = await createCompany(client, 'package-proof-distinct-left',
    'Distinct Package Systems', 'https://distinct.package-proof.example', null)
  const distinctRight = await createCompany(client, 'package-proof-distinct-right',
    'Distinct Package System', 'https://distinct.package-proof.example', null)
  const distinctCandidate = await candidateFor(client, distinctLeft.companyId, distinctRight.companyId)
  const marked = await client.companies.duplicates.markDistinct({
    ...companyContext('package-proof-mark-distinct'),
    candidateId: distinctCandidate.candidateId,
    expectedCandidateRevision: distinctCandidate.candidateRevision,
    expectedLeftCompanyRevision: distinctCandidate.left.revision,
    expectedRightCompanyRevision: distinctCandidate.right.revision,
    leftCompanyId: distinctCandidate.left.companyId,
    rationale: 'The packaged proof fixture represents separate local Companies.',
    rightCompanyId: distinctCandidate.right.companyId,
  })
  assert(marked.status === 'marked_distinct', 'Duplicate candidate was not marked distinct.')

  const winner = await createCompany(client, 'package-proof-merge-winner',
    'Merge Package Systems', 'https://merge.package-proof.example', 'Canonical packaged proof notes.')
  const loser = await createCompany(client, 'package-proof-merge-loser',
    'Merge Package System', 'https://merge.package-proof.example', 'Merged packaged proof notes.')
  const beforeMergeAssignment = await client.companyAssignments.get(jobId)
  const assignLoser = await client.companyAssignments.reassign({
    ...companyContext('package-proof-assign-loser'),
    jobId,
    expectedAssignmentRevision: beforeMergeAssignment.assignmentRevision,
    destinationCompanyId: loser.companyId,
    expectedDestinationCompanyRevision: loser.company.revision,
  })
  assert(assignLoser.status === 'reassigned', 'Job could not be assigned to the merge fixture Company.')
  const merged = await client.companies.duplicates.merge({
    ...companyContext('package-proof-merge'),
    acknowledgeNoUndo: true,
    expectedLoserCompanyRevision: loser.company.revision,
    expectedWinnerCompanyRevision: winner.company.revision,
    loserCompanyId: loser.companyId,
    loserDisplayNameConfirmation: loser.company.displayName,
    winnerCompanyId: winner.companyId,
  })
  assert(merged.status === 'merged', 'Manual Company merge did not succeed.')
  if (merged.status !== 'merged') throw new Error('Unreachable Company merge result.')
  assert(merged.historyPreserved && merged.notesPreserved.loser,
    'Manual Company merge did not preserve history and notes.')
  const lookup = await client.companies.lookup(loser.companyId)
  assert(lookup.canonical.id === winner.companyId && lookup.redirectPath.length === 1,
    'Manual Company merge did not leave a terminal one-hop canonical identity.')
  return { winnerCompanyId: winner.companyId }
}

async function exerciseCompletionRecovery(
  client: LocalClient,
) {
  const first = await createPublicJob(client, 'package-proof-recovery-first',
    'Recovery First', 'https://recovery.package-proof.example/first')
  const second = await createPublicJob(client, 'package-proof-recovery-second',
    'Recovery Second', 'https://recovery.package-proof.example/second')
  await addStrongIdentity(client, first.id, 'https://recovery.package-proof.example/first')
  await addStrongIdentity(client, second.id, 'https://recovery.package-proof.example/second')
  const capture = await createManualCapture(client, 'package-proof-duplicate-recovery')
  const detail = await client.captureResolution.get(capture.id)
  const duplicate = await client.captureResolution.complete({
    ...completionInput(detail, 'package-proof-duplicate-blocked'),
    externalIdentities: [
      strongIdentity('https://recovery.package-proof.example/first'),
      strongIdentity('https://recovery.package-proof.example/second'),
    ],
  })
  assert(duplicate.status === 'duplicate_blocked', 'Duplicate Job recovery was not surfaced.')
  if (duplicate.status !== 'duplicate_blocked') throw new Error('Unreachable duplicate result.')
  const target = duplicate.conflictingJobs.find((job) => job.jobId === first.id)
  assert(target, 'Duplicate Job recovery did not include the selected current Job.')
  const targetAssignment = await client.companyAssignments.get(first.id)
  const attached = await client.captureResolution.complete({
    ...completionInput(detail, 'package-proof-duplicate-attach'),
    companyResolution: {
      action: 'use_local',
      companyId: targetAssignment.workspaceCompany.companyId,
      expectedCompanyRevision: targetAssignment.workspaceCompany.revision,
      restoreIfArchived: false,
    },
    duplicateResolution: {
      action: 'attach',
      expectedAssignmentRevision: target.assignmentRevision,
      expectedJobFactsRevision: target.jobFactsRevision,
      targetJobId: target.jobId,
    },
    externalIdentities: [
      strongIdentity('https://recovery.package-proof.example/first'),
      strongIdentity('https://recovery.package-proof.example/second'),
    ],
  })
  assert(attached.status === 'created' && attached.jobId === first.id && !attached.createdJob,
    'Duplicate Job recovery did not attach the Capture to the selected Job.')

  const assignmentCapture = await createManualCapture(client, 'package-proof-assignment-recovery')
  const assignmentDetail = await client.captureResolution.get(assignmentCapture.id)
  const blockedAssignment = await client.captureResolution.complete({
    ...completionInput(assignmentDetail, 'package-proof-assignment-blocked'),
    companyResolution: { action: 'create_local', displayName: 'Conflicting Package Company' },
    externalIdentities: [strongIdentity('https://recovery.package-proof.example/first')],
  })
  assert(blockedAssignment.status === 'company_assignment_blocked',
    'Company-assignment recovery was not surfaced.')
  const recoveredAssignment = await client.captureResolution.complete({
    ...completionInput(assignmentDetail, 'package-proof-assignment-use-current'),
    companyResolution: {
      action: 'use_local',
      companyId: targetAssignment.workspaceCompany.companyId,
      expectedCompanyRevision: targetAssignment.workspaceCompany.revision,
      restoreIfArchived: false,
    },
    externalIdentities: [strongIdentity('https://recovery.package-proof.example/first')],
  })
  assert(recoveredAssignment.status === 'created' && recoveredAssignment.jobId === first.id,
    'Company-assignment recovery did not attach to the current Company.')
  return { companyAssignmentAttached: true, duplicateAttached: true }
}

async function seedMigratedWorkspace(database: Awaited<ReturnType<typeof migratePgliteDatabase>>) {
  const timestamp = '2026-07-24T12:00:00.000Z'
  await database.insert(workspaces).values({
    id: MIGRATED_WORKSPACE_ID,
    name: 'Package proof migrated workspace',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  await database.insert(jobs).values({
    id: '01990000-0000-7000-8000-000000000001',
    workspaceId: MIGRATED_WORKSPACE_ID,
    factsRevision: 1,
    factsJson: JSON.stringify(jobFacts('Migrated Package Employer', 'Migrated Engineer', null)),
    availabilityState: 'open',
    availabilityObservedAt: timestamp,
    availabilityRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    removedAt: null,
    idempotencyKey: null,
  })
}

function createRecordedJobrightFixture(clock: () => Date): {
  readonly connector: AppJobConnector
  readonly detailRequests: string[]
} {
  const detailRequests: string[] = []
  const recordedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    detailRequests.push(`${method} ${url}`)
    assert(url === FIXTURE_JOBRIGHT_DETAIL_URL && method === 'GET',
      'Recorded Jobright fixture received an unexpected request.')
    return new Response(JSON.stringify({
      success: true,
      result: {
        logined: true,
        jobDetail: {
          jobResult: {
            applyLink: FIXTURE_DESTINATION,
            isCompanySiteLink: false,
            originalUrl: FIXTURE_INTERMEDIARY_URL,
          },
        },
      },
    }), { headers: { 'content-type': 'application/json' }, status: 200 })
  }
  const shippedConnector = createJobrightConnector({ fetch: recordedFetch })
  const shippedResolver = shippedConnector.providerUrlResolver
  const checkpoint = shippedConnector.definition.checkpoint
  assert(shippedResolver, 'The shipped Jobright connector did not expose a provider URL resolver.')
  assert(checkpoint, 'The shipped Jobright connector did not expose checkpoint metadata.')
  const connector: AppJobConnector = {
    ...shippedConnector,
    providerUrlResolver: {
      ...shippedResolver,
      resolve(input, runtime) {
        return shippedResolver.resolve(input, recordedJobrightRuntime(runtime))
      },
    },
    async refresh(input, runtime: AppConnectorRuntime) {
      await runtime.captureIntake?.capture({
        observedAt: clock().toISOString(),
        providerRecordId: FIXTURE_PROVIDER_RECORD_ID,
        providerSchema: 'jobright-authenticated-search@1',
        reportedOrigin: { kind: 'aggregator', name: 'Jobright', providerId: 'jobright' },
        payload: {
          companyName: 'Package Proof Employer',
          intermediaryUrl: FIXTURE_INTERMEDIARY_URL,
          roleTitle: 'Package Fixture Engineer',
        },
        evidence: [{
          kind: 'provider_api_record',
          label: 'Recorded Jobright intermediary fixture',
          value: {
            intermediaryUrl: FIXTURE_INTERMEDIARY_URL,
            providerRecordId: FIXTURE_PROVIDER_RECORD_ID,
          },
        }],
      })
      return {
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: { cursor: 'package-proof-capture-complete' },
          schemaVersion: checkpoint.schemaVersion,
        },
        observations: [],
        operationOutcome: null,
        stats: { captures: 1, observations: 0 },
        status: 'completed' as const,
        synchronization: {
          newestFrontier: { state: 'caught_up' as const },
          historicalBackfill: {
            state: 'boundary_reached' as const,
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 1,
          outcome: { kind: 'boundary_exhausted' as const },
        },
        warnings: [],
      }
    },
  }
  return { connector, detailRequests }
}

function recordedJobrightRuntime(runtime: AppConnectorRuntime): AppConnectorRuntime {
  return {
    ...runtime,
    auth: {
      async refresh(input) {
        return {
          id: input.id,
          mode: input.mode ?? 'username_password',
          sessionId: 'package-proof-recorded-session',
          status: 'ready' as const,
        }
      },
      async resolve(input) {
        return {
          id: input.id,
          mode: input.mode ?? 'username_password',
          sessionId: 'package-proof-recorded-session',
          status: 'ready' as const,
        }
      },
    },
  }
}

async function createCompany(
  client: LocalClient,
  idempotencyKey: string,
  displayName: string,
  websiteUrl: string,
  notes: string | null,
) {
  const created = await client.companies.create({
    ...companyContext(idempotencyKey),
    displayName,
    notes,
    websiteUrl,
  })
  assert(created.status === 'created', `Could not create ${displayName}.`)
  if (created.status !== 'created') throw new Error('Unreachable Company creation result.')
  return created
}

async function candidateFor(
  client: Awaited<ReturnType<typeof createLocalValedictorianClient>>,
  firstCompanyId: string,
  secondCompanyId: string,
) {
  const candidates = await client.companies.duplicates.list({
    filter: 'open',
    limit: 50,
    sort: 'score_desc',
  })
  const fixtureIds = new Set([firstCompanyId, secondCompanyId])
  const match = candidates.items.find((candidate) =>
    fixtureIds.has(candidate.left.companyId) && fixtureIds.has(candidate.right.companyId))
  assert(match, 'Fixture duplicate candidate was not proposed.')
  return match
}

async function createManualCapture(
  client: LocalClient,
  providerRecordId: string,
) {
  const result = await client.captures.create({
    adapter: { id: 'package-proof-manual', kind: 'cli', version: '1.0.0' },
    evidence: [{ kind: 'title', label: 'Title', value: 'Package Recovery Engineer' }],
    evidenceMode: 'reported',
    observedAt: '2026-07-24T12:00:00.000Z',
    payload: { roleTitle: 'Package Recovery Engineer' },
    providerRecordId,
    providerSchema: 'package-proof-manual@1',
  })
  assert(result.status === 'succeeded', 'Could not create package-proof recovery Capture.')
  if (result.status !== 'succeeded') throw new Error('Unreachable Capture creation result.')
  return result.resource
}

async function createPublicJob(
  client: LocalClient,
  idempotencyKey: string,
  companyName: string,
  destination: string,
) {
  const capture = await createManualCapture(client, `${idempotencyKey}-capture`)
  const job = await client.jobs.create({
    actor: ACTOR,
    availability: { observedAt: '2026-07-24T12:00:00.000Z', state: 'open' },
    evidenceReferences: [{
      captureId: capture.id,
      captureRevision: capture.revision,
      evidenceIndexes: [0],
    }],
    externalIdentities: [],
    facts: jobFacts(companyName, `${companyName} Engineer`, destination),
    idempotencyKey,
  })
  assert(job.status === 'succeeded', 'Could not create package-proof recovery Job.')
  if (job.status !== 'succeeded') throw new Error('Unreachable Job creation result.')
  return job.resource
}

async function addStrongIdentity(
  client: LocalClient,
  jobId: JobId,
  value: string,
) {
  const added = await client.jobs.externalIdentities.add({
    actor: ACTOR,
    identity: strongIdentity(value),
    jobId,
  })
  assert(added.status === 'succeeded', 'Could not add the package-proof strong Job identity.')
}

function completionInput(
  detail: Awaited<ReturnType<LocalClient['captureResolution']['get']>>,
  idempotencyKey: string,
) {
  return {
    actor: ACTOR,
    captureId: detail.captureId,
    companyResolution: { action: 'create_local' as const, displayName: 'Package Recovery Company' },
    destination: null,
    evidenceReferences: detail.exactEvidenceReferences,
    expectedCaptureRevision: detail.captureRevision,
    expectedGenerationId: detail.expectedGenerationId,
    externalIdentities: [],
    idempotencyKey,
    jobFacts: jobFacts('Package Recovery Company', 'Package Recovery Engineer', null),
  }
}

function strongIdentity(value: string) {
  return {
    account: 'recovery.package-proof.example',
    kind: 'canonical_destination' as const,
    provider: 'recovery.package-proof.example',
    strength: 'strong' as const,
    value,
  }
}

function companyContext(idempotencyKey: string) {
  return {
    actor: ACTOR,
    idempotencyKey,
    rationale: 'Exercise the packaged manual workflow proof.',
    workspaceId: FRESH_WORKSPACE_ID,
  }
}

function jobFacts(companyName: string, roleTitle: string, destination: string | null) {
  return {
    companyName,
    roleTitle,
    sourceName: 'Jobright package-proof fixture',
    roleKind: 'experienced' as const,
    ...jobFactsTiming({ terms: [], timingMode: 'unknown', startDate: null, endDate: null }),
    location: null,
    workMode: 'remote' as const,
    employmentType: 'full_time' as const,
    seniority: 'senior' as const,
    compensation: null,
    postedAt: null,
    destination: destination ? { class: 'employer_or_ats' as const, url: destination } : null,
  }
}

function monotonicClock() {
  let milliseconds = Date.parse('2026-07-24T12:00:00.000Z')
  return () => new Date(milliseconds++)
}

async function assignmentCoverage(
  database: Awaited<ReturnType<typeof migratePgliteDatabase>>,
  workspaceId: string,
) {
  const [assignments] = await database.select({ value: count() })
    .from(jobCompanyAssignments)
    .where(eq(jobCompanyAssignments.workspaceId, workspaceId))
  const [jobCount] = await database.select({ value: count() })
    .from(jobs)
    .where(eq(jobs.workspaceId, workspaceId))
  return { assignments: Number(assignments?.value), jobs: Number(jobCount?.value) }
}

async function capabilityState(
  database: Awaited<ReturnType<typeof migratePgliteDatabase>>,
  workspaceId: string,
) {
  const [state] = await database.select({
    completed: companyCapabilityState.completed,
    total: companyCapabilityState.total,
  }).from(companyCapabilityState)
    .where(eq(companyCapabilityState.workspaceId, workspaceId))
  assert(state, 'Company capability state was not persisted.')
  return state
}

function proofResult(input: Pick<PackagedManualWorkflowProofResult, 'observables' | 'phase' | 'workspace'>) {
  return {
    ...input,
    buildIdentity: BUILD_IDENTITY,
    fixtures: {
      adapter: `${FIXTURE_ADAPTER_ID}@${FIXTURE_ADAPTER_VERSION}`,
      destinationHost: 'jobs.lever.co',
      intermediaryHost: 'jobright.ai',
      resolver: 'shipped_jobright_provider_url@1_recorded_io',
    },
  } satisfies PackagedManualWorkflowProofResult
}

function assertEquivalentPage<Item>(
  defaultPage: { readonly items: readonly Item[]; readonly pageInfo: unknown; readonly totalCount: number },
  allPage: { readonly items: readonly Item[]; readonly pageInfo: unknown; readonly totalCount: number },
  itemId: (item: Item) => string,
  message: string,
) {
  assert(defaultPage.totalCount === allPage.totalCount, `${message} Total count changed.`)
  assert(JSON.stringify(defaultPage.pageInfo) === JSON.stringify(allPage.pageInfo),
    `${message} Cursor metadata changed.`)
  assert(defaultPage.items.length === allPage.items.length,
    `${message} Page item count changed.`)
  assert(defaultPage.items.every((item, index) => itemId(item) === itemId(allPage.items[index]!)),
    `${message} Ordered item ids changed.`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
