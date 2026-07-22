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
