import {
  captureCompletionDetailSchema,
  captureCompletionDetailV2Schema,
  captureListPresentationSchema,
  captureResolutionGenerationProjectionSchema,
  captureResolutionGenerationProjectionV2Schema,
  completeCaptureManuallyResultSchema,
  createCaptureInputSchema,
  jobFactsSchema,
  jobFactsV2Schema,
  jobIdSchema,
  processingIssueSchema,
  type CaptureCompletionDetail,
  type CaptureCompletionDetailV2,
  type CaptureListPresentation,
  type CapturePrimaryIntent,
  type CaptureResolutionGenerationProjection,
  type CaptureResolutionGenerationProjectionV2,
  type ProcessingIssue,
} from '@sparxie/sdk'
import { validateDestinationUrl } from './destination-url-safety.js'

export interface ResolutionHeadRow {
  readonly captureId: string
  readonly captureRevision: number
  readonly observedAt: string
  readonly adapterId: string
  readonly adapterKind: string
  readonly providerRecordId: string | null
  readonly removedAt: string | null
  readonly effectiveInputJson: string | null
  readonly evidenceOriginsJson: string | null
  readonly materializationIssueMessage: string | null
  readonly connectorInstanceId: string | null
  readonly generationId: string | null
  readonly generationOrdinal: number | null
  readonly generationTrigger: string | null
  readonly generationStatus: string | null
  readonly processingSummary: string | null
  readonly generationCreatedAt: string | null
  readonly generationUpdatedAt: string | null
}

export interface ResolutionStageRow {
  readonly generationId: string
  readonly stage: string
  readonly captureRevision: number
  readonly status: string
  readonly attemptCount: number
  readonly issueJson: string | null
  readonly resultJson: string
  readonly nextAttemptAt: string | null
  readonly resolverId: string | null
  readonly resolverVersion: string | null
  readonly remoteOperationId: string | null
  readonly updatedAt: string
}

export interface ResolutionLinkedJob {
  readonly id: string
  readonly factsJson: string
}

export function toCaptureResolutionProjection(
  row: ResolutionHeadRow,
  stages: readonly ResolutionStageRow[],
) {
  if (row.removedAt !== null) {
    return {
      readiness: 'removed' as const,
      captureId: row.captureId,
      captureRevision: row.captureRevision,
      generation: null,
    }
  }
  if (row.materializationIssueMessage !== null) {
    return {
      readiness: 'materialization_blocked' as const,
      captureId: row.captureId,
      captureRevision: row.captureRevision,
      issue: {
        code: 'revision_materialization_failed' as const,
        action: 'correct_capture' as const,
        message: row.materializationIssueMessage,
      },
    }
  }
  if (row.effectiveInputJson === null || row.generationId === null) {
    return {
      readiness: 'materialization_pending' as const,
      captureId: row.captureId,
      captureRevision: row.captureRevision,
      issue: null,
    }
  }
  return {
    readiness: 'ready' as const,
    captureId: row.captureId,
    captureRevision: row.captureRevision,
    generation: toGeneration(row, stages),
  }
}

export function toCaptureListPresentation(
  row: ResolutionHeadRow,
  stages: readonly ResolutionStageRow[],
  linkedJob: ResolutionLinkedJob | null,
): CaptureListPresentation {
  const projection = toCaptureResolutionProjection(row, stages)
  const effective = parseEffective(row.effectiveInputJson)
  const lead = deriveLead(effective)
  const generation = projection.readiness === 'ready'
    ? projection.generation
    : null
  const destinationStage = stages.find((stage) => stage.stage === 'destination')
  const linked = linkedJob ? linkedJobPresentation(linkedJob) : null
  return captureListPresentationSchema.parse({
    captureId: row.captureId,
    captureRevision: row.captureRevision,
    observedAt: row.observedAt,
    lead,
    source: {
      displayName: sourceDisplayName(row.adapterId),
      provider: row.adapterId,
    },
    destination: {
      state: listDestinationState(
        projection.readiness,
        destinationStage?.status ?? null,
      ),
      displayHost: destinationHost(destinationStage?.resultJson ?? null),
    },
    readiness: projection.readiness,
    processingSummary: generation?.processingSummary ?? null,
    activeProcessing: generation?.processingSummary === 'processing'
      || generation?.processingSummary === 'retrying',
    linkedJob: linked,
    primaryIntent: primaryIntent({
      connectorInstanceId: row.connectorInstanceId,
      linkedJob: linked,
      projection,
      stages,
    }),
  })
}

