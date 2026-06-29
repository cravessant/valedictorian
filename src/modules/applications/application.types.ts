import type {
  ApplicationDetail,
  ApplicationAttempt,
  ApplicationAttemptStep,
  ApplicationEventsListInput,
  ApplicationEventsListResult,
  ApplicationAttemptsListInput,
  ApplicationAttemptsListResult,
  ApplicationListQuery,
  ApplicationListResult,
  ApplicationLinkRecord,
  ApplicationLinksListInput,
  ApplicationLinksListResult,
  ArchiveApplicationInput,
  AppendApplicationNoteInput,
  CompleteApplicationAttemptInput,
  CreateApplicationLinkInput,
  CreateApplicationInput,
  CreateApplicationAttemptStepInput,
  StartApplicationAttemptInput,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
} from 'sparxie'

export {
  applicationListSorts,
  applicationStatuses,
  canonicalizeApplicationUrl,
  DEFAULT_APPLICATION_LIST_LIMIT,
  DEFAULT_APPLICATION_LIST_OFFSET,
  isApplicationListSort,
  isApplicationStatus,
  isApplicationAttemptActorType,
  isApplicationAttemptStepType,
  isManualReviewKind,
  isRoleKind,
  isWorkMode,
  MAX_APPLICATION_LIST_LIMIT,
  normalizeApplicationLinkKind,
  normalizeApplicationUrlPreservingQuery,
} from 'sparxie'
export type {
  ApplicationDetail,
  ApplicationAttempt,
  ApplicationAttemptActorType,
  ApplicationAttemptsListInput,
  ApplicationAttemptsListResult,
  ApplicationAttemptStatus,
  ApplicationAttemptStep,
  ApplicationAttemptStepType,
  ApplicationEvent,
  ApplicationEventsListInput,
  ApplicationEventsListResult,
  ApplicationLinkRecord,
  ApplicationLinksListInput,
  ApplicationLinksListResult,
  ApplicationLinkSummary,
  ArchiveApplicationInput,
  AppendApplicationNoteInput,
  CompleteApplicationAttemptInput,
  ApplicationListItem,
  ApplicationListQuery,
  ApplicationListResult,
  ApplicationListSort,
  ApplicationStatus,
  CreateApplicationLinkInput,
  CreateApplicationInput,
  CreateApplicationAttemptStepInput,
  RoleKind,
  StatusUpdateInput,
  StartApplicationAttemptInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
  WorkMode,
} from 'sparxie'

export interface ApplicationRepository {
  createApplication: (input: CreateApplicationInput) => Promise<ApplicationDetail>
  updateApplication: (input: UpdateApplicationInput) => Promise<ApplicationDetail>
  appendApplicationNote: (input: AppendApplicationNoteInput) => Promise<ApplicationDetail>
  archiveApplication: (input: ArchiveApplicationInput) => Promise<void>
  updateApplicationWorkflow: (input: UpdateApplicationWorkflowInput) => Promise<ApplicationDetail>
  createApplicationLink: (input: CreateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  updateApplicationLink: (input: UpdateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  listApplicationLinks: (input: ApplicationLinksListInput) => Promise<ApplicationLinksListResult>
  listApplicationEvents: (input: ApplicationEventsListInput) => Promise<ApplicationEventsListResult>
  listApplicationAttempts: (input: ApplicationAttemptsListInput) => Promise<ApplicationAttemptsListResult>
  startApplicationAttempt: (input: StartApplicationAttemptInput) => Promise<ApplicationAttempt>
  createApplicationAttemptStep(
    input: CreateApplicationAttemptStepInput,
  ): Promise<ApplicationAttemptStep>
  completeApplicationAttempt: (input: CompleteApplicationAttemptInput) => Promise<ApplicationAttempt>
  listApplications: (query?: ApplicationListQuery) => Promise<ApplicationListResult>
  getApplication: (id: string) => Promise<ApplicationDetail | null>
  updateApplicationStatus: (input: StatusUpdateInput) => Promise<ApplicationDetail>
}
