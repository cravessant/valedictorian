import { sourceAdapterKinds } from "./source-adapter-kinds.js"
import type { JsonValue } from "./json.js"

/** Connector-owned technical normalization vocabulary. */
export type SourceAdapterKind = (typeof sourceAdapterKinds)[number]

export const canonicalCandidateFields = [
  "canonicalIdentity",
  "companyName",
  "roleTitle",
  "employmentType",
  "seniority",
  "workMode",
  "location",
  "destinationUrl",
  "sourceUrl",
  "providerJobId",
  "postedAt",
  "compensation",
] as const
export type CanonicalCandidateField = (typeof canonicalCandidateFields)[number]

export const resolverCapabilities = ["pure", "network", "model", "browser"] as const
export type ResolverCapability = (typeof resolverCapabilities)[number]

export const resolverCostClasses = ["none", "low", "medium", "high"] as const
export type ResolverCostClass = (typeof resolverCostClasses)[number]

export interface ResolverDeclaration {
  id: string
  version: string
  scopeRequirement: "source" | "none"
  supportedAdapters?: {
    kinds?: SourceAdapterKind[]
    ids?: string[]
    versions?: string[]
  }
  supportedProviderSchemas?: string[]
  requiredInputs: string[]
  outputFields: CanonicalCandidateField[]
  capabilities: ResolverCapability[]
  costClass: ResolverCostClass
  /** Higher values run before lower values for the same field. */
  precedence: number
}

export interface ResolutionEvidence {
  kind: string
  value: JsonValue
  path?: string
  sourceUrl?: string
}

export const canonicalEmploymentTypes = [
  "full_time",
  "part_time",
  "contract",
  "temporary",
  "internship",
  "apprenticeship",
  "other",
  "unknown",
] as const
export type CanonicalEmploymentType = (typeof canonicalEmploymentTypes)[number]

export interface CanonicalLocation {
  raw: string | null
  city: string | null
  region: string | null
  country: string | null
}

export const canonicalCompensationIntervals = [
  "hour",
  "day",
  "week",
  "month",
  "year",
  "one_time",
  "unknown",
] as const
export type CanonicalCompensationInterval =
  (typeof canonicalCompensationIntervals)[number]

export interface CanonicalCompensation {
  minimum: number | null
  maximum: number | null
  currency: string | null
  interval: CanonicalCompensationInterval
  raw: string | null
}

export const canonicalPostedAtPrecisions = [
  "instant",
  "date",
  "relative",
  "unknown",
] as const
export type CanonicalPostedAtPrecision =
  (typeof canonicalPostedAtPrecisions)[number]

export type CanonicalPostedAt =
  | {
      value: null
      precision: "unknown"
      raw: string | null
    }
  | {
      value: string
      precision: Exclude<CanonicalPostedAtPrecision, "unknown">
      raw: string | null
    }


type NormalizationField =
  | "canonicalIdentity"
  | "companyName"
  | "roleTitle"
  | "employmentType"
  | "seniority"
  | "workMode"
  | "location"
  | "destinationUrl"
  | "sourceUrl"
  | "providerJobId"
  | "postedAt"
  | "compensation"

type FieldResolutionOutcomeBase = {
  resolverId: string
  resolverVersion: string
  field: NormalizationField
  inputHash: string
  evidence?: ResolutionEvidence[]
}

export type FieldResolutionOutcome =
  | (FieldResolutionOutcomeBase & {
      status: "resolved"
      value: JsonValue
      confidence: number
      authoritative?: boolean
    })
  | (FieldResolutionOutcomeBase & {
      status: "not_applicable" | "abstained" | "blocked" | "rejected" | "failed"
      reason: string
    })
  | (FieldResolutionOutcomeBase & {
      status: "retry"
      retry: import("./retry.js").ScheduledRetryAdvice | import("./retry.js").NotDueRetryAdvice
    })
  | (FieldResolutionOutcomeBase & {
      status: "exhausted"
      retry: import("./retry.js").ExhaustedRetryAdvice
    })
  | (FieldResolutionOutcomeBase & {
      status: "cancelled"
      retry: import("./retry.js").CancelledRetryAdvice
    })
  | (FieldResolutionOutcomeBase & {
      status: "conflict"
      reason: string
      values: JsonValue[]
    })
  | (FieldResolutionOutcomeBase & {
      status: "suppressed"
      reason: string
      policyVersion: string
    })
  | (FieldResolutionOutcomeBase & {
      status: "locked"
      value: JsonValue
      reason: string
      policyVersion: string
    })
