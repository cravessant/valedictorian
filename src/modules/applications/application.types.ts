import type {
  ApplicationDetail,
  ApplicationListQuery,
  ApplicationListResult,
  StatusUpdateInput,
} from 'job-app-sdk'

export {
  applicationListSorts,
  applicationStatuses,
  DEFAULT_APPLICATION_LIST_LIMIT,
  DEFAULT_APPLICATION_LIST_OFFSET,
  isApplicationListSort,
  isApplicationStatus,
  MAX_APPLICATION_LIST_LIMIT,
} from 'job-app-sdk'
export type {
  ApplicationDetail,
  ApplicationLinkSummary,
  ApplicationListItem,
  ApplicationListQuery,
  ApplicationListResult,
  ApplicationListSort,
  ApplicationStatus,
  CreateApplicationInput,
  StatusUpdateInput,
  WorkMode,
} from 'job-app-sdk'

export interface ApplicationRepository {
  listApplications(query?: ApplicationListQuery): Promise<ApplicationListResult>
  getApplication(id: string): Promise<ApplicationDetail | null>
  updateApplicationStatus(input: StatusUpdateInput): Promise<ApplicationDetail>
}
