import { createHash } from 'node:crypto'
import type { CompanyMatchReason } from '@sparxie/sdk'

export const COMPANY_DUPLICATE_MATCHER_VERSION = 'local-company-v1'
export const COMPANY_DUPLICATE_SIMILARITY_THRESHOLD = 0.45

export interface CompanyDuplicateInput {
  readonly companyId: string
  readonly revision: number
  readonly normalizedName: string
  readonly normalizedAliases: readonly string[]
  readonly websiteHost: string | null
}

export interface CompanyDuplicateScore {
  readonly score: number
  readonly reasons: readonly CompanyMatchReason[]
}

export function companyDuplicateFingerprint(input: CompanyDuplicateInput): string {
  const value = JSON.stringify({
    matcherVersion: COMPANY_DUPLICATE_MATCHER_VERSION,
    normalizedName: input.normalizedName,
    normalizedAliases: [...input.normalizedAliases].sort(),
    websiteHost: input.websiteHost,
  })
  return createHash('sha256').update(value).digest('hex')
}

export function scoreCompanyDuplicatePair(
  left: CompanyDuplicateInput,
  right: CompanyDuplicateInput,
): CompanyDuplicateScore | null {
  const nameScore = dice(left.normalizedName, right.normalizedName)
  const aliasScore = Math.max(
    0,
    ...left.normalizedAliases.map((alias) => dice(alias, right.normalizedName)),
    ...right.normalizedAliases.map((alias) => dice(left.normalizedName, alias)),
    ...left.normalizedAliases.flatMap((leftAlias) =>
      right.normalizedAliases.map((rightAlias) => dice(leftAlias, rightAlias))),
  )
  const sameDomain = Boolean(
    left.websiteHost
    && right.websiteHost
    && left.websiteHost === right.websiteHost,
  )
  const reasons: CompanyMatchReason[] = []
  if (nameScore >= COMPANY_DUPLICATE_SIMILARITY_THRESHOLD) {
    reasons.push({
      code: 'normalized_name_similarity',
      label: 'Company names are similar.',
    })
  }
  if (aliasScore >= COMPANY_DUPLICATE_SIMILARITY_THRESHOLD) {
    reasons.push({
      code: 'alias_similarity',
      label: 'A Company alias is similar.',
    })
  }
  if (sameDomain) {
    reasons.push({
      code: 'same_declared_domain',
      label: 'The declared website domain matches.',
    })
  }
  if (reasons.length === 0) return null
  return {
    score: Math.round(Math.max(nameScore, aliasScore, sameDomain ? 1 : 0) * 10_000),
    reasons,
  }
}

export function duplicateNameBucket(value: string): string {
  return value.replace(/[^a-z0-9]+/g, '').slice(0, 3)
}

function dice(left: string, right: string): number {
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const pairs = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2)
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
  }
  let overlap = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2)
    const available = pairs.get(pair) ?? 0
    if (available > 0) {
      overlap += 1
      pairs.set(pair, available - 1)
    }
  }
  return (2 * overlap) / (left.length + right.length - 2)
}
