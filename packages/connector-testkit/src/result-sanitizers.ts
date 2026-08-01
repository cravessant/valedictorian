import {
  retryAdviceSchema,
  sanitizeConnectorSynchronization,
  type ConnectorRefreshResult,
  type ConnectorRefreshStatus,
  type RetryAdvice,
} from "@sparxie/valedictorian-connectors-core"
import { canonicalDateOnlySchema } from "@sparxie/sdk"

export type ConnectorRunCoverageWindow = {
  start: string | null
  end: string | null
}

export function sanitizeConnectorRunCoverage(
  value: unknown,
): ConnectorRunCoverageWindow {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    start: sanitizeCoverageInstant(record.start),
    end: sanitizeCoverageInstant(record.end),
  }
}

export function sanitizeConnectorRunLifecycle(
  statusValue: unknown,
  synchronizationValue: unknown,
): {
  status: ConnectorRefreshStatus
  synchronization: ConnectorRefreshResult["synchronization"]
} {
  let status = sanitizeConnectorRefreshStatus(statusValue)
  let synchronization = sanitizeConnectorSynchronization(synchronizationValue)
  const outcome = synchronization.outcome
  if (outcome.kind === "failed") {
    status = "failed"
    synchronization = terminalSynchronization(synchronization, outcome)
  } else if (outcome.kind === "cancelled") {
    status = "cancelled"
    synchronization = terminalSynchronization(synchronization, outcome)
  }
  else if (outcome.kind === "in_progress") {
    status = "failed"
    synchronization = failedSynchronization(synchronization)
  } else if (status === "failed") {
    synchronization = failedSynchronization(synchronization)
  } else if (status === "cancelled") {
    synchronization = cancelledSynchronization(synchronization)
  } else if (
    outcome.kind === "caught_up" || outcome.kind === "boundary_exhausted" ||
    outcome.kind === "source_exhausted"
  ) status = "completed"

  synchronization = sanitizeConnectorSynchronization(synchronization)
  return { status, synchronization }
}

export function sanitizeRetryHints(value: unknown): RetryAdvice | null {
  if (value === null || value === undefined) return null
  const parsed = retryAdviceSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function sanitizeConnectorRefreshStatus(value: unknown): ConnectorRefreshStatus {
  return value === "completed" || value === "failed" ||
      value === "cancelled" || value === "skipped"
    ? value
    : "failed"
}

function sanitizeCoverageInstant(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match || !canonicalDateOnlySchema.safeParse(match[1]).success) return null
  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4])
  return hour <= 23 && minute <= 59 && second <= 59 &&
      Number.isFinite(Date.parse(value))
    ? value
    : null
}

function failedSynchronization(
  value: ConnectorRefreshResult["synchronization"],
): ConnectorRefreshResult["synchronization"] {
  return terminalSynchronization(value, {
    kind: "failed",
    reason: "connector_execution_failed",
  })
}

function cancelledSynchronization(
  value: ConnectorRefreshResult["synchronization"],
): ConnectorRefreshResult["synchronization"] {
  return terminalSynchronization(value, { kind: "cancelled", reason: "cancelled" })
}

function terminalSynchronization(
  value: ConnectorRefreshResult["synchronization"],
  outcome: ConnectorRefreshResult["synchronization"]["outcome"],
): ConnectorRefreshResult["synchronization"] {
  return { ...value, outcome }
}
