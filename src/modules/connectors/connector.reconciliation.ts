import type { JobObservation } from '@sparxie/valedictorian-connectors-core'

type JsonRecord = Record<string, unknown>

export const JOBRIGHT_RAW_FIRST_CHECKPOINT_SCOPE = 'provider-state:jobright.resolver@0.5.0'
export const JOBRIGHT_MIGRATION_SEED_LIMIT = 1_000
export const JOBRIGHT_MIGRATION_SCAN_LIMIT = 10_000

export const JOBRIGHT_RECONCILIATION_GUIDANCE =
  'Jobright connector state could not be upgraded safely. Restore a compatible app version or reconnect Jobright and start a new connector instance.'

export interface ConnectorUpgradeIdentity {
  connectorId: string
  connectorVersion: string
}

type JobrightMigrationObservationCandidate = {
  connectorId: unknown
  connectorVersion: unknown
  parserVersion?: unknown
  observationSchemaVersion?: unknown
  sourceRecordKey: unknown
  observedAt: unknown
  companyName: unknown
  roleTitle: unknown
  locationRaw?: unknown
  descriptionText?: unknown
  pay?: unknown
  links: unknown
  resolution: unknown
  dedupeKeys: unknown
  sourceMetadata?: unknown
  evidence: unknown
}

const jobrightMigrationResolutionStatuses = new Set<JobObservation['resolution']['status']>([
  'resolved',
  'auth_required',
  'closed',
  'hidden',
  'direct_apply',
  'rate_limited',
  'captcha',
  'unresolved',
  'not_supported',
])

export function connectorReconciliationError(): Error {
  return new Error(JOBRIGHT_RECONCILIATION_GUIDANCE)
}

export function isTrustedJobrightUpgrade(
  persisted: ConnectorUpgradeIdentity,
  installed: ConnectorUpgradeIdentity,
): boolean {
  return persisted.connectorId === 'jobright.resolver'
    && (persisted.connectorVersion === '0.4.1' || persisted.connectorVersion === '0.4.3')
    && installed.connectorId === 'jobright.resolver'
    && installed.connectorVersion === '0.5.0'
}

export function validateJobrightCheckpoint(schemaVersion: string, checkpointJson: string): void {
  try {
    const checkpoint = JSON.parse(checkpointJson) as unknown

    if (!isJsonRecord(checkpoint)) {
      throw connectorReconciliationError()
    }

    if (schemaVersion === 'jobright-resolution-checkpoint@2') {
      const requiredCountFields = [
        'attempted',
        'authRequired',
        'discovered',
        'eligible',
        'filtered',
        'rateLimited',
        'resolved',
        'retryableFailures',
        'skipped',
      ] as const
      const permittedKeys = new Set<string>([...requiredCountFields, 'totalAvailable'])
      const requiredCountsValid = requiredCountFields.every((field) =>
        hasOwn(checkpoint, field)
        && isBoundedNonNegativeInteger(checkpoint[field], JOBRIGHT_MIGRATION_SEED_LIMIT))
      const totalAvailableValid = !hasOwn(checkpoint, 'totalAvailable')
        || checkpoint.totalAvailable === null
        || isBoundedNonNegativeInteger(checkpoint.totalAvailable, Number.MAX_SAFE_INTEGER)

      if (
        !Object.keys(checkpoint).every((key) => permittedKeys.has(key))
        || !requiredCountsValid
        || !totalAvailableValid
        || !hasValidJobrightV2CountRelations(checkpoint)
      ) {
        throw connectorReconciliationError()
      }

      return
    }

    if (schemaVersion === 'jobright-resolution-checkpoint@3') {
      validateJobrightV3Checkpoint(checkpoint)
      return
    }

    throw connectorReconciliationError()
  } catch {
    throw connectorReconciliationError()
  }
}

function hasValidJobrightV2CountRelations(checkpoint: JsonRecord): boolean {
  const attempted = Number(checkpoint.attempted)
  const eligible = Number(checkpoint.eligible)
  const filtered = Number(checkpoint.filtered)
  const skipped = Number(checkpoint.skipped)
  const outcomeCount = Number(checkpoint.authRequired)
    + Number(checkpoint.rateLimited)
    + Number(checkpoint.resolved)
    + Number(checkpoint.retryableFailures)

  return attempted <= eligible
    && filtered <= skipped
    && outcomeCount <= Math.max(1, attempted)
}

