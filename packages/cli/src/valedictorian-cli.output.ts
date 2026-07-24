import {
  formatCompanyHumanOutput,
  type CompanyCollectionOutput,
} from './valedictorian-cli.company-output.js'

export type HumanOutputOptions = {
  companyCollection?: CompanyCollectionOutput
}

export function formatHumanOutput(value: unknown, options: HumanOutputOptions = {}) {
  return `${formatValue(value, options)}\n`
}

function formatValue(value: unknown, options: HumanOutputOptions): string {
  if (value === null || value === undefined) {
    return 'No result'
  }

  if (typeof value !== 'object') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return formatItems(value)
  }

  const record = value as Record<string, unknown>

  if (isOkOnly(record)) {
    return 'OK'
  }

  const resolutionOutput = formatResolutionOutput(record)
  if (resolutionOutput) return resolutionOutput

  const companyOutput = formatCompanyHumanOutput(record, options.companyCollection)
  if (companyOutput) return companyOutput

  if (Array.isArray(record.items)) {
    return formatList(record)
  }

  if (isLifecycleResult(record)) {
    return formatLifecycleResult(record)
  }

  if (isConnectorRun(record)) {
    return formatConnectorRun(record)
  }

  return formatRecord(record)
}

function isConnectorRun(record: Record<string, unknown>) {
  return (
    typeof record.connectorInstanceId === 'string' &&
    isPlainRecord(record.newestFrontier) &&
    isPlainRecord(record.historicalBackfill) &&
    isPlainRecord(record.outcome)
  )
}

function formatConnectorRun(record: Record<string, unknown>) {
  const outcome = record.outcome as Record<string, unknown>
  const newest = record.newestFrontier as Record<string, unknown>
  const backfill = record.historicalBackfill as Record<string, unknown>
  const operation = isPlainRecord(outcome.operation) ? outcome.operation : undefined
  const lines = [
    `Connector run ${String(record.id)} - status=${String(record.status)}`,
    `Synchronization: ${connectorSynchronizationLabel(record, outcome)}`,
    `Newest frontier: ${String(newest.state)}`,
    `Historical backfill: ${String(backfill.state)}`,
    `Pending link resolution: ${String(record.pendingResolutionCount)}`,
  ]

  if (outcome.kind === 'cooling_down' && operation?.retryAt) {
    lines.push(`Next attempt: ${String(operation.retryAt)}`)
  }

  if (outcome.kind === 'yielded') {
    lines.push(`Yield reason: ${String(outcome.reason)}`)
  }

  return lines.join('\n')
}

function connectorSynchronizationLabel(
  record: Record<string, unknown>,
  outcome: Record<string, unknown>,
) {
  if (outcome.kind === 'cooling_down') return 'Provider cooling down'
  if (outcome.kind === 'action_required') return 'Authentication required'
  if (outcome.kind === 'caught_up') return 'Caught up'
  if (outcome.kind === 'boundary_exhausted') return 'Boundary exhausted'
  if (outcome.kind === 'yielded') return 'Execution yielded'
  if (outcome.kind === 'in_progress' && Number(record.pendingResolutionCount) > 0) {
    return 'Resolving pending links'
  }
  const newest = record.newestFrontier as Record<string, unknown>
  if (outcome.kind === 'in_progress' && newest.state === 'advancing') {
    return 'Checking newest jobs'
  }
  const backfill = record.historicalBackfill as Record<string, unknown>
  if (outcome.kind === 'in_progress' && backfill.state === 'advancing') {
    return 'Backfilling historical jobs'
  }
  return String(outcome.kind).replace(/_/g, ' ')
}

function formatList(record: Record<string, unknown>) {
  const items = record.items as unknown[]
  const total = typeof record.total === 'number' ? record.total : items.length
  const limit = typeof record.limit === 'number' ? record.limit : undefined
  const offset = typeof record.offset === 'number' ? record.offset : undefined
  const hasMore = typeof record.hasMore === 'boolean' ? record.hasMore : undefined
  const hasCursor = Object.prototype.hasOwnProperty.call(record, 'nextCursor')
  const nextCursor = typeof record.nextCursor === 'string' ? record.nextCursor : null
  const headerParts = [`${total} item${total === 1 ? '' : 's'}`]

  if (limit !== undefined) headerParts.push(`limit ${limit}`)
  if (offset !== undefined) headerParts.push(`offset ${offset}`)

  if (hasMore !== undefined) {
    headerParts.push(hasMore ? 'more available' : 'end reached')
  }

  if (hasCursor) {
    headerParts.push(nextCursor === null ? 'end reached' : `next cursor ${nextCursor}`)
  }

  const lines = [headerParts.join(' - ')]

  if (items.length > 0) {
    lines.push(...items.map((item) => `- ${summarizeItem(item)}`))
  }

  if (isPlainRecord(record.actionBucketCounts)) {
    const counts = Object.entries(record.actionBucketCounts)
      .map(([name, count]) => `${name}: ${String(count)}`)
      .join(', ')

    if (counts) {
      lines.push(`Action buckets: ${counts}`)
    }
  }

  return lines.join('\n')
}