export function toCaptureCompletionDetail(
  row: ResolutionHeadRow,
  stages: readonly ResolutionStageRow[],
  linkedJob: ResolutionLinkedJob | null,
): CaptureCompletionDetail {
  const projection = toCaptureResolutionProjection(row, stages)
  if (projection.readiness !== 'ready') {
    throw Object.assign(new Error('Capture completion detail is not ready.'), {
      statusCode: 409,
    })
  }
  const destination = stages.find((stage) => stage.stage === 'destination')
  if (!destination || ![
    'not_required',
    'resolved',
    'action_required',
    'exhausted',
    'blocked',
  ].includes(destination.status)) {
    throw Object.assign(new Error('Capture destination is still processing.'), {
      statusCode: 409,
    })
  }
  const effective = parseEffective(row.effectiveInputJson)
  const evidenceOrigins = parseEvidenceOrigins(
    row.evidenceOriginsJson,
    effective?.evidence.length ?? 0,
  )
  if (!effective || !evidenceOrigins) {
    throw Object.assign(new Error('Capture materialization is invalid.'), {
      statusCode: 409,
    })
  }
  const destinationUrl = destinationUrlFromResult(destination.resultJson)
  const lead = deriveLead(effective)
  const lastIssue = currentIssue(stages)
  const provenance: CaptureCompletionDetail['provenance'] = [{
    kind: 'source',
    label: sourceDisplayName(row.adapterId),
    url: null,
  }]
  if (destinationUrl) {
    provenance.push({
      kind: 'destination',
      label: destinationHost(destination.resultJson) ?? destinationUrl,
      url: destinationUrl,
    })
  }
  if (linkedJob) {
    provenance.push({ kind: 'job', label: linkedJob.id, url: null })
  }
  const jobDefaults = jobFactsSchema.partial().strict().parse({
    ...(lead.roleTitle ? { roleTitle: lead.roleTitle } : {}),
    ...(lead.companyName ? { companyName: lead.companyName } : {}),
    sourceName: sourceDisplayName(row.adapterId),
  })
  return captureCompletionDetailSchema.parse({
    captureId: row.captureId,
    captureRevision: row.captureRevision,
    expectedGenerationId: projection.generation.status === 'active'
      ? projection.generation.id
      : null,
    sourceSummary: {
      displayName: sourceDisplayName(row.adapterId),
      provider: row.adapterId,
      observedAt: row.observedAt,
    },
    provenance,
    destination: {
      status: destination.status,
      url: destinationUrl,
    },
    rawEvidence: effective.evidence.map((item, index) => ({
      captureRevision: evidenceOrigins[index]!.captureRevision,
      evidenceIndex: evidenceOrigins[index]!.evidenceIndex,
      label: item.label,
      displayValue: displayEvidenceValue(item.value),
    })),
    exactEvidenceReferences: groupEvidenceReferences(row.captureId, evidenceOrigins),
    jobDefaults,
    lastIssue,
  })
}

export function toCaptureResolutionProjectionV2(
  row: ResolutionHeadRow,
  stages: readonly ResolutionStageRow[],
) {
  const projection = toCaptureResolutionProjection(row, stages)
  if (projection.readiness !== 'ready') return projection
  return {
    ...projection,
    generation: toGenerationV2(row, stages),
  }
}

export function toCaptureCompletionDetailV2(
  row: ResolutionHeadRow,
  stages: readonly ResolutionStageRow[],
  linkedJob: ResolutionLinkedJob | null,
): CaptureCompletionDetailV2 {
  const detail = toCaptureCompletionDetail(row, stages, linkedJob)
  const destination = stages.find((stage) => stage.stage === 'destination')
  const providerStatus = providerStatusFromResult(destination?.resultJson ?? null)
  const jobDestination = detail.jobDefaults.destination
  return captureCompletionDetailV2Schema.parse({
    ...detail,
    destination: {
      ...detail.destination,
      ...(detail.destination.status === 'resolved' && providerStatus
        ? { providerStatus }
        : {}),
    },
    jobDefaults: {
      ...detail.jobDefaults,
      ...(jobDestination ? { destination: { url: jobDestination.url } } : {}),
    },
  })
}

function toGeneration(
  row: ResolutionHeadRow,
  stages: readonly ResolutionStageRow[],
): CaptureResolutionGenerationProjection {
  if (
    row.generationId === null
    || row.generationOrdinal === null
    || row.generationTrigger === null
    || row.generationStatus === null
    || row.processingSummary === null
    || row.generationCreatedAt === null
    || row.generationUpdatedAt === null
  ) {
    throw new Error('Capture generation row is incomplete.')
  }
  const destination = requireStage(stages, 'destination')
  const information = requireStage(stages, 'information')
  const promotion = requireStage(stages, 'promotion')
  return captureResolutionGenerationProjectionSchema.parse({
    id: row.generationId,
    ordinal: row.generationOrdinal,
    trigger: row.generationTrigger,
    status: row.generationStatus,
    processingSummary: row.processingSummary,
    destinationResolution: {
      ...stageBase(destination),
      status: destination.status,
      currentIssue: parseIssue(destination.issueJson),
      nextAttemptAt: destination.nextAttemptAt,
      resolverId: destination.resolverId,
      resolverVersion: destination.resolverVersion,
      remoteOperationId: destination.remoteOperationId,
    },
    jobInformationResolution: {
      ...stageBase(information),
      status: information.status,
      currentIssue: parseIssue(information.issueJson),
    },
    promotion: {
      ...stageBase(promotion),
      status: promotion.status,
      currentIssue: parseIssue(promotion.issueJson),
    },
    createdAt: row.generationCreatedAt,
    updatedAt: row.generationUpdatedAt,
  })
}

