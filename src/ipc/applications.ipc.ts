import type {
  AppendApplicationNoteInput,
  ArchiveApplicationInput,
  CreateApplicationInput,
  CreateApplicationLinkInput,
  JobAppClient,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
} from 'sparxie'
import type {
  ApplicationAttemptsListInput,
  ApplicationEventsListInput,
  ApplicationLinksListInput,
  ApplicationListQuery,
} from '../modules/applications/application.types'

interface IpcMainLike {
  handle(
    channel: string,
    handler: (
      _event: unknown,
      query?: ApplicationListQuery | ApplicationAttemptsListInput | ApplicationEventsListInput | ApplicationLinksListInput | string,
    ) => Promise<unknown>,
  ): void
}

export function registerApplicationIpc(client: JobAppClient, ipcMain: IpcMainLike) {
  ipcMain.handle('applications:list', (_event, query) =>
    client.applications.list(query as ApplicationListQuery | undefined),
  )
  ipcMain.handle('applications:get', (_event, applicationId) =>
    client.applications.get(applicationId as string),
  )
  ipcMain.handle('applications:create', (_event, input) =>
    client.applications.create(input as CreateApplicationInput),
  )
  ipcMain.handle('applications:update', (_event, input) =>
    client.applications.update(input as UpdateApplicationInput),
  )
  ipcMain.handle('applications:update-status', (_event, input) =>
    client.applications.updateStatus(input as StatusUpdateInput),
  )
  ipcMain.handle('applications:archive', (_event, input) =>
    client.applications.archive(input as ArchiveApplicationInput),
  )
  ipcMain.handle('applications:workflow:update', (_event, input) =>
    client.applications.workflow.update(input as UpdateApplicationWorkflowInput),
  )
  ipcMain.handle('applications:notes:append', (_event, input) =>
    client.applications.notes.append(input as AppendApplicationNoteInput),
  )
  ipcMain.handle('applications:events:list', (_event, input) =>
    client.applications.events.list(input as ApplicationEventsListInput),
  )
  ipcMain.handle('applications:links:list', (_event, input) =>
    client.applications.links.list(input as ApplicationLinksListInput),
  )
  ipcMain.handle('applications:links:create', (_event, input) =>
    client.applications.links.create(input as CreateApplicationLinkInput),
  )
  ipcMain.handle('applications:links:update', (_event, input) =>
    client.applications.links.update(input as UpdateApplicationLinkInput),
  )
  ipcMain.handle('applications:attempts:list', (_event, input) =>
    client.applications.attempts.list(input as ApplicationAttemptsListInput),
  )
}
