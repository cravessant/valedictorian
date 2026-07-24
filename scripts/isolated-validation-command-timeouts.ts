export const isolatedValidationEvidenceReportTimeoutMs = 30_000
export const isolatedValidationStructuredReadinessTimeoutMs = 75_000
export const isolatedValidationMatrixTeardownMarginMs = 30_000

const normalSessionTimeoutMs = 60_000
const concurrentSessionTimeoutMs = 60_000
const timeoutSessionTimeoutMs = 1_000
const childFailureSessionTimeoutMs = 60_000
const earlyFailureScenarioCount = 5
const structuredReadinessWindowCount = 3

const aggregateSessionTimeoutMs = normalSessionTimeoutMs
  + concurrentSessionTimeoutMs
  + timeoutSessionTimeoutMs
  + childFailureSessionTimeoutMs
const structuredReadinessSetupAllowanceMs = structuredReadinessWindowCount
  * (isolatedValidationStructuredReadinessTimeoutMs - normalSessionTimeoutMs)
const earlyFailureAllowanceMs = earlyFailureScenarioCount * isolatedValidationEvidenceReportTimeoutMs

export const isolatedValidationCommandMatrixTimeoutMs = aggregateSessionTimeoutMs
  + structuredReadinessSetupAllowanceMs
  + earlyFailureAllowanceMs
  + isolatedValidationMatrixTeardownMarginMs

export const isolatedValidationCommandMatrixTestTimeoutMs = isolatedValidationCommandMatrixTimeoutMs
  + isolatedValidationMatrixTeardownMarginMs