function toGenerationV2(
  row: ResolutionHeadRow,
  stages: readonly ResolutionStageRow[],
): CaptureResolutionGenerationProjectionV2 {
  const generation = toGeneration(row, stages)
  const destination = requireStage(stages, 'destination')
  const providerStatus = providerStatusFromResult(destination.resultJson)
  return captureResolutionGenerationProjectionV2Schema.parse({
    ...generation,
    destinationResolution: {
      ...generation.destinationResolution,
      ...(generation.destinationResolution.status === 'resolved' && providerStatus
        ? { providerStatus }
        : {}),
    },
  })
}

function stageBase(stage: ResolutionStageRow) {
  return {
    generationId: stage.generationId,
    captureRevision: stage.captureRevision,
    updatedAt: stage.updatedAt,
    attemptCount: stage.attemptCount,
  }
}

function requireStage(stages: readonly ResolutionStageRow[], stage: string) {
  const row = stages.find((candidate) => candidate.stage === stage)
  if (!row) throw new Error(`Capture generation is missing its ${stage} stage.`)
  return row
}

function primaryIntent(input: {
  readonly connectorInstanceId: string | null
  readonly linkedJob: CaptureListPresentation['linkedJob']
  readonly projection: ReturnType<typeof toCaptureResolutionProjection>
  readonly stages: readonly ResolutionStageRow[]
}): CapturePrimaryIntent | null {
  const { connectorInstanceId, linkedJob, projection, stages } = input
  if (projection.readiness === 'materialization_blocked') {
    return { kind: 'correct_capture' }
  }
  if (projection.readiness !== 'ready') return null
  if (linkedJob) return { kind: 'view_job', jobId: linkedJob.jobId }
  const issue = currentIssueFromGeneration(projection.generation)
  if (issue?.action === 'authenticate_provider' && connectorInstanceId) {
    return { kind: 'authenticate_provider', connectorInstanceId }
  }
  if (issue?.action === 'correct_capture') return { kind: 'correct_capture' }
  if (issue?.action === 'retry_now') return { kind: 'retry_now' }
  if (issue?.action === 'resolve_company') return { kind: 'resolve_company' }
  const completionBlocker = manualCompletionBlocker(stages)
  if (issue?.action === 'resolve_company_assignment' && completionBlocker?.status === 'company_assignment_blocked') {
    return {
      kind: 'resolve_company_assignment',
      jobId: completionBlocker.existingJobId,
      currentCompanyId: completionBlocker.currentCompanyId,
    }
  }
  if (issue?.action === 'resolve_duplicate_job' && completionBlocker?.status === 'duplicate_blocked') {
    return {
      kind: 'resolve_duplicate_job',
      conflictingJobIds: completionBlocker.conflictingJobs.map((job) => job.jobId),
      supportedActions: completionBlocker.allowedDecisions,
    }
  }
  if (issue?.action === 'complete_job_information') {
    return { kind: 'complete_job_information' }
  }
  if (projection.generation.processingSummary === 'awaiting_information') {
    return { kind: 'complete_job_information' }
  }
  return null
}

