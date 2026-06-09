import type { WorkspaceService } from '../workspace/workspace.service'

interface IpcMainLike {
  handle(channel: string, handler: (event: unknown, payload?: unknown) => unknown): void
}

export function registerWorkspaceIpc(service: WorkspaceService, ipcMain: IpcMainLike) {
  ipcMain.handle('workspace:get-current', () => service.getCurrent())
  ipcMain.handle('workspace:get-launch-state', () => service.getLaunchState())
  ipcMain.handle('workspace:list-recent', () => service.listRecent())
  ipcMain.handle('workspace:choose-folder', () => service.chooseFolder())
  ipcMain.handle('workspace:open-folder', () => service.openFolder())
  ipcMain.handle('workspace:open-recent', (_event, workspaceId) =>
    service.openRecent(workspaceId as string),
  )
  ipcMain.handle('workspace:create-workspace', (_event, input) =>
    service.createWorkspace(input as Parameters<WorkspaceService['createWorkspace']>[0]),
  )
  ipcMain.handle('workspace:remove-recent', (_event, workspaceId) =>
    service.removeRecent(workspaceId as string),
  )
  ipcMain.handle('workspace:reveal', (_event, workspacePath) =>
    service.reveal(workspacePath as string),
  )
  ipcMain.handle('workspace:reveal-current', () => service.revealCurrent())
}
