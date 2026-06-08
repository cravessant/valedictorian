import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import {
  applicationEvents,
  applicationLinks,
  applications,
  applicationWorkflowStates,
  companies,
  sources,
  workflowRunSteps,
  workflowRuns,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  canonicalizeApplicationUrl,
  isApplicationAttemptActorType,
  isApplicationAttemptStepType,
  isApplicationStatus,
  isManualReviewKind,
  isRoleKind,
  isWorkMode,
  normalizeApplicationLinkKind,
  type ApplicationLinkRecord,
  type ApplicationAttempt,
  type ApplicationAttemptStep,
  type CompleteApplicationAttemptInput,
  type CreateApplicationInput,
  type CreateApplicationAttemptStepInput,
  type StartApplicationAttemptInput,
} from './application.types'
import { normalizeText } from './application.repository.utils'

export {
  applicationSelection,
  buildApplicationListOrder,
  buildApplicationListWhere,
  mapApplicationRow,
  selectApplicationById,
  validateListLimit,
} from './application.repository.list'

const attemptBlockerOutcomes = new Set([
  'manual_captcha',
  'security_gate',
  'login_needed',
  'platform_error',
  'closed',
  'not_fit',
  'not_pursued',
])

interface ApplicationAttemptRow {
  id: string
  status: string
  outcome: string | null
  actorType: string
  actorName: string | null
  subjectApplicationId: string | null
  summary: string | null
  metadataJson: string
  startedAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type MutationDatabase = Pick<DrizzleDatabase, 'insert' | 'select' | 'update'>

export function workflowPatch(input: {
  blockerReason?: string | null
  holdStartedAt?: string | null
  lockStartedAt?: string | null
  manualReviewKind?: string | null
  missingUserInfo?: string | null
}) {
  return Object.fromEntries(
    (
      [
        'lockStartedAt',
        'holdStartedAt',
        'manualReviewKind',
        'missingUserInfo',
        'blockerReason',
      ] as const
    )
      .filter((key) => key in input)
      .map((key) => [key, input[key]]),
  ) as {
    blockerReason?: string | null
    holdStartedAt?: string | null
    lockStartedAt?: string | null
    manualReviewKind?: string | null
    missingUserInfo?: string | null
  }
}

export function workflowPatchForAttemptOutcome(
  input: CompleteApplicationAttemptInput,
  now: string,
): ReturnType<typeof workflowPatch> {
  if (input.outcome === 'submitted') {
    return {
      lockStartedAt: null,
      holdStartedAt: null,
      manualReviewKind: null,
      missingUserInfo: null,
      blockerReason: null,
    }
  }

  if (input.outcome === 'ready_for_review') {
    return {
      lockStartedAt: null,
      holdStartedAt: input.holdStartedAt ?? now,
      manualReviewKind: input.manualReviewKind ?? null,
      blockerReason: null,
    }
  }

  if (input.outcome === 'needs_user_info') {
    return {
      lockStartedAt: null,
      missingUserInfo: input.missingUserInfo ?? null,
      blockerReason: null,
    }
  }

  if (attemptBlockerOutcomes.has(input.outcome)) {
    return {
      lockStartedAt: null,
      blockerReason: input.blockerReason ?? null,
    }
  }

  return {
    lockStartedAt: null,
  }
}

export function normalizeStartApplicationAttemptInput(
  input: StartApplicationAttemptInput,
): StartApplicationAttemptInput {
  const actorType = requiredText(input.actorType, 'actorType')

  if (!isApplicationAttemptActorType(actorType)) {
    throw new Error(`Invalid actorType: ${actorType}`)
  }

  return {
    ...input,
    applicationId: requiredText(input.applicationId, 'applicationId'),
    actorType,
    ...(input.actorName !== undefined
      ? { actorName: nullableTrimmedText(input.actorName, 'actorName') }
      : {}),
    ...(input.entryUrl !== undefined ? { entryUrl: nullableTrimmedText(input.entryUrl, 'entryUrl') } : {}),
    ...(input.resumeVariant !== undefined
      ? { resumeVariant: nullableTrimmedText(input.resumeVariant, 'resumeVariant') }
      : {}),
    ...(input.resumeArtifactPath !== undefined
      ? { resumeArtifactPath: nullableTrimmedText(input.resumeArtifactPath, 'resumeArtifactPath') }
      : {}),
    ...(input.summary !== undefined ? { summary: nullableTrimmedText(input.summary, 'summary') } : {}),
  }
}

export function normalizeCreateApplicationAttemptStepInput(
  input: CreateApplicationAttemptStepInput,
): CreateApplicationAttemptStepInput {
  const type = requiredText(input.type, 'attempt step type')

  if (!isApplicationAttemptStepType(type)) {
    throw new Error(`Invalid attempt step type: ${type}`)
  }

  return {
    ...input,
    applicationId: requiredText(input.applicationId, 'applicationId'),
    attemptId: requiredText(input.attemptId, 'attemptId'),
    type,
    message: requiredText(input.message, 'attempt step message'),
    ...(input.actor !== undefined ? { actor: requiredText(input.actor, 'actor') } : {}),
  }
}

export function normalizeCompleteApplicationAttemptInput(
  input: CompleteApplicationAttemptInput,
): CompleteApplicationAttemptInput {
  const outcome = requiredText(input.outcome, 'attempt outcome')

  if (!isApplicationStatus(outcome)) {
    throw new Error(`Invalid application status: ${outcome}`)
  }

  if (outcome === 'ready_for_review') {
    if (!input.holdStartedAt) {
      throw new Error('holdStartedAt is required for ready_for_review attempts')
    }

    if (!input.manualReviewKind) {
      throw new Error('manualReviewKind is required for ready_for_review attempts')
    }
  }

  if (outcome === 'needs_user_info' && !input.missingUserInfo) {
    throw new Error('missingUserInfo is required for needs_user_info attempts')
  }

  if (attemptBlockerOutcomes.has(outcome) && !input.blockerReason) {
    throw new Error(`blockerReason is required for ${outcome} attempts`)
  }

  if (
    input.manualReviewKind !== undefined &&
    input.manualReviewKind !== null &&
    !isManualReviewKind(input.manualReviewKind)
  ) {
    throw new Error(`Invalid manualReviewKind: ${input.manualReviewKind}`)
  }

  validateIsoTimestampField(input, 'holdStartedAt')

  return {
    ...input,
    applicationId: requiredText(input.applicationId, 'applicationId'),
    attemptId: requiredText(input.attemptId, 'attemptId'),
    outcome,
    ...(input.summary !== undefined ? { summary: nullableTrimmedText(input.summary, 'summary') } : {}),
    ...(input.stopReason !== undefined
      ? { stopReason: nullableTrimmedText(input.stopReason, 'stopReason') }
      : {}),
    ...(input.confirmationUrl !== undefined
      ? { confirmationUrl: nullableTrimmedText(input.confirmationUrl, 'confirmationUrl') }
      : {}),
    ...(input.confirmationText !== undefined
      ? { confirmationText: nullableTrimmedText(input.confirmationText, 'confirmationText') }
      : {}),
    ...(input.holdStartedAt !== undefined
      ? { holdStartedAt: nullableTrimmedText(input.holdStartedAt, 'holdStartedAt') }
      : {}),
    ...(input.missingUserInfo !== undefined
      ? { missingUserInfo: nullableTrimmedText(input.missingUserInfo, 'missingUserInfo') }
      : {}),
    ...(input.blockerReason !== undefined
      ? { blockerReason: nullableTrimmedText(input.blockerReason, 'blockerReason') }
      : {}),
  }
}

export function normalizeCreateApplicationInput(input: CreateApplicationInput): CreateApplicationInput {
  const roleKind = requiredText(input.roleKind, 'roleKind')
  const workMode = input.workMode
  const status = input.status

  if (!isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (!isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  if (!isApplicationStatus(status)) {
    throw new Error(`Invalid application status: ${status}`)
  }

  if (!input.primaryLink && !input.sourceLink) {
    throw new Error('Application creation requires a primaryLink or sourceLink')
  }

  return {
    ...input,
    companyName: requiredText(input.companyName, 'companyName'),
    roleTitle: requiredText(input.roleTitle, 'roleTitle'),
    sourceName: requiredText(input.sourceName, 'sourceName'),
    roleKind,
    country: requiredText(input.country, 'country'),
    primaryLink: input.primaryLink ? normalizeApplicationLinkInput(input.primaryLink) : undefined,
    sourceLink: input.sourceLink ? normalizeApplicationLinkInput(input.sourceLink) : undefined,
    ...(input.initialNote !== undefined
      ? { initialNote: requiredText(input.initialNote, 'note message') }
      : {}),
  }
}

export function normalizeApplicationUpdateInput<T extends {
  city?: string | null
  country?: string
  currentResumeVariant?: string | null
  hasApplied?: boolean
  locationRaw?: string | null
  region?: string | null
  roleKind?: string
  roleTitle?: string
  term?: string | null
  workMode?: string
}>(input: T): T {
  const roleKind = input.roleKind !== undefined ? requiredText(input.roleKind, 'roleKind') : undefined
  const workMode = input.workMode !== undefined ? requiredText(input.workMode, 'workMode') : undefined

  if (roleKind !== undefined && !isRoleKind(roleKind)) {
    throw new Error(`Invalid roleKind: ${roleKind}`)
  }

  if (workMode !== undefined && !isWorkMode(workMode)) {
    throw new Error(`Invalid workMode: ${workMode}`)
  }

  return {
    ...input,
    ...(input.roleTitle !== undefined ? { roleTitle: requiredText(input.roleTitle, 'roleTitle') } : {}),
    ...(roleKind !== undefined ? { roleKind } : {}),
    ...(input.term !== undefined ? { term: nullableTrimmedText(input.term, 'term') } : {}),
    ...(input.city !== undefined ? { city: nullableTrimmedText(input.city, 'city') } : {}),
    ...(input.region !== undefined ? { region: nullableTrimmedText(input.region, 'region') } : {}),
    ...(input.country !== undefined ? { country: requiredText(input.country, 'country') } : {}),
    ...(workMode !== undefined ? { workMode } : {}),
    ...(input.locationRaw !== undefined
      ? { locationRaw: nullableTrimmedText(input.locationRaw, 'locationRaw') }
      : {}),
    ...(input.currentResumeVariant !== undefined
      ? { currentResumeVariant: nullableTrimmedText(input.currentResumeVariant, 'currentResumeVariant') }
      : {}),
  }
}

export function normalizeApplicationLinkInput<T extends NonNullable<CreateApplicationInput['primaryLink']>>(
  link: T,
): T {
  return {
    ...link,
    kind: normalizeApplicationLinkKind(link.kind),
    label: requiredText(link.label, 'link label'),
    url: canonicalizeApplicationUrl(link.url),
  }
}

export function normalizeApplicationLinkUpdateInput<T extends {
  kind?: string
  label?: string
  url?: string
}>(input: T): T {
  return {
    ...input,
    ...(input.kind !== undefined ? { kind: normalizeApplicationLinkKind(input.kind) } : {}),
    ...(input.label !== undefined ? { label: requiredText(input.label, 'link label') } : {}),
    ...(input.url !== undefined ? { url: canonicalizeApplicationUrl(input.url) } : {}),
  }
}

export function validateWorkflowInput(input: {
  holdStartedAt?: string | null
  lockStartedAt?: string | null
  manualReviewKind?: string | null
}) {
  if (
    input.manualReviewKind !== undefined &&
    input.manualReviewKind !== null &&
    !isManualReviewKind(input.manualReviewKind)
  ) {
    throw new Error(`Invalid manualReviewKind: ${input.manualReviewKind}`)
  }

  validateIsoTimestampField(input, 'lockStartedAt')
  validateIsoTimestampField(input, 'holdStartedAt')
}

export function validateIsoTimestampField(
  input: { holdStartedAt?: string | null; lockStartedAt?: string | null },
  fieldName: 'holdStartedAt' | 'lockStartedAt',
) {
  const value = input[fieldName]

  if (value === undefined || value === null) {
    return
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }
}

export function assertNonEmptyPatch(patch: Record<string, unknown>, message: string) {
  if (Object.keys(patch).length === 0) {
    throw new Error(message)
  }
}

export function requiredText(value: string, fieldName: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${fieldName} is required`)
  }

  return trimmed
}

export function nullableTrimmedText(value: string | null, fieldName: string) {
  if (value === null) {
    return null
  }

  return requiredText(value, fieldName)
}

export function applicationLinkPatch(input: {
  externalId?: string | null
  isPrimary?: boolean
  kind?: string
  label?: string
  url?: string
}) {
  return Object.fromEntries(
    (['kind', 'label', 'url', 'externalId', 'isPrimary'] as const)
      .filter((key) => key in input)
      .map((key) => [key, input[key]]),
  ) as {
    externalId?: string | null
    isPrimary?: boolean
    kind?: string
    label?: string
    url?: string
  }
}

export function applicationPatch(input: {
  city?: string | null
  country?: string
  currentResumeVariant?: string | null
  hasApplied?: boolean
  locationRaw?: string | null
  region?: string | null
  roleKind?: string
  roleTitle?: string
  term?: string | null
  workMode?: string
}) {
  return Object.fromEntries(
    (
      [
        'roleTitle',
        'roleKind',
        'term',
        'city',
        'region',
        'country',
        'workMode',
        'locationRaw',
        'hasApplied',
        'currentResumeVariant',
      ] as const
    )
      .filter((key) => key in input)
      .map((key) => [key, input[key]]),
  ) as {
    city?: string | null
    country?: string
    currentResumeVariant?: string | null
    hasApplied?: boolean
    locationRaw?: string | null
    region?: string | null
    roleKind?: string
    roleTitle?: string
    term?: string | null
    workMode?: string
  }
}

export function findOrCreateCompany(database: MutationDatabase, name: string, now: string) {
  const normalizedName = normalizeText(name)
  const existing = database
    .select()
    .from(companies)
    .where(eq(companies.normalizedName, normalizedName))
    .get()

  if (existing) {
    return existing
  }

  const company = {
    id: randomUUID(),
    name,
    normalizedName,
    websiteUrl: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  database.insert(companies).values(company).run()
  return company
}

export function hasActiveOfficialUrl(database: MutationDatabase, url: string, excludedLinkId?: string) {
  return Boolean(
    database
      .select({ id: applicationLinks.id })
      .from(applicationLinks)
      .innerJoin(applications, eq(applicationLinks.applicationId, applications.id))
      .where(
        and(
          eq(applicationLinks.kind, 'official'),
          eq(applicationLinks.url, url),
          isNull(applicationLinks.deletedAt),
          isNull(applications.deletedAt),
        ),
      )
      .all()
      .some((link) => link.id !== excludedLinkId),
  )
}

export function hasActiveApplicationFingerprint(
  database: MutationDatabase,
  companyId: string,
  sourceId: string,
  roleTitle: string,
) {
  return database
    .select({
      id: applications.id,
      roleTitle: applications.roleTitle,
    })
    .from(applications)
    .where(
      and(
        eq(applications.companyId, companyId),
        eq(applications.sourceId, sourceId),
        isNull(applications.deletedAt),
      ),
    )
    .all()
    .some((application) => normalizeText(application.roleTitle) === normalizeText(roleTitle))
}

export function findOrCreateSource(database: MutationDatabase, name: string, now: string) {
  const normalizedName = normalizeText(name)
  const existing = database
    .select()
    .from(sources)
    .all()
    .find((source) => normalizeText(source.name) === normalizedName)

  if (existing) {
    return existing
  }

  const source = {
    id: randomUUID(),
    name,
    accountHint: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  database.insert(sources).values(source).run()
  return source
}

export function insertApplicationLink(
  database: MutationDatabase,
  {
    applicationId,
    discoveredAt,
    isPrimary,
    link,
    now,
  }: {
    applicationId: string
    discoveredAt: string
    isPrimary: boolean
    link: NonNullable<CreateApplicationInput['primaryLink']>
    now: string
  },
) {
  const id = randomUUID()

  database
    .insert(applicationLinks)
    .values({
      id,
      applicationId,
      kind: link.kind,
      label: link.label,
      url: link.url,
      externalId: link.externalId ?? null,
      isPrimary,
      discoveredAt,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .run()

  const created = database.select().from(applicationLinks).where(eq(applicationLinks.id, id)).get()

  if (!created) {
    throw new Error(`Application link not found: ${id}`)
  }

  return mapApplicationLinkRecord(created)
}

export function clearPrimaryApplicationLinks(
  database: MutationDatabase,
  applicationId: string,
  now: string,
) {
  database
    .update(applicationLinks)
    .set({ isPrimary: false, updatedAt: now })
    .where(
      and(
        eq(applicationLinks.applicationId, applicationId),
        isNull(applicationLinks.deletedAt),
      ),
    )
    .run()
}

export function mapApplicationLinkRecord(
  row: typeof applicationLinks.$inferSelect,
): ApplicationLinkRecord {
  return {
    id: row.id,
    applicationId: row.applicationId,
    kind: row.kind,
    label: row.label,
    url: row.url,
    externalId: row.externalId,
    isPrimary: row.isPrimary,
    discoveredAt: row.discoveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

export function insertApplicationEvent(
  database: MutationDatabase,
  {
    applicationId,
    message,
    now,
    payload,
    type,
  }: {
    applicationId: string
    message: string
    now: string
    payload: unknown
    type: string
  },
) {
  database
    .insert(applicationEvents)
    .values({
      id: randomUUID(),
      applicationId,
      type,
      message,
      payloadJson: JSON.stringify(payload),
      actor: 'agent',
      createdAt: now,
    })
    .run()
}

export function insertWorkflowRunStep(
  database: MutationDatabase,
  {
    actor,
    message,
    now,
    payload,
    sequence,
    type,
    workflowRunId,
  }: {
    actor: string
    message: string
    now: string
    payload: unknown
    sequence: number
    type: ApplicationAttemptStep['type']
    workflowRunId: string
  },
) {
  database
    .insert(workflowRunSteps)
    .values({
      id: randomUUID(),
      workflowRunId,
      sequence,
      type,
      message,
      payloadJson: JSON.stringify(payload),
      actor,
      createdAt: now,
    })
    .run()
}

export function hasActiveApplicationAttempt(database: MutationDatabase, applicationId: string) {
  return Boolean(
    database
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.subjectApplicationId, applicationId),
          eq(workflowRuns.runType, 'application_attempt'),
          eq(workflowRuns.status, 'in_progress'),
        ),
      )
      .get(),
  )
}

export function upsertApplicationWorkflowState(
  database: MutationDatabase,
  {
    applicationId,
    now,
    patch,
  }: {
    applicationId: string
    now: string
    patch: {
      blockerReason?: string | null
      holdStartedAt?: string | null
      lockStartedAt?: string | null
      manualReviewKind?: string | null
      missingUserInfo?: string | null
    }
  },
) {
  const existing = database
    .select()
    .from(applicationWorkflowStates)
    .where(eq(applicationWorkflowStates.applicationId, applicationId))
    .get()

  if (existing) {
    database
      .update(applicationWorkflowStates)
      .set({
        ...patch,
        updatedAt: now,
      })
      .where(eq(applicationWorkflowStates.applicationId, applicationId))
      .run()
    return
  }

  database
    .insert(applicationWorkflowStates)
    .values({
      applicationId,
      lockStartedAt: patch.lockStartedAt ?? null,
      holdStartedAt: patch.holdStartedAt ?? null,
      manualReviewKind: patch.manualReviewKind ?? null,
      missingUserInfo: patch.missingUserInfo ?? null,
      blockerReason: patch.blockerReason ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

export function selectApplicationAttemptById(
  database: MutationDatabase,
  attemptId: string,
): ApplicationAttempt | null {
  const row = database
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, attemptId), eq(workflowRuns.runType, 'application_attempt')))
    .get()

  if (!row) {
    return null
  }

  const steps = selectApplicationAttemptSteps(database, attemptId)

  return mapApplicationAttempt(row, steps)
}

export function selectApplicationAttemptSteps(database: MutationDatabase, attemptId: string) {
  return database
    .select()
    .from(workflowRunSteps)
    .where(eq(workflowRunSteps.workflowRunId, attemptId))
    .orderBy(asc(workflowRunSteps.sequence))
    .all()
}

export function validateVerificationReceiptForOutcome(
  database: MutationDatabase,
  attemptId: string,
  outcome: string,
) {
  if (outcome !== 'submitted' && outcome !== 'ready_for_review') {
    return
  }

  const receipt = latestVerificationReceipt(database, attemptId)

  if (outcome === 'submitted' && !isPassedFinalReviewReceipt(receipt)) {
    throw new Error('submitted attempts require a passed final-review verification receipt')
  }

  if (outcome === 'ready_for_review' && !isFinalReviewReceipt(receipt)) {
    throw new Error('ready_for_review attempts require a final-review verification receipt')
  }
}

export function latestVerificationReceipt(database: MutationDatabase, attemptId: string) {
  const step = database
    .select()
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.workflowRunId, attemptId),
        eq(workflowRunSteps.type, 'verification_receipt'),
      ),
    )
    .orderBy(desc(workflowRunSteps.sequence))
    .get()

  if (!step) {
    return null
  }

  try {
    return JSON.parse(step.payloadJson) as unknown
  } catch {
    return null
  }
}

export function isFinalReviewReceipt(value: unknown) {
  if (!isRecord(value) || value.scope !== 'final_review') {
    return false
  }

  if (value.status !== 'passed' && value.status !== 'failed') {
    return false
  }

  if (typeof value.evidence !== 'string' || !value.evidence.trim()) {
    return false
  }

  if (!Array.isArray(value.verified) || !Array.isArray(value.unresolved)) {
    return false
  }

  return value.status === 'passed' || hasNonEmptyString(value.unresolved)
}

export function isPassedFinalReviewReceipt(value: unknown) {
  return (
    isFinalReviewReceipt(value) &&
    isRecord(value) &&
    value.status === 'passed' &&
    Array.isArray(value.verified) &&
    hasNonEmptyString(value.verified)
  )
}

export function hasNonEmptyString(values: unknown[]) {
  return values.some((value) => typeof value === 'string' && value.trim())
}

export function mapApplicationAttempt(
  row: ApplicationAttemptRow,
  steps: Array<typeof workflowRunSteps.$inferSelect>,
): ApplicationAttempt {
  const metadata = parseAttemptMetadata(row.metadataJson)

  return {
    id: row.id,
    applicationId: row.subjectApplicationId ?? '',
    status: row.status as ApplicationAttempt['status'],
    outcome: row.outcome as ApplicationAttempt['outcome'],
    actorType: row.actorType as ApplicationAttempt['actorType'],
    actorName: row.actorName,
    entryUrl: metadata.entryUrl,
    resumeVariant: metadata.resumeVariant,
    resumeArtifactPath: metadata.resumeArtifactPath,
    summary: row.summary,
    stopReason: metadata.stopReason,
    confirmationUrl: metadata.confirmationUrl,
    confirmationText: metadata.confirmationText,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    steps: steps.map((step) => mapApplicationAttemptStep(step, row.subjectApplicationId ?? '')),
  }
}

export function mapApplicationAttemptStep(
  row: typeof workflowRunSteps.$inferSelect,
  applicationId: string,
): ApplicationAttemptStep {
  return {
    id: row.id,
    attemptId: row.workflowRunId,
    applicationId,
    sequence: row.sequence,
    type: row.type as ApplicationAttemptStep['type'],
    message: row.message,
    payloadJson: row.payloadJson,
    actor: row.actor,
    createdAt: row.createdAt,
  }
}

export function parseAttemptMetadata(metadataJson: string) {
  const fallback = {
    entryUrl: null,
    resumeVariant: null,
    resumeArtifactPath: null,
    stopReason: null,
    confirmationUrl: null,
    confirmationText: null,
  }

  try {
    const parsed = JSON.parse(metadataJson) as Partial<typeof fallback>

    return {
      entryUrl: typeof parsed.entryUrl === 'string' ? parsed.entryUrl : null,
      resumeVariant: typeof parsed.resumeVariant === 'string' ? parsed.resumeVariant : null,
      resumeArtifactPath:
        typeof parsed.resumeArtifactPath === 'string' ? parsed.resumeArtifactPath : null,
      stopReason: typeof parsed.stopReason === 'string' ? parsed.stopReason : null,
      confirmationUrl: typeof parsed.confirmationUrl === 'string' ? parsed.confirmationUrl : null,
      confirmationText:
        typeof parsed.confirmationText === 'string' ? parsed.confirmationText : null,
    }
  } catch {
    return fallback
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function attemptActor(actorType: string, actorName?: string | null) {
  return actorName ? `${actorType}:${actorName}` : actorType
}