export function prepareJobrightV2MigrationCheckpoint(
  observations: JobObservation[],
): string {
  const processed = observations.filter(isProcessedJobrightMigrationObservation)
  const resolved = processed.filter(({ resolution }) => resolution.status === 'resolved').length
  const skipped = processed.filter(({ resolution }) =>
    resolution.status === 'closed' || resolution.status === 'hidden').length

  return JSON.stringify({
    attempted: processed.length,
    authRequired: 0,
    discovered: observations.length,
    eligible: observations.length,
    filtered: 0,
    rateLimited: 0,
    resolved,
    retryableFailures: 0,
    skipped,
    totalAvailable: null,
  })
}

export function toJobrightMigrationSeed(
  observation: JobrightMigrationObservationCandidate,
): JobObservation | null {
  try {
    return parseJobrightMigrationSeed(observation)
  } catch {
    return null
  }
}

function parseJobrightMigrationSeed(
  observation: JobrightMigrationObservationCandidate,
): JobObservation | null {
  const links = parseJobrightMigrationLinks(observation.links)
  const resolution = parseJobrightMigrationResolution(observation.resolution)
  const sourceMetadata = observation.sourceMetadata
  const locationRaw = observation.locationRaw
  const descriptionText = observation.descriptionText

  if (
    observation.connectorId !== 'jobright.public'
    || !isNonEmptyBoundedString(observation.connectorVersion, 128)
    || !isNonEmptyBoundedString(observation.parserVersion, 128)
    || !isNonEmptyBoundedString(observation.observationSchemaVersion, 128)
    || typeof observation.sourceRecordKey !== 'string'
    || !/^jobright\.public:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(
      observation.sourceRecordKey,
    )
    || !isCanonicalIsoTimestamp(observation.observedAt)
    || !isBoundedString(observation.companyName, 4_096)
    || !isBoundedString(observation.roleTitle, 4_096)
    || !isOptionalBoundedString(locationRaw, 16_384)
    || !isOptionalBoundedString(descriptionText, 1_000_000)
    || !links
    || !resolution
    || !isBoundedStringArray(observation.dedupeKeys, 1_000, 4_096)
    || !(sourceMetadata === undefined
      || (isPlainJsonRecord(sourceMetadata) && isBoundedJsonValue(sourceMetadata)))
    || !isValidObservationEvidence(observation.evidence)
    || !(observation.pay === undefined || isBoundedJsonValue(observation.pay))
  ) {
    return null
  }

  return {
    connectorId: observation.connectorId,
    connectorVersion: observation.connectorVersion,
    parserVersion: observation.parserVersion,
    observationSchemaVersion: observation.observationSchemaVersion,
    sourceRecordKey: observation.sourceRecordKey,
    observedAt: observation.observedAt,
    companyName: observation.companyName,
    roleTitle: observation.roleTitle,
    ...(locationRaw === undefined ? {} : { locationRaw }),
    ...(descriptionText === undefined ? {} : { descriptionText }),
    ...(observation.pay === undefined ? {} : { pay: observation.pay }),
    links,
    resolution,
    dedupeKeys: observation.dedupeKeys,
    ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
    evidence: observation.evidence,
  }
}

function parseJobrightMigrationLinks(value: unknown): JobObservation['links'] | null {
  if (
    !isPlainJsonRecord(value)
    || !hasExactKeys(value, ['intermediary', 'official', 'source'])
    || !isNullableBoundedString(value.source, 16_384)
    || !isNullableBoundedString(value.intermediary, 16_384)
    || !isNullableBoundedString(value.official, 16_384)
  ) {
    return null
  }

  return {
    source: value.source,
    intermediary: value.intermediary,
    official: value.official,
  }
}

function parseJobrightMigrationResolution(
  value: unknown,
): JobObservation['resolution'] | null {
  if (
    !isPlainJsonRecord(value)
    || !hasExactKeys(value, ['method', 'reason', 'status'])
    || !jobrightMigrationResolutionStatuses.has(
      value.status as JobObservation['resolution']['status'],
    )
    || !isNullableBoundedString(value.method, 512)
    || !isNullableBoundedString(value.reason, 512)
  ) {
    return null
  }

  return {
    status: value.status as JobObservation['resolution']['status'],
    method: value.method,
    reason: value.reason,
  }
}

