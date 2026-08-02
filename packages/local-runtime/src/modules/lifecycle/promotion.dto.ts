/**
 * Lifecycle promotion-result serialization (issue #304, stage 3).
 *
 * The shared `promotionResultSchema` factory (sparxie/lifecycle-shared) gives every
 * promotion the same result: a discriminated union of `promoted` (resource + created
 * + warnings + override + duplicateResolution + audit) and `blocked` (a lifecycle
 * blocker). These pure mappers, generic over the promoted resource `T`, translate a
 * promotion orchestration result into that contract. No policy, no IO: the promotion
 * owns the transaction, the read-model assembled `T`, this module re-shapes.
 *
 * Warning taxonomy bridge (#304): promotion orchestrations surface domain warning
 * codes; the contract admits only `lifecycleWarningCodes`. All Job->Opportunity codes
 * (fit/cutoff/missing_optional_facts/third_party_destination/weak_possible_match) map
 * 1:1. The Capture->Job promotion additionally emits `retrieval_unavailable` — a
 * failed boundary retrieval that yields a PROVISIONAL identity — which the contract
 * expresses as `weak_possible_match`. Unknown codes are dropped rather than smuggled.
 *
 * Override attribution (#304, resolved): the Capture->Job promotion validates its
 * warning override but does NOT persist it (the Job has no override surface — ratified
 * design). The promotion RESPONSE still surfaces the applied override by echoing the
 * validated input here, which is truthful for that promotion call. Job->Opportunity
 * persists the override on the Opportunity resource; Opportunity->Application records
 * it in the created-history audit; both also echo it into the response.
 */
import type {
  DuplicateResolutionDecision,
  LifecycleWarning,
  LifecycleWarningCode,
  WarningOverride,
} from '@sparxie/sdk'
import { toContractActor, toLifecycleBlocker, type LifecycleBlockerInput } from './lifecycle-audit.dto.js'
import {
  classifyMutationFailure,
  type DuplicateResolutionDecisionFor,
  type MutationAuditExtras,
  type MutationBlocked,
  type MutationHttpFailure,
} from './mutation.dto.js'
import type { LifecycleAuditEvidence } from '@sparxie/sdk'

/** The `promoted` branch of a promotion result, generic over the promoted resource. */
export interface PromotionPromoted<T> {
  readonly status: 'promoted'
  readonly resource: T
  readonly created: boolean
  // Mutable array element type: the contract's promoted branch (z.infer of a
  // ZodArray) is a mutable `LifecycleWarning[]`; a `readonly` array would not be
  // assignable to it. `toContractWarnings` already returns a fresh mutable array.
  readonly warnings: LifecycleWarning[]
  readonly override: WarningOverride | null
  readonly duplicateResolution: DuplicateResolutionDecisionFor<T> | null
  readonly audit: LifecycleAuditEvidence
}

export type PromotionResult<T> = PromotionPromoted<T> | MutationBlocked

/** Domain warning code -> contract lifecycle warning code, or undefined to drop it. */
const WARNING_CODE_MAP: Record<string, LifecycleWarningCode> = {
  fit: 'fit',
  rank: 'rank',
  cutoff: 'cutoff',
  missing_optional_facts: 'missing_optional_facts',
  third_party_destination: 'third_party_destination',
  weak_possible_match: 'weak_possible_match',
  // Capture->Job: a failed boundary retrieval yields a provisional identity, which the
  // contract expresses as a weak/possible match.
  retrieval_unavailable: 'weak_possible_match',
}

export interface PromotionWarningInput {
  readonly code: string
  readonly message: string
}

/** Map + dedupe domain warnings onto the strict contract warning list. */
export function toContractWarnings(warnings: readonly PromotionWarningInput[]): LifecycleWarning[] {
  const seen = new Set<LifecycleWarningCode>()
  const result: LifecycleWarning[] = []
  for (const warning of warnings) {
    const code = WARNING_CODE_MAP[warning.code]
    if (code === undefined || seen.has(code)) continue
    seen.add(code)
    result.push({ code, message: warning.message })
  }
  return result
}

/** The contract warning-override input shape shared by all three promotions. */
export interface PromotionOverrideInput {
  readonly actor: { readonly id: string; readonly type: string; readonly displayName?: string }
  readonly rationale: string
  readonly warningCodes: readonly string[]
}

const WARNING_CODES = new Set<string>(Object.values(WARNING_CODE_MAP))

/** Serialize a validated warning override into the contract shape (or null when absent). */
export function toWarningOverride(override: PromotionOverrideInput | null | undefined): WarningOverride | null {
  if (override === undefined || override === null) return null
  const warningCodes = override.warningCodes
    .map((code) => WARNING_CODE_MAP[code] ?? code)
    .filter((code): code is LifecycleWarningCode => WARNING_CODES.has(code))
  return {
    actor: toContractActor(override.actor),
    rationale: override.rationale,
    warningCodes,
  }
}

export interface PromotedContext {
  readonly created: boolean
  readonly actor: unknown
  readonly timestamp: string
  readonly warnings?: readonly PromotionWarningInput[]
  readonly override?: PromotionOverrideInput | null
  readonly duplicateResolution?: DuplicateResolutionDecision | null
  readonly audit?: MutationAuditExtras
}

/** Serialize a successful promotion into the `promoted` body. */
export function toPromotedResult<T>(resource: T, context: PromotedContext): PromotionPromoted<T> {
  const override = toWarningOverride(context.override)
  const audit: LifecycleAuditEvidence = {
    actor: toContractActor(context.actor),
    timestamp: context.timestamp,
    ...context.audit,
    // The contract's superRefine requires the audit envelope to retain the exact
    // warning override that the promoted body surfaces (the override rides the audit).
    ...(override !== null ? { override } : {}),
  }
  return {
    status: 'promoted',
    resource,
    created: context.created,
    warnings: toContractWarnings(context.warnings ?? []),
    override,
    // Loose input -> branded output, mirroring toSucceededMutationResult: the
    // promoted resource's aggregate brands the collapsed duplicate target.
    duplicateResolution: (context.duplicateResolution ?? null) as DuplicateResolutionDecisionFor<T> | null,
    audit,
  }
}

/** Serialize a policy block into the `blocked` body (identical to the mutation block). */
export function toBlockedPromotionResult(blocker: LifecycleBlockerInput): MutationBlocked {
  return { status: 'blocked', blocker: toLifecycleBlocker(blocker) }
}

/**
 * Classify a promotion domain-failure code. Identical routing to the mutation
 * classifier: existence/concurrency codes become typed HTTP errors; any lifecycle
 * blocker code becomes a 200 `blocked` body.
 */
export function classifyPromotionFailure(code: string): MutationHttpFailure {
  return classifyMutationFailure(code)
}