function isLifecycleResult(record: Record<string, unknown>) {
  const status = String(record.status)
  if (status === 'blocked') return isPlainRecord(record.blocker)
  if (status === 'promoted' || status === 'succeeded') {
    return isPlainRecord(record.resource) && isPlainRecord(record.audit)
  }
  if (status === 'removed' || status === 'restored') {
    return typeof record.id === 'string' && isPlainRecord(record.audit)
  }
  return false
}

function formatLifecycleResult(record: Record<string, unknown>) {
  const status = String(record.status)
  const blocker = isPlainRecord(record.blocker) ? record.blocker : undefined
  if (status === 'blocked') {
    const lines = [`Blocked: ${String(blocker?.code ?? 'unknown')} - ${String(blocker?.message ?? 'No reason provided')}`]
    if (typeof blocker?.field === 'string') lines.push(`Field: ${blocker.field}`)
    if (typeof blocker?.conflictingResourceId === 'string') {
      lines.push(`Conflicting resource: ${blocker.conflictingResourceId}`)
    }
    if (Array.isArray(blocker?.allowedDuplicateResolutions)) {
      lines.push(`Allowed duplicate resolutions: ${blocker.allowedDuplicateResolutions.join(', ')}`)
    }
    if (Array.isArray(record.supportedChoices)) {
      lines.push(`Supported removal choices: ${record.supportedChoices.join(', ')}`)
    }
    if (Array.isArray(record.dependentIds)) {
      lines.push(`Dependent resources: ${record.dependentIds.join(', ')}`)
    }
    return lines.join('\n')
  }

  const resource = isPlainRecord(record.resource) ? record.resource : undefined
  const id = primitiveString(resource?.id) ?? primitiveString(record.id) ?? 'resource'
  const lines = [`${labelize(status)}: ${id}`]
  if (Array.isArray(record.warnings) && record.warnings.length > 0) {
    lines.push(`Warnings: ${record.warnings.map((warning) => {
      const value = isPlainRecord(warning) ? warning : {}
      const field = typeof value.field === 'string' ? ` [${value.field}]` : ''
      return `${String(value.code)}${field} - ${String(value.message)}`
    }).join('; ')}`)
  }
  if (isPlainRecord(record.duplicateResolution)) {
    lines.push(
      `Duplicate resolution: ${String(record.duplicateResolution.action)} ${String(record.duplicateResolution.targetResourceId)}`,
    )
  }
  return lines.join('\n')
}

function formatResolutionOutput(record: Record<string, unknown>) {
  const status = primitiveString(record.status)
  if (status === 'duplicate_blocked') return formatDuplicateBlocked(record)
  if (status === 'company_assignment_blocked') return formatAssignmentBlocked(record)
  if (status === 'blocked' && isPlainRecord(record.failure)) return formatFailureBlocked(record)
  if (status === 'started' && primitiveString(record.captureId) && primitiveString(record.generationId)) {
    return `Processing started: ${String(record.captureId)} (generation ${String(record.generationId)})`
  }
  if (status === 'created' && primitiveString(record.jobId) && primitiveString(record.companyId)) {
    return `Job ${record.createdJob === true ? 'created' : 'attached'}: ${String(record.jobId)} (company ${String(record.companyId)})`
  }
  if (status === 'merged' && isPlainRecord(record.canonical) && isPlainRecord(record.merged)) {
    const lines = [
      `Company merged: ${formatCompanyMergeIdentity(record.merged)} into ${formatCompanyMergeIdentity(record.canonical)}`,
      `Request revisions: winner=${String(record.requestWinnerCompanyRevision)} loser=${String(record.requestLoserCompanyRevision)}`,
      `Reassigned jobs: ${String(record.reassignedJobCount)}; resolved candidates: ${String(record.resolvedCandidateCount)}`,
    ]
    return lines.join('\n')
  }
  if (primitiveString(record.captureId) && isPlainRecord(record.sourceSummary)) {
    return formatCompletionDetail(record)
  }
  return null
}