function isProcessedJobrightMigrationObservation({
  resolution,
}: {
  resolution: { reason: string | null; status: string }
}): boolean {
  if (
    resolution.status === 'auth_required'
    || resolution.status === 'rate_limited'
    || resolution.status === 'captcha'
  ) {
    return false
  }

  if (resolution.status !== 'unresolved') {
    return true
  }

  return ![
    'jobright_resolution_deferred',
    'jobright_detail_retryable',
    'jobright_detail_request_failed',
  ].includes(resolution.reason ?? '')
}

function validateJobrightV3Checkpoint(checkpoint: JsonRecord): void {
  const sourceIdFields = [
    'eligibleSourceIds',
    'processedSourceIds',
    'seenSourceIds',
    'unresolvedSourceIds',
    'usefulEmployerOrAtsSourceIds',
    'usefulThirdPartySourceIds',
  ]

  const knownFields = new Set([
    'attempts',
    'cycleId',
    'cycleStartedAt',
    'discoveryPage',
    'discoveryPages',
    'discoveryPosition',
    'discoveryRecordLimitReached',
    'discoveryRecords',
    'eligibleSourceIds',
    'filtered',
    'horizonAt',
    'lastDiscoveryPageSize',
    'lastDiscoveryRequestCount',
    'processedSourceIds',
    'retryState',
    'seenSourceIds',
    'skipped',
    'stopReason',
    'totalAvailable',
    'unresolvedSourceIds',
    'usefulEmployerOrAts',
    'usefulEmployerOrAtsSourceIds',
    'usefulThirdParty',
    'usefulThirdPartySourceIds',
  ])
  const sourceArraysValid = sourceIdFields.every((field) => {
    const value = checkpoint[field]
    return isCanonicalSourceIdArray(value)
      && value.length <= JOBRIGHT_MIGRATION_SEED_LIMIT
      && new Set(value).size === value.length
  })
  const countersValid = [
    ['attempts', 1_000],
    ['discoveryPage', 100],
    ['discoveryPages', 100],
    ['discoveryPosition', Number.MAX_SAFE_INTEGER - 100],
    ['discoveryRecords', 1_000],
    ['filtered', 1_000],
    ['skipped', 1_000],
    ['usefulEmployerOrAts', 1_000],
    ['usefulThirdParty', 1_000],
  ].every(([field, maximum]) => isBoundedNonNegativeInteger(checkpoint[String(field)], Number(maximum)))
  const lastPageSizeValid = checkpoint.lastDiscoveryPageSize === null
    || isBoundedNonNegativeInteger(checkpoint.lastDiscoveryPageSize, 100)
  const lastRequestCountValid = checkpoint.lastDiscoveryRequestCount === null
    || isBoundedPositiveInteger(checkpoint.lastDiscoveryRequestCount, 100)
  const totalAvailableValid = checkpoint.totalAvailable === null
    || isBoundedNonNegativeInteger(checkpoint.totalAvailable, Number.MAX_SAFE_INTEGER)

  if (
    !Object.keys(checkpoint).every((field) => knownFields.has(field))
    || typeof checkpoint.cycleId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(checkpoint.cycleId)
    || !isCanonicalIsoTimestamp(checkpoint.cycleStartedAt)
    || !isCanonicalIsoTimestamp(checkpoint.horizonAt)
    || checkpoint.discoveryRecordLimitReached !== true
      && checkpoint.discoveryRecordLimitReached !== false
    || !sourceArraysValid
    || !countersValid
    || !lastPageSizeValid
    || !lastRequestCountValid
    || !totalAvailableValid
    || !isValidRetryState(checkpoint.retryState)
    || !isJobrightStopReason(checkpoint.stopReason)
    || checkpoint.usefulEmployerOrAts !== (checkpoint.usefulEmployerOrAtsSourceIds as string[]).length
    || checkpoint.usefulThirdParty !== (checkpoint.usefulThirdPartySourceIds as string[]).length
    || !hasValidJobrightV3Relations(checkpoint)
  ) {
    throw connectorReconciliationError()
  }
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCanonicalSourceIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === 'string'
    && /^jobright\.public:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(item))
}

