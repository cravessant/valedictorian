import type {
  ApplicationDetail,
  ApplicationListQuery,
  ApplicationListResult,
  ApplicationRepository,
  StatusUpdateInput,
} from './application.types'

export interface ApplicationService {
  listApplications(query?: ApplicationListQuery): Promise<ApplicationListResult>
  getApplication(id: string): Promise<ApplicationDetail | null>
  updateApplicationStatus(input: StatusUpdateInput): Promise<ApplicationDetail>
}

export function createApplicationService(repository: ApplicationRepository): ApplicationService {
  return {
    listApplications(query) {
      return repository.listApplications(query)
    },
    getApplication(id) {
      return repository.getApplication(id)
    },
    updateApplicationStatus(input) {
      return repository.updateApplicationStatus(input)
    },
  }
}
