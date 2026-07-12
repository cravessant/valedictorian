import type { SourcingFinding } from 'sparxie'
import type { ApplicationDetailSeed } from '../../app/types'

export function sourcingFindingToApplication(item: SourcingFinding): ApplicationDetailSeed {
  return {
    id: item.mergedApplicationId ?? item.id,
    companyName: item.mergedApplicationCompanyName ?? item.companyName,
    primaryLink: item.officialUrl
      ? {
          label: 'official',
          url: item.officialUrl,
        }
      : item.sourceUrl
        ? {
            label: 'source',
            url: item.sourceUrl,
          }
        : null,
    roleTitle: item.mergedApplicationRoleTitle ?? item.roleTitle,
    sourceName: item.sourceName,
    status: item.mergeStatus,
  }
}
