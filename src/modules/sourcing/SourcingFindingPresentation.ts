import { formatJobTerms, type SourcingDestinationClass, type SourcingFinding, type SourcingUsability } from 'sparxie'

export function destinationClassLabel(value: SourcingDestinationClass | null | undefined): string {
  if (value === 'employer_or_ats') {
    return 'Employer / ATS'
  }
  if (value === 'third_party_job_posting') {
    return 'Third-party'
  }
  return 'Unresolved'
}

export function usabilityLabel(value: SourcingUsability): string {
  return value === 'usable' ? 'Projected usable' : 'Not projected usable'
}


export function formatSourcingTiming(item: SourcingFinding) {
  if (item.term) {
    return item.term
  }

  const termsLabel = formatJobTerms(item.terms)
  return termsLabel || 'Unknown timing'
}


export function getSourcingDecision(item: SourcingFinding): {
  actionLabel: string
  description: string
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'success' | 'warning'
} {
  switch (item.mergeStatus) {
    case 'merged':
      return {
        actionLabel: 'Already promoted',
        description: 'In applications',
        label: 'Promoted',
        variant: 'success',
      }
    case 'duplicate':
      return {
        actionLabel: 'Linked duplicate',
        description: 'Linked to existing application',
        label: 'Duplicate',
        variant: 'outline',
      }
    case 'blocked':
      return {
        actionLabel: 'Fix source data',
        description: 'Needs source data before promotion',
        label: 'Blocked',
        variant: 'warning',
      }
    case 'below_cutoff':
      return {
        actionLabel: 'Below cutoff',
        description: 'Not promoted by scoring cutoff',
        label: 'Below cutoff',
        variant: 'warning',
      }
    case 'not_fit':
      return {
        actionLabel: 'Not fit',
        description: 'Not promoted by fit review',
        label: 'Not fit',
        variant: 'outline',
      }
    case 'not_pursued':
      return {
        actionLabel: 'Not pursued',
        description: 'Skipped by review',
        label: 'Not pursued',
        variant: 'outline',
      }
    case 'archived':
      return {
        actionLabel: 'Archived',
        description: 'Hidden from active review',
        label: 'Archived',
        variant: 'outline',
      }
    case 'new':
    default:
      return {
        actionLabel: 'Promote',
        description: 'Ready to review',
        label: 'New finding',
        variant: 'secondary',
      }
  }
}

export function formatMergedApplicationLabel(item: SourcingFinding) {
  if (!item.mergedApplicationCompanyName || !item.mergedApplicationRoleTitle) {
    return null
  }

  return `${item.mergedApplicationCompanyName} - ${item.mergedApplicationRoleTitle}`
}