function formatDuplicateBlocked(record: Record<string, unknown>) {
  const jobs = Array.isArray(record.conflictingJobs) ? record.conflictingJobs : []
  const decisions = Array.isArray(record.allowedDecisions) ? record.allowedDecisions.join(', ') : 'none'
  const lines = [`Duplicate Job conflict: ${String(record.blockerCode)}`]
  for (const job of jobs) {
    if (!isPlainRecord(job)) continue
    lines.push(
      `- job=${String(job.jobId)} facts-revision=${String(job.jobFactsRevision)} company=${String(job.companyId)} company-revision=${String(job.companyRevision)} assignment-revision=${String(job.assignmentRevision)}`,
    )
  }
  if (jobs.length === 0) lines.push('Conflicting Jobs: none')
  lines.push(`Allowed: ${decisions}`)
  return lines.join('\n')
}

function formatAssignmentBlocked(record: Record<string, unknown>) {
  const lines = [
    `Company assignment conflict: ${String(record.existingJobId)}`,
    `Current Company: ${String(record.currentCompanyId)} (revision ${String(record.currentCompanyRevision)})`,
    `Assignment revision: ${String(record.assignmentRevision)}`,
  ]
  if (Array.isArray(record.allowedRecovery)) lines.push(`Allowed: ${record.allowedRecovery.join(', ')}`)
  return lines.join('\n')
}

function formatFailureBlocked(record: Record<string, unknown>) {
  const failure = record.failure as Record<string, unknown>
  const blocker = isPlainRecord(failure.blocker) ? failure.blocker : {}
  const lines = [`Blocked: ${String(blocker.code ?? 'unknown')} - ${String(blocker.message ?? 'No reason provided')}`]
  const recovery = isPlainRecord(failure.recovery) ? failure.recovery : undefined
  if (recovery?.action) lines.push(`Recovery: ${String(recovery.action)}`)
  if (Array.isArray(recovery?.guards)) {
    for (const guard of recovery.guards) {
      if (isPlainRecord(guard)) lines.push(`Stale guard: ${formatStaleGuard(guard)}`)
    }
  }
  return lines.join('\n')
}

function formatStaleGuard(guard: Record<string, unknown>) {
  const expected = String(guard.expectedRevision ?? guard.expectedGenerationId)
  const current = String(guard.currentRevision ?? guard.currentGenerationId)
  if (guard.kind === 'capture_revision') return `capture revision expected=${expected} current=${current}`
  if (guard.kind === 'generation') return `generation expected=${expected} current=${current}`
  if (guard.kind === 'company_revision') return `company=${String(guard.companyId)} revision expected=${expected} current=${current}`
  if (guard.kind === 'assignment_revision') return `job=${String(guard.jobId)} assignment revision expected=${expected} current=${current}`
  if (guard.kind === 'duplicate_candidate_revision') return `candidate=${String(guard.candidateId)} revision expected=${expected} current=${current}`
  return `kind=${String(guard.kind)} expected=${expected} current=${current}`
}

function formatCompletionDetail(record: Record<string, unknown>) {
  const source = record.sourceSummary as Record<string, unknown>
  const destination = isPlainRecord(record.destination) ? record.destination : {}
  const evidence = Array.isArray(record.rawEvidence) ? record.rawEvidence.length : 0
  const lines = [
    `Capture ${String(record.captureId)} revision ${String(record.captureRevision)}`,
    `Expected generation: ${String(record.expectedGenerationId)}`,
    `Source: ${String(source.displayName)} (${String(source.provider)})`,
    `Destination: ${String(destination.status ?? 'unknown')}`,
    `Evidence items: ${evidence}`,
  ]
  lines.push(...formatExactEvidenceReferences(record.exactEvidenceReferences))
  if (isPlainRecord(record.lastIssue)) {
    lines.push(`Issue: ${String(record.lastIssue.code)}${record.lastIssue.action ? ` (${String(record.lastIssue.action)})` : ''}`)
  }
  return lines.join('\n')
}

function formatCompanyMergeIdentity(company: Record<string, unknown>) {
  return `${String(company.displayName)} id=${String(company.id)} revision=${String(company.revision)} status=${String(company.status)}`
}