function isBoundedNonNegativeInteger(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
}

function isBoundedPositiveInteger(value: unknown, maximum: number): boolean {
  return isBoundedNonNegativeInteger(value, maximum) && Number(value) > 0
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function isNonEmptyBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength
}

function isOptionalBoundedString(
  value: unknown,
  maximumLength: number,
): value is string | null | undefined {
  return value === undefined || isNullableBoundedString(value, maximumLength)
}

function isNullableBoundedString(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maximumLength)
}

function isBoundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
): value is string[] {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => isNonEmptyBoundedString(item, maximumItemLength))
    && isBoundedJsonValue(value)
}

function isValidObservationEvidence(value: unknown): value is JobObservation['evidence'] {
  return Array.isArray(value)
    && value.length <= JOBRIGHT_MIGRATION_SEED_LIMIT
    && value.every((entry) => isPlainJsonRecord(entry)
      && hasExactKeys(entry, ['capturedAt', 'sourceUrl', 'type'])
      && isNonEmptyBoundedString(entry.type, 128)
      && isCanonicalIsoTimestamp(entry.capturedAt)
      && isNullableBoundedString(entry.sourceUrl, 16_384))
    && isBoundedJsonValue(value)
}

function hasExactKeys(value: JsonRecord, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value)
  const expected = new Set(expectedKeys)
  return actualKeys.length === expected.size && actualKeys.every((key) => expected.has(key))
}

function isPlainJsonRecord(value: unknown): value is JsonRecord {
  if (!isJsonRecord(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function isBoundedJsonValue(value: unknown, maximumLength = 1_000_000): boolean {
  if (!isJsonSafeValue(value, new Set(), 0, { count: 0 })) {
    return false
  }

  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && serialized.length <= maximumLength
  } catch {
    return false
  }
}

function isJsonSafeValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  nodes: { count: number },
): boolean {
  nodes.count += 1
  if (depth > 32 || nodes.count > 20_000) {
    return false
  }

  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }

  if (typeof value !== 'object' || ancestors.has(value)) {
    return false
  }

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonSafeValue(item, ancestors, depth + 1, nodes))
    : isPlainJsonRecord(value)
      && Object.values(value).every(
        (item) => isJsonSafeValue(item, ancestors, depth + 1, nodes),
      )
  ancestors.delete(value)
  return valid
}

function isValidRetryState(value: unknown): boolean {
  const permittedKeys = new Set(['attempts', 'reason', 'retryAfter', 'sourceId'])
  const retryReasons = new Set([
    'jobright_auth_required',
    'jobright_challenge_required',
    'jobright_detail_retryable',
    'jobright_not_logged_in',
    'jobright_rate_limited',
    'jobright_retry_deferred',
  ])

  return Array.isArray(value)
    && value.length <= JOBRIGHT_MIGRATION_SEED_LIMIT
    && value.every((entry) => {
      if (!isJsonRecord(entry)) {
        return false
      }

      return Object.keys(entry).every((key) => permittedKeys.has(key))
        && hasOwn(entry, 'attempts')
        && hasOwn(entry, 'reason')
        && hasOwn(entry, 'sourceId')
        && isCanonicalSourceIdArray([entry.sourceId])
        && isBoundedPositiveInteger(entry.attempts, 5)
        && typeof entry.reason === 'string'
        && retryReasons.has(entry.reason)
        && (
          entry.retryAfter === undefined
          || entry.retryAfter === null
          || isCanonicalIsoTimestamp(entry.retryAfter)
        )
    })
}

