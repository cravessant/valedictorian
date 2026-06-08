import type { WorkspaceService } from '../workspace/workspace.service'

interface IpcMainLike {
  handle(channel: string, handler: (event: unknown) => unknown): void
}

export function registerWorkspaceIpc(service: WorkspaceService, ipcMain: IpcMainLike) {
  ipcMain.handle('workspace:get-current', () => service.getCurrent())
  ipcMain.handle('workspace:list-recent', () => service.listRecent())
  ipcMain.handle('workspace:choose-folder', () => service.chooseFolder())
  ipcMain.handle('workspace:reveal-current', () => service.revealCurrent())
}
