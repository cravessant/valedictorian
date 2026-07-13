export function formatHumanOutput(value: unknown) {
  return `${formatValue(value)}\n`
}

function formatValue(value: unknown): string {
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

  if (Array.isArray(record.items)) {
    return formatList(record)
  }

  if (record.finding && record.application) {
    return formatPromotion(record)
  }

  if (record.run && Array.isArray(record.findings)) {
    return formatSourcingBatch(record)
  }

  if (Array.isArray(record.receipts) && record.receipts.every(isRawSourcingReceipt)) {
    return formatRawSourcingReceipts(record.receipts)
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

function formatRawSourcingReceipts(receipts: unknown[]) {
  const lines = [`${receipts.length} raw sourcing receipt${receipts.length === 1 ? '' : 's'}`]
  for (const [index, value] of receipts.entries()) {
    const receipt = value as Record<string, unknown>
    const intake = receipt.intake as Record<string, unknown>
    const submitted = receipt.submitted as Record<string, unknown>
    const adapter = submitted.adapter as Record<string, unknown>
    const origin = isPlainRecord(submitted.reportedOrigin) ? submitted.reportedOrigin : undefined
    const revision = intake.revision as Record<string, unknown>
    const occurrence = intake.occurrence as Record<string, unknown>
    const normalization = receipt.normalization as Record<string, unknown>
    const normalizationResult = isPlainRecord(normalization.result) ? normalization.result : undefined
    const normalizationError = isPlainRecord(normalization.error) ? normalization.error : undefined
    const gate = isPlainRecord(normalizationResult?.gate) ? normalizationResult.gate : undefined
    const candidate = isPlainRecord(normalizationResult?.canonicalCandidate)
      ? normalizationResult.canonicalCandidate
      : undefined
    const projection = receipt.projection as Record<string, unknown>
    const projectionResult = isPlainRecord(projection.result) ? projection.result : undefined
    const projectionError = isPlainRecord(projection.error) ? projection.error : undefined
    const finding = isPlainRecord(projectionResult?.finding) ? projectionResult.finding : undefined
    const failure = isPlainRecord(projectionResult?.failure) ? projectionResult.failure : undefined
    lines.push(`Receipt ${index + 1}`)
    lines.push(`  Provenance (submitted): adapter=${String(adapter.id)} kind=${String(adapter.kind)} version=${String(adapter.version)} reportedOrigin=${origin ? `${String(origin.kind)}:${String(origin.name)}` : 'none'}`)
    lines.push(`  Intake: record=${String(intake.rawRecordId)} revision=${String(revision.id)} number=${String(revision.revision)} reused=${String(revision.reused)} occurrence=${String(occurrence.id)}`)
    lines.push(normalizationResult
      ? `  Normalization: status=${String(normalizationResult.status)} revision=${String(normalizationResult.rawRevisionId)} matchesReceipt=${String(normalization.matchesRevision)} gate=${String(gate?.status ?? 'none')} candidate=${String(candidate?.id ?? 'none')}`
      : `  Normalization inspection: failed code=${String(normalizationError?.code)}${normalizationError?.httpStatus ? ` httpStatus=${String(normalizationError.httpStatus)}` : ''}`)
    lines.push(projectionResult
      ? `  Projection: status=${String(projectionResult.status)} revision=${String(projectionResult.rawRevisionId)}${finding ? ` finding=${String(finding.id)} merge=${String(finding.mergeStatus)}` : ''}${failure ? ` failure=${String(failure.code)} retryable=${String(failure.retryable)}` : ''}`
      : `  Projection inspection: failed code=${String(projectionError?.code)}${projectionError?.httpStatus ? ` httpStatus=${String(projectionError.httpStatus)}` : ''}`)
  }
  return lines.join('\n')
}

function isRawSourcingReceipt(value: unknown) {
  return isPlainRecord(value) && isPlainRecord(value.intake) && isPlainRecord(value.normalization) && isPlainRecord(value.projection)
}

function formatList(record: Record<string, unknown>) {
  const items = record.items as unknown[]
  const total = typeof record.total === 'number' ? record.total : items.length
  const limit = typeof record.limit === 'number' ? record.limit : undefined
  const offset = typeof record.offset === 'number' ? record.offset : undefined
  const hasMore = typeof record.hasMore === 'boolean' ? record.hasMore : undefined
  const headerParts = [`${total} item${total === 1 ? '' : 's'}`]

  if (limit !== undefined || offset !== undefined) {
    headerParts.push(`limit ${limit ?? '?'}`)
    headerParts.push(`offset ${offset ?? 0}`)
  }

  if (hasMore !== undefined) {
    headerParts.push(hasMore ? 'more available' : 'end reached')
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

function formatItems(items: unknown[]) {
  const lines = [`${items.length} item${items.length === 1 ? '' : 's'}`]

  if (items.length > 0) {
    lines.push(...items.map((item) => `- ${summarizeItem(item)}`))
  }

  return lines.join('\n')
}

function formatPromotion(record: Record<string, unknown>) {
  const finding = isPlainRecord(record.finding) ? record.finding : undefined
  const application = isPlainRecord(record.application) ? record.application : undefined
  const findingId = primitiveString(finding?.id) ?? 'finding'
  const applicationId = primitiveString(application?.id) ?? 'application'

  return [
    `Promoted ${findingId} to ${applicationId}`,
    finding ? `Finding: ${summarizeItem(finding)}` : undefined,
    application ? `Application: ${summarizeItem(application)}` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function formatSourcingBatch(record: Record<string, unknown>) {
  const processedCount = primitiveString(record.processedCount) ?? '0'
  const failureCount = primitiveString(record.failureCount) ?? '0'
  const run = isPlainRecord(record.run) ? record.run : undefined
  const findings = Array.isArray(record.findings) ? record.findings : []
  const lines = [
    `Processed ${processedCount} sourcing candidate${processedCount === '1' ? '' : 's'} with ${failureCount} failure${failureCount === '1' ? '' : 's'}.`,
  ]

  if (run) {
    lines.push(`Run: ${summarizeItem(run)}`)
  }

  if (findings.length > 0) {
    lines.push('Findings:')
    lines.push(...findings.map((finding) => `- ${summarizeItem(finding)}`))
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
  const priorityScore = primitiveString(value.priorityScore)
  const priorityBand = primitiveString(value.priorityBand)
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
