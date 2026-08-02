import type { WorkspaceLaunchRecord } from '@sparxie/valedictorian-local-runtime/workspace-runtime'

export interface WorkspaceMenuItem {
  accelerator?: string
  click?: () => void
  enabled?: boolean
  label?: string
  role?: string
  submenu?: WorkspaceMenuItem[]
  type?: 'separator'
}

export interface WorkspaceMenuFocusableWindow {
  label: string
  onFocus: () => void
}

export interface CreateWorkspaceMenuTemplateOptions {
  focusableWindows?: WorkspaceMenuFocusableWindow[]
  isDevelopment?: boolean
  onOpenRecentWorkspace: (workspaceId: string) => void
  onOpenSettings: () => void
  onOpenWorkspace: () => void
  platform: NodeJS.Platform
  recentWorkspaces: WorkspaceLaunchRecord[]
}

export function createWorkspaceMenuTemplate({
  focusableWindows = [],
  isDevelopment = false,
  onOpenRecentWorkspace,
  onOpenSettings,
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
      ...(isDevelopment
        ? ([
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
          ] satisfies WorkspaceMenuItem[])
        : []),
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
      ...createFocusableWindowMenuItems(focusableWindows),
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
        {
          accelerator: 'Command+,',
          click: onOpenSettings,
          label: 'Settings...',
        },
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

function createFocusableWindowMenuItems(
  focusableWindows: WorkspaceMenuFocusableWindow[],
): WorkspaceMenuItem[] {
  if (focusableWindows.length === 0) {
    return []
  }

  return [
    { type: 'separator' },
    ...focusableWindows.map((window) => ({
      click: window.onFocus,
      label: window.label,
    })),
  ]
}
