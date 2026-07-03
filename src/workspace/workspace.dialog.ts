import type { WorkspaceFolderPickerOptions } from './workspace.service'

type WorkspaceFolderDialogProperty = 'openDirectory' | 'createDirectory'

export interface WorkspaceFolderDialogOptions {
  buttonLabel: string
  properties: WorkspaceFolderDialogProperty[]
  title: string
}

export interface WorkspaceFolderDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface CreateWorkspaceFolderPickerOptions<ParentWindow> {
  buttonLabel: string
  showOpenDialog: (
    ...args:
      | [options: WorkspaceFolderDialogOptions]
      | [parentWindow: ParentWindow, options: WorkspaceFolderDialogOptions]
  ) => Promise<WorkspaceFolderDialogResult>
  title: string
}

export function createWorkspaceFolderPicker<ParentWindow = unknown>({
  buttonLabel,
  showOpenDialog,
  title,
}: CreateWorkspaceFolderPickerOptions<ParentWindow>) {
  return async ({
    parentWindow,
  }: WorkspaceFolderPickerOptions<ParentWindow> = {}): Promise<string | null> => {
    const dialogOptions = {
      buttonLabel,
      properties: ['openDirectory', 'createDirectory'],
      title,
    } satisfies WorkspaceFolderDialogOptions
    const result = parentWindow
      ? await showOpenDialog(parentWindow, dialogOptions)
      : await showOpenDialog(dialogOptions)

    if (result.canceled) {
      return null
    }

    return result.filePaths[0] ?? null
  }
}
