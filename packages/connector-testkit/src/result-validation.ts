import {
  jobObservationSchemaVersion,
  type JobObservation,
  type JobObservationEvidence,
  type JobObservationResolutionStatus,
} from "@sparxie/valedictorian-connectors-core"

const resolutionStatuses = new Set<JobObservationResolutionStatus>([
  "resolved",
  "auth_required",
  "closed",
  "hidden",
  "direct_apply",
  "rate_limited",
  "captcha",
  "unresolved",
  "not_supported",
])

export function isSafeCheckpointSchemaVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    /^[A-Za-z0-9._@/-]+$/.test(value)
}

export function projectJobObservation(
  value: unknown,
  connectorId: string,
  connectorVersion: string,
): JobObservation | null {
  const record = asRecord(value)
  if (!record || record.connectorId !== connectorId ||
    record.connectorVersion !== connectorVersion ||
    record.observationSchemaVersion !== jobObservationSchemaVersion ||
    !isRequiredString(record.parserVersion) ||
    !isRequiredString(record.sourceRecordKey) ||
    !isTimestamp(record.observedAt) ||
    typeof record.companyName !== "string" ||
    typeof record.roleTitle !== "string" ||
    !isOptionalNullableString(record, "locationRaw") ||
    !isOptionalNullableString(record, "descriptionText") ||
    !isStringArray(record.dedupeKeys)) return null

  const links = projectLinks(record.links)
  const resolution = projectResolution(record.resolution)
  const evidence = projectEvidence(record.evidence)
  if (!links || !resolution || !evidence) return null
  const sourceMetadata = asOptionalRecord(record, "sourceMetadata")
  if (sourceMetadata === false) return null

  return {
    connectorId,
    connectorVersion,
    parserVersion: record.parserVersion,
    observationSchemaVersion: jobObservationSchemaVersion,
    sourceRecordKey: record.sourceRecordKey,
    observedAt: record.observedAt,
    companyName: record.companyName,
    roleTitle: record.roleTitle,
    ...(Object.hasOwn(record, "locationRaw")
      ? { locationRaw: record.locationRaw as string | null }
      : {}),
    ...(Object.hasOwn(record, "descriptionText")
      ? { descriptionText: record.descriptionText as string | null }
      : {}),
    ...(Object.hasOwn(record, "pay") ? { pay: record.pay } : {}),
    links,
    resolution,
    dedupeKeys: record.dedupeKeys,
    ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
    evidence,
  }
}

function projectLinks(value: unknown): JobObservation["links"] | null {
  const record = asRecord(value)
  if (!record || !isNullableString(record.source) ||
    !isNullableString(record.intermediary) ||
    !isNullableString(record.official)) return null
  return {
    source: record.source,
    intermediary: record.intermediary,
    official: record.official,
  }
}

function projectResolution(value: unknown): JobObservation["resolution"] | null {
  const record = asRecord(value)
  if (!record || !resolutionStatuses.has(
    record.status as JobObservationResolutionStatus,
  ) || !isNullableString(record.method) || !isNullableString(record.reason)) {
    return null
  }
  return {
    status: record.status as JobObservationResolutionStatus,
    method: record.method,
    reason: record.reason,
  }
}

function projectEvidence(value: unknown): JobObservationEvidence[] | null {
  if (!Array.isArray(value) || value.length > 1_000) return null
  const projected: JobObservationEvidence[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record || !isRequiredString(record.type) ||
      !isTimestamp(record.capturedAt) || !isNullableString(record.sourceUrl)) {
      return null
    }
    projected.push({
      type: record.type,
      capturedAt: record.capturedAt,
      sourceUrl: record.sourceUrl,
    })
  }
  return projected
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asOptionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined | false {
  if (!Object.hasOwn(record, key)) return undefined
  return asRecord(record[key]) ?? false
}

function isRequiredString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isOptionalNullableString(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return !Object.hasOwn(record, key) || isNullableString(record[key])
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 1_000 &&
    value.every((item) => typeof item === "string")
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 &&
    Number.isFinite(Date.parse(value))
}
