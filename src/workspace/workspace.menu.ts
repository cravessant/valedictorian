import type { WorkspaceLaunchRecord } from './workspace.service'

export interface WorkspaceMenuItem {
  accelerator?: string
  click?: () => void
  enabled?: boolean
  label?: string
  role?: string
  submenu?: WorkspaceMenuItem[]
  type?: 'separator'
}

export interface CreateWorkspaceMenuTemplateOptions {
  onOpenRecentWorkspace: (workspaceId: string) => void
  onOpenWorkspace: () => void
  platform: NodeJS.Platform
  recentWorkspaces: WorkspaceLaunchRecord[]
}

export function createWorkspaceMenuTemplate({
  onOpenRecentWorkspace,
  onOpenWorkspace,
  platform,
  recentWorkspaces,
}: CreateWorkspaceMenuTemplateOptions): WorkspaceMenuItem[] {
  const fileMenu: WorkspaceMenuItem = {
    label: 'File',
    submenu: [
      {
        accelerator: 'CommandOrControl+O',
        click: onOpenWorkspace,
        label: 'Open Workspace...',
      },
      {
        label: 'Open Recent Workspace',
        submenu: createRecentWorkspaceMenuItems(recentWorkspaces, onOpenRecentWorkspace),
      },
      { type: 'separator' },
      { role: platform === 'darwin' ? 'close' : 'quit' },
    ],
  }
  const editMenu: WorkspaceMenuItem = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  }
  const viewMenu: WorkspaceMenuItem = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
  const windowMenu: WorkspaceMenuItem = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(platform === 'darwin'
        ? ([{ type: 'separator' }, { role: 'front' }] satisfies WorkspaceMenuItem[])
        : ([{ role: 'close' }] satisfies WorkspaceMenuItem[])),
    ],
  }
  const helpMenu: WorkspaceMenuItem = {
    label: 'Help',
    submenu: [{ role: 'about' }],
  }

  if (platform !== 'darwin') {
    return [fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
  }

  return [
    {
      label: 'Valedictorian',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ]
}

function createRecentWorkspaceMenuItems(
  recentWorkspaces: WorkspaceLaunchRecord[],
  onOpenRecentWorkspace: (workspaceId: string) => void,
): WorkspaceMenuItem[] {
  const validWorkspaces = recentWorkspaces.filter((workspace) => !workspace.missing)

  if (validWorkspaces.length === 0) {
    return [
      {
        enabled: false,
        label: 'No Recent Workspaces',
      },
    ]
  }

  return validWorkspaces.map((workspace) => ({
    click: () => onOpenRecentWorkspace(workspace.id),
    label: workspace.name,
  }))
}
