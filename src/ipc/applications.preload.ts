import type {
  ApplicationAttemptsListInput,
  ApplicationAttemptsListResult,
  ApplicationDetail,
  ApplicationEventsListInput,
  ApplicationEventsListResult,
  ApplicationLinkRecord,
  ApplicationLinksListInput,
  ApplicationLinksListResult,
  ApplicationListQuery,
  ApplicationListResult,
  AppendApplicationNoteInput,
  ArchiveApplicationInput,
  CreateApplicationInput,
  CreateApplicationLinkInput,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
} from '../modules/applications/application.types'

interface IpcRendererLike {
  invoke(channel: string, query?: unknown): Promise<unknown>
}

export interface ApplicationsPreloadApi {
  list(query?: ApplicationListQuery): Promise<ApplicationListResult>
  get(applicationId: string): Promise<ApplicationDetail | null>
  create(input: CreateApplicationInput): Promise<ApplicationDetail>
  update(input: UpdateApplicationInput): Promise<ApplicationDetail>
  updateStatus(input: StatusUpdateInput): Promise<ApplicationDetail>
  archive(input: ArchiveApplicationInput): Promise<void>
  workflow: {
    update(input: UpdateApplicationWorkflowInput): Promise<ApplicationDetail>
  }
  notes: {
    append(input: AppendApplicationNoteInput): Promise<ApplicationDetail>
  }
  events: {
    list(input: ApplicationEventsListInput): Promise<ApplicationEventsListResult>
  }
  links: {
    list(input: ApplicationLinksListInput): Promise<ApplicationLinksListResult>
    create(input: CreateApplicationLinkInput): Promise<ApplicationLinkRecord>
    update(input: UpdateApplicationLinkInput): Promise<ApplicationLinkRecord>
  }
  attempts: {
    list(input: ApplicationAttemptsListInput): Promise<ApplicationAttemptsListResult>
  }
}

export function createApplicationsPreloadApi(
  ipcRenderer: IpcRendererLike,
): ApplicationsPreloadApi {
  return {
    list(query) {
      return ipcRenderer.invoke('applications:list', query) as Promise<ApplicationListResult>
    },
    get(applicationId) {
      return ipcRenderer.invoke('applications:get', applicationId) as Promise<ApplicationDetail | null>
    },
    create(input) {
      return ipcRenderer.invoke('applications:create', input) as Promise<ApplicationDetail>
    },
    update(input) {
      return ipcRenderer.invoke('applications:update', input) as Promise<ApplicationDetail>
    },
    updateStatus(input) {
      return ipcRenderer.invoke('applications:update-status', input) as Promise<ApplicationDetail>
    },
    archive(input) {
      return ipcRenderer.invoke('applications:archive', input) as Promise<void>
    },
    workflow: {
      update(input) {
        return ipcRenderer.invoke('applications:workflow:update', input) as Promise<ApplicationDetail>
      },
    },
    notes: {
      append(input) {
        return ipcRenderer.invoke('applications:notes:append', input) as Promise<ApplicationDetail>
      },
    },
    events: {
      list(input) {
        return ipcRenderer.invoke(
          'applications:events:list',
          input,
        ) as Promise<ApplicationEventsListResult>
      },
    },
    links: {
      list(input) {
        return ipcRenderer.invoke(
          'applications:links:list',
          input,
        ) as Promise<ApplicationLinksListResult>
      },
      create(input) {
        return ipcRenderer.invoke(
          'applications:links:create',
          input,
        ) as Promise<ApplicationLinkRecord>
      },
      update(input) {
        return ipcRenderer.invoke(
          'applications:links:update',
          input,
        ) as Promise<ApplicationLinkRecord>
      },
    },
    attempts: {
      list(input) {
        return ipcRenderer.invoke(
          'applications:attempts:list',
          input,
        ) as Promise<ApplicationAttemptsListResult>
      },
    },
  }
}