function manualCompletionBlocker(stages: readonly ResolutionStageRow[]) {
  const promotion = stages.find((stage) => stage.stage === 'promotion')
  if (!promotion) return null
  try {
    const parsed = completeCaptureManuallyResultSchema.safeParse(JSON.parse(promotion.resultJson))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function currentIssueFromGeneration(
  generation: CaptureResolutionGenerationProjection,
) {
  return generation.promotion.currentIssue
    ?? generation.destinationResolution.currentIssue
    ?? generation.jobInformationResolution.currentIssue
}

function currentIssue(stages: readonly ResolutionStageRow[]) {
  const ordered = ['promotion', 'destination', 'information']
  for (const stageName of ordered) {
    const stage = stages.find((candidate) => candidate.stage === stageName)
    const issue = parseIssue(stage?.issueJson ?? null)
    if (issue) return issue
  }
  return null
}

function parseIssue(value: string | null): ProcessingIssue | null {
  if (value === null) return null
  try {
    const parsed = processingIssueSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function listDestinationState(
  readiness: string,
  status: string | null,
): CaptureListPresentation['destination']['state'] {
  if (readiness === 'materialization_blocked') return 'blocked'
  if (readiness !== 'ready' || status === null) return 'unavailable'
  if (status === 'not_required') return 'not_required'
  if (['queued', 'running', 'retry_wait'].includes(status)) return 'resolving'
  if (status === 'resolved') return 'resolved'
  if (status === 'blocked') return 'blocked'
  return 'unavailable'
}

function linkedJobPresentation(job: ResolutionLinkedJob) {
  try {
    const value = JSON.parse(job.factsJson)
    const facts = jobFactsV2Schema.safeParse(value).data ?? jobFactsSchema.parse(value)
    return {
      jobId: jobIdSchema.parse(job.id),
      roleTitle: facts.roleTitle,
      companyName: facts.companyName,
    }
  } catch {
    return null
  }
}

function deriveLead(effective: ReturnType<typeof parseEffective>) {
  const roleTitle = findEvidenceText(effective, ['role', 'title', 'job'])
    ?? findPayloadText(effective?.payload, ['roleTitle', 'jobTitle', 'title', 'role'])
  const companyName = findEvidenceText(effective, ['company', 'employer'])
    ?? findPayloadText(effective?.payload, ['companyName', 'employerName', 'company', 'employer'])
  return {
    roleTitle,
    companyName,
    fallbackLabel: roleTitle ?? companyName ?? 'Captured lead',
  }
}

function findEvidenceText(
  effective: ReturnType<typeof parseEffective>,
  signals: readonly string[],
) {
  for (const item of effective?.evidence ?? []) {
    const key = `${item.kind} ${item.label}`.toLowerCase()
    if (!signals.some((signal) => key.includes(signal))) continue
    const value = textValue(item.value)
    if (value) return value
  }
  return null
}

function findPayloadText(value: unknown, keys: readonly string[]): string | null {
  if (!isRecord(value)) return null
  for (const key of keys) {
    const candidate = value[key]
    const text = textValue(candidate)
    if (text) return text
  }
  return null
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') return boundedText(value)
  if (!isRecord(value)) return null
  for (const key of ['name', 'title', 'label', 'value']) {
    if (typeof value[key] === 'string') return boundedText(value[key])
  }
  return null
}

function boundedText(value: string) {
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.slice(0, 500)
}

function parseEffective(value: string | null) {
  if (value === null) return null
  try {
    const parsed = createCaptureInputSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function parseEvidenceOrigins(value: string | null, expectedLength: number) {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value)
    if (
      !Array.isArray(parsed)
      || parsed.length !== expectedLength
      || parsed.some((origin) => (
        !isRecord(origin)
        || typeof origin.captureRevision !== 'number'
        || !Number.isInteger(origin.captureRevision)
        || origin.captureRevision <= 0
        || typeof origin.evidenceIndex !== 'number'
        || !Number.isInteger(origin.evidenceIndex)
        || origin.evidenceIndex < 0
      ))
    ) {
      return null
    }
    return parsed as Array<{ captureRevision: number; evidenceIndex: number }>
  } catch {
    return null
  }
}

function groupEvidenceReferences(
  captureId: string,
  origins: readonly { captureRevision: number; evidenceIndex: number }[],
) {
  const grouped = new Map<number, number[]>()
  for (const origin of origins) {
    const indexes = grouped.get(origin.captureRevision) ?? []
    indexes.push(origin.evidenceIndex)
    grouped.set(origin.captureRevision, indexes)
  }
  return [...grouped].map(([captureRevision, evidenceIndexes]) => ({
    captureId,
    captureRevision,
    evidenceIndexes,
  }))
}

function sourceDisplayName(adapterId: string) {
  const label = adapterId
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return (label || adapterId).slice(0, 500)
}

function destinationUrlFromResult(value: string | null) {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value)
    if (!isRecord(parsed) || typeof parsed.url !== 'string') return null
    // Parsing validates structure only. Return the exact stored evidence; the
    // shared policy deliberately never upgrades, canonicalizes, or strips bytes.
    return validateDestinationUrl(parsed.url).ok ? parsed.url : null
  } catch {
    return null
  }
}

function providerStatusFromResult(value: string | null) {
  if (value === null) return undefined
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) && (parsed.providerStatus === 'closed' || parsed.providerStatus === 'hidden')
      ? parsed.providerStatus
      : undefined
  } catch {
    return undefined
  }
}

function destinationHost(value: string | null) {
  const url = destinationUrlFromResult(value)
  return url ? new URL(url).hostname.slice(0, 253) : null
}

function displayEvidenceValue(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 4000)
  try {
    return JSON.stringify(value).slice(0, 4000)
  } catch {
    return '[Unavailable]'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
