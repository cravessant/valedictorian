import type {
  WorkspaceFolderPickerOptions,
  WorkspaceService,
} from '../workspace/workspace.service'

interface IpcMainLike {
  handle(channel: string, handler: (event: unknown, payload?: unknown) => unknown): void
}

interface RegisterWorkspaceIpcOptions<ParentWindow> {
  getParentWindow?: (event: unknown) => ParentWindow | null
}

export function registerWorkspaceIpc<ParentWindow = unknown>(
  service: WorkspaceService<ParentWindow>,
  ipcMain: IpcMainLike,
  options: RegisterWorkspaceIpcOptions<ParentWindow> = {},
) {
  ipcMain.handle('workspace:choose-create-parent-folder', (event) =>
    service.chooseCreateParentFolder(readFolderPickerOptions(event, options)),
  )
  ipcMain.handle('workspace:get-current', () => service.getCurrent())
  ipcMain.handle('workspace:get-launch-state', () => service.getLaunchState())
  ipcMain.handle('workspace:list-recent', () => service.listRecent())
  ipcMain.handle('workspace:choose-folder', (event) =>
    service.chooseFolder(readFolderPickerOptions(event, options)),
  )
  ipcMain.handle('workspace:open-folder', (event) =>
    service.openFolder(readFolderPickerOptions(event, options)),
  )
  ipcMain.handle('workspace:open-recent', (_event, workspaceId) =>
    service.openRecent(workspaceId as string),
  )
  ipcMain.handle('workspace:create-workspace', (event, input) =>
    service.createWorkspace(
      input as Parameters<WorkspaceService['createWorkspace']>[0],
      readFolderPickerOptions(event, options),
    ),
  )
  ipcMain.handle('workspace:remove-recent', (_event, workspaceId) =>
    service.removeRecent(workspaceId as string),
  )
  ipcMain.handle('workspace:reveal', (_event, workspacePath) =>
    service.reveal(workspacePath as string),
  )
  ipcMain.handle('workspace:reveal-current', () => service.revealCurrent())
}

function readFolderPickerOptions<ParentWindow>(
  event: unknown,
  options: RegisterWorkspaceIpcOptions<ParentWindow>,
): WorkspaceFolderPickerOptions<ParentWindow> {
  return {
    parentWindow: options.getParentWindow?.(event) ?? null,
  }
}