function hasValidJobrightV3Relations(checkpoint: JsonRecord): boolean {
  const attempts = Number(checkpoint.attempts)
  const discoveryPage = Number(checkpoint.discoveryPage)
  const discoveryPages = Number(checkpoint.discoveryPages)
  const discoveryPosition = Number(checkpoint.discoveryPosition)
  const eligibleSourceIds = checkpoint.eligibleSourceIds as string[]
  const processedSourceIds = checkpoint.processedSourceIds as string[]
  const seenSourceIds = checkpoint.seenSourceIds as string[]
  const unresolvedSourceIds = checkpoint.unresolvedSourceIds as string[]
  const usefulEmployerOrAtsSourceIds = checkpoint.usefulEmployerOrAtsSourceIds as string[]
  const usefulThirdPartySourceIds = checkpoint.usefulThirdPartySourceIds as string[]
  const retryState = checkpoint.retryState as Array<{ attempts: number; sourceId: string }>
  const retrySourceIds = retryState.map(({ sourceId }) => sourceId)
  const usefulSourceIds = [
    ...usefulEmployerOrAtsSourceIds,
    ...usefulThirdPartySourceIds,
  ]
  const completedAttemptCount = Math.max(
    usefulSourceIds.length + unresolvedSourceIds.length,
    processedSourceIds.length - Number(checkpoint.filtered) - Number(checkpoint.skipped),
  )
  const attemptedOutcomeCount = completedAttemptCount
    + retryState.reduce((sum, entry) => sum + entry.attempts, 0)
  const accountedProcessedCapacity = attempts
    + Number(checkpoint.filtered)
    + Number(checkpoint.skipped)
  const lastPageSize = checkpoint.lastDiscoveryPageSize
  const lastRequestCount = checkpoint.lastDiscoveryRequestCount
  const hasNoLastPage = lastPageSize === null && lastRequestCount === null
  const hasCoherentLastPage = typeof lastPageSize === 'number'
    && typeof lastRequestCount === 'number'
    && discoveryPages > 0
    && lastPageSize <= lastRequestCount
  const totalAvailableValid = checkpoint.totalAvailable === null
    || Number(checkpoint.totalAvailable) >= discoveryPosition
  const cycleStartedEpoch = Date.parse(checkpoint.cycleStartedAt as string)
  const horizonEpoch = Date.parse(checkpoint.horizonAt as string)
  const maximumHorizonEpoch = Math.min(
    8_640_000_000_000_000,
    cycleStartedEpoch + 90 * 24 * 60 * 60 * 1_000,
  )
  const cycleWindowValid = cycleStartedEpoch <= horizonEpoch
    && horizonEpoch <= maximumHorizonEpoch

  return checkpoint.discoveryRecords === seenSourceIds.length
    && discoveryPage <= discoveryPages
    && isSubset(eligibleSourceIds, seenSourceIds)
    && isSubset(processedSourceIds, seenSourceIds)
    && isSubset(usefulSourceIds, eligibleSourceIds)
    && isSubset(usefulSourceIds, processedSourceIds)
    && isSubset(unresolvedSourceIds, eligibleSourceIds)
    && isSubset(unresolvedSourceIds, processedSourceIds)
    && areDisjoint(usefulEmployerOrAtsSourceIds, usefulThirdPartySourceIds)
    && areDisjoint(usefulSourceIds, unresolvedSourceIds)
    && new Set(retrySourceIds).size === retrySourceIds.length
    && isSubset(retrySourceIds, seenSourceIds)
    && isSubset(retrySourceIds, eligibleSourceIds)
    && areDisjoint(retrySourceIds, processedSourceIds)
    && attemptedOutcomeCount <= attempts
    && Number(checkpoint.filtered) + Number(checkpoint.skipped) <= processedSourceIds.length
    && processedSourceIds.length <= accountedProcessedCapacity
    && totalAvailableValid
    && (hasNoLastPage || hasCoherentLastPage)
    && (checkpoint.discoveryRecordLimitReached !== true
      || (discoveryPages > 0 && seenSourceIds.length > 0))
    && cycleWindowValid
}

function isSubset(values: string[], candidates: string[]): boolean {
  const candidateSet = new Set(candidates)
  return values.every((value) => candidateSet.has(value))
}

function areDisjoint(left: string[], right: string[]): boolean {
  const rightSet = new Set(right)
  return left.every((value) => !rightSet.has(value))
}

function hasOwn(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isJobrightStopReason(value: unknown): boolean {
  return typeof value === 'string' && new Set([
    'auth_required',
    'backfill_horizon',
    'cancelled',
    'challenge',
    'cycle_attempt_limit',
    'discovery_page_limit',
    'discovery_record_limit',
    'failed',
    'invalid_discovery_position',
    'rate_limited',
    'retryable_failure',
    'runtime_limit',
    'soft_batch_boundary',
    'source_exhausted',
    'target_met',
  ]).has(value)
}
