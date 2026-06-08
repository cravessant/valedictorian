import type {
  ApplicationDetail,
  ApplicationAttempt,
  ApplicationAttemptsListInput,
  ApplicationAttemptsListResult,
  ApplicationAttemptStep,
  ApplicationEventsListInput,
  ApplicationEventsListResult,
  ApplicationLinkRecord,
  ApplicationLinksListInput,
  ApplicationLinksListResult,
  ApplicationListQuery,
  ApplicationListResult,
  AppendApplicationNoteInput,
  ArchiveApplicationInput,
  CompleteApplicationAttemptInput,
  CreateApplicationAttemptStepInput,
  CreateApplicationInput,
  CreateApplicationLinkInput,
  ApplicationRepository,
  StartApplicationAttemptInput,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
} from './application.types'

export interface ApplicationService {
  createApplication(input: CreateApplicationInput): Promise<ApplicationDetail>
  updateApplication(input: UpdateApplicationInput): Promise<ApplicationDetail>
  listApplications(query?: ApplicationListQuery): Promise<ApplicationListResult>
  getApplication(id: string): Promise<ApplicationDetail | null>
  updateApplicationStatus(input: StatusUpdateInput): Promise<ApplicationDetail>
  archiveApplication(input: ArchiveApplicationInput): Promise<void>
  updateApplicationWorkflow(input: UpdateApplicationWorkflowInput): Promise<ApplicationDetail>
  appendApplicationNote(input: AppendApplicationNoteInput): Promise<ApplicationDetail>
  createApplicationLink(input: CreateApplicationLinkInput): Promise<ApplicationLinkRecord>
  updateApplicationLink(input: UpdateApplicationLinkInput): Promise<ApplicationLinkRecord>
  listApplicationLinks(input: ApplicationLinksListInput): Promise<ApplicationLinksListResult>
  listApplicationEvents(input: ApplicationEventsListInput): Promise<ApplicationEventsListResult>
  listApplicationAttempts(input: ApplicationAttemptsListInput): Promise<ApplicationAttemptsListResult>
  startApplicationAttempt(input: StartApplicationAttemptInput): Promise<ApplicationAttempt>
  createApplicationAttemptStep(
    input: CreateApplicationAttemptStepInput,
  ): Promise<ApplicationAttemptStep>
  completeApplicationAttempt(input: CompleteApplicationAttemptInput): Promise<ApplicationAttempt>
}

export function createApplicationService(repository: ApplicationRepository): ApplicationService {
  return {
    createApplication(input) {
      return repository.createApplication(input)
    },
    updateApplication(input) {
      return repository.updateApplication(input)
    },
    listApplications(query) {
      return repository.listApplications(query)
    },
    getApplication(id) {
      return repository.getApplication(id)
    },
    updateApplicationStatus(input) {
      return repository.updateApplicationStatus(input)
    },
    archiveApplication(input) {
      return repository.archiveApplication(input)
    },
    updateApplicationWorkflow(input) {
      return repository.updateApplicationWorkflow(input)
    },
    appendApplicationNote(input) {
      return repository.appendApplicationNote(input)
    },
    createApplicationLink(input) {
      return repository.createApplicationLink(input)
    },
    updateApplicationLink(input) {
      return repository.updateApplicationLink(input)
    },
    listApplicationLinks(input) {
      return repository.listApplicationLinks(input)
    },
    listApplicationEvents(input) {
      return repository.listApplicationEvents(input)
    },
    listApplicationAttempts(input) {
      return repository.listApplicationAttempts(input)
    },
    startApplicationAttempt(input) {
      return repository.startApplicationAttempt(input)
    },
    createApplicationAttemptStep(input) {
      return repository.createApplicationAttemptStep(input)
    },
    completeApplicationAttempt(input) {
      return repository.completeApplicationAttempt(input)
    },
  }
}