function formatExactEvidenceReferences(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return ['Exact evidence references: none']

  const lines = ['Exact evidence references:']
  for (const reference of value.slice(0, 50)) {
    if (!isPlainRecord(reference)) continue
    const indexes = Array.isArray(reference.evidenceIndexes)
      ? reference.evidenceIndexes.slice(0, 50).map(String).join(', ')
      : 'none'
    lines.push(
      `- capture=${String(reference.captureId)} revision=${String(reference.captureRevision)} indexes=${indexes || 'none'}`,
    )
  }
  if (value.length > 50) lines.push(`Showing first 50 references from the contract-bounded result.`)
  return lines
}

function formatItems(items: unknown[]) {
  const lines = [`${items.length} item${items.length === 1 ? '' : 's'}`]

  if (items.length > 0) {
    lines.push(...items.map((item) => `- ${summarizeItem(item)}`))
  }

  return lines.join('\n')
}

function formatRecord(record: Record<string, unknown>) {
  const summary = summarizeItem(record)
  const lines = [summary]
  const detailLines = Object.entries(record)
    .filter(([name, value]) => name !== 'id' && isDisplayablePrimitive(value))
    .map(([name, value]) => `${labelize(name)}: ${String(value)}`)

  if (detailLines.length > 0) {
    lines.push(...detailLines)
  }

  return lines.join('\n')
}

function summarizeItem(value: unknown): string {
  if (!isPlainRecord(value)) {
    return String(value)
  }

  if (isConnectorRun(value)) {
    return `Connector run ${String(value.id)} - ${connectorSynchronizationLabel(
      value,
      value.outcome as Record<string, unknown>,
    )}`
  }

  const id = primitiveString(value.id)
  const status = primitiveString(value.status)
  const mergeStatus = primitiveString(value.mergeStatus)
  const companyName = primitiveString(value.companyName)
  const roleTitle = primitiveString(value.roleTitle)
  const runType = primitiveString(value.runType)
  const sourceName = primitiveString(value.sourceName)
  const sequence = primitiveString(value.sequence)
  const type = primitiveString(value.type)
  const message = primitiveString(value.message)
  const label = primitiveString(value.label)
  const url = primitiveString(value.url)
  const priorityScore =
    primitiveString(value.priorityScore) ?? primitiveString(value.currentPriorityScore)
  const priorityBand =
    primitiveString(value.priorityBand) ?? primitiveString(value.currentPriorityBand)
  const applicationId = primitiveString(value.applicationId)
  const mergedApplicationId = primitiveString(value.mergedApplicationId)
  const parts: string[] = []

  if (companyName || roleTitle) {
    parts.push([companyName, roleTitle].filter(Boolean).join(' - '))
  } else if (runType) {
    parts.push(`${runType} run`)
  } else if (type || message) {
    parts.push([sequence ? `step ${sequence}` : undefined, type, message].filter(Boolean).join(' - '))
  } else if (label || url) {
    parts.push([label, url].filter(Boolean).join(' - '))
  } else if (sourceName) {
    parts.push(sourceName)
  }

  if (status) {
    parts.push(`status=${status}`)
  }

  if (mergeStatus) {
    parts.push(`merge=${mergeStatus}`)
  }

  if (priorityScore || priorityBand) {
    parts.push(`priority=${[priorityScore, priorityBand].filter(Boolean).join('/')}`)
  }

  if (mergedApplicationId) {
    parts.push(`application=${mergedApplicationId}`)
  } else if (applicationId && applicationId !== id) {
    parts.push(`application=${applicationId}`)
  }

  if (id) {
    parts.push(`id=${id}`)
  }

  if (parts.length > 0) {
    return parts.join(' - ')
  }

  const displayable = Object.entries(value)
    .filter(([, item]) => isDisplayablePrimitive(item))
    .slice(0, 4)
    .map(([name, item]) => `${labelize(name)}=${String(item)}`)

  return displayable.length > 0 ? displayable.join(' - ') : 'Object result'
}

function isOkOnly(record: Record<string, unknown>) {
  const entries = Object.entries(record)
  return entries.length === 1 && entries[0]?.[0] === 'ok' && entries[0][1] === true
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDisplayablePrimitive(value: unknown) {
  return ['string', 'number', 'boolean'].includes(typeof value)
}

function primitiveString(value: unknown) {
  return isDisplayablePrimitive(value) ? String(value) : undefined
}

function labelize(name: string) {
  return name.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)
}
