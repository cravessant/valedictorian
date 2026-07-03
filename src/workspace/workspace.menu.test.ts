import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceMenuTemplate, type WorkspaceMenuItem } from './workspace.menu'

function findMenuItem(items: WorkspaceMenuItem[], label: string) {
  return items.find((item) => item.label === label)
}

describe('workspace native menu template', () => {
  it('builds a macOS app menu and workspace file menu', () => {
    const onOpenWorkspace = vi.fn()
    const onOpenRecentWorkspace = vi.fn()
    const onOpenSettings = vi.fn()

    const template = createWorkspaceMenuTemplate({
      platform: 'darwin',
      recentWorkspaces: [
        {
          id: 'workspace-valid',
          lastOpenedAt: '2026-06-09T12:00:00.000Z',
          missing: false,
          name: 'Job Search',
          open: true,
          path: '/Users/keni/Job Search',
        },
        {
          id: 'workspace-missing',
          lastOpenedAt: '2026-06-08T12:00:00.000Z',
          missing: true,
          name: 'Missing Search',
          open: false,
          path: '/Users/keni/Missing Search',
        },
      ],
      onOpenRecentWorkspace,
      onOpenWorkspace,
      onOpenSettings,
    })

    expect(template[0]).toMatchObject({
      label: 'Valedictorian',
    })
    const appMenuSettings = findMenuItem(template[0].submenu ?? [], 'Settings...')
    expect(appMenuSettings).toMatchObject({
      accelerator: 'Command+,',
      label: 'Settings...',
    })
    appMenuSettings?.click?.()
    expect(onOpenSettings).toHaveBeenCalled()

    const fileMenu = findMenuItem(template, 'File')
    const openWorkspace = findMenuItem(fileMenu?.submenu ?? [], 'Open Workspace...')
    const recentMenu = findMenuItem(fileMenu?.submenu ?? [], 'Open Recent Workspace')

    expect(openWorkspace).toMatchObject({
      accelerator: 'CommandOrControl+O',
      label: 'Open Workspace...',
    })
    openWorkspace?.click?.()
    expect(onOpenWorkspace).toHaveBeenCalled()
    expect(recentMenu?.submenu?.map((item) => item.label)).toEqual(['Job Search'])
    recentMenu?.submenu?.[0]?.click?.()
    expect(onOpenRecentWorkspace).toHaveBeenCalledWith('workspace-valid')
  })

  it('builds a visible Windows/Linux file menu with disabled empty recents', () => {
    const template = createWorkspaceMenuTemplate({
      platform: 'win32',
      recentWorkspaces: [],
      onOpenRecentWorkspace: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenWorkspace: vi.fn(),
    })

    expect(template[0]).toMatchObject({
      label: 'File',
    })
    const recentMenu = findMenuItem(template[0].submenu ?? [], 'Open Recent Workspace')

    expect(recentMenu?.submenu).toEqual([
      {
        enabled: false,
        label: 'No Recent Workspaces',
      },
    ])
  })

  it('omits development-only view actions in production menus', () => {
    const template = createWorkspaceMenuTemplate({
      isDevelopment: false,
      platform: 'darwin',
      recentWorkspaces: [],
      onOpenRecentWorkspace: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenWorkspace: vi.fn(),
    })
    const viewMenu = findMenuItem(template, 'View')
    const viewRoles = viewMenu?.submenu?.map((item) => item.role) ?? []

    expect(viewRoles).not.toContain('reload')
    expect(viewRoles).not.toContain('forceReload')
    expect(viewRoles).not.toContain('toggleDevTools')
    expect(viewRoles).toEqual(expect.arrayContaining(['resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']))
  })

  it('keeps reload and developer tools actions in development menus', () => {
    const template = createWorkspaceMenuTemplate({
      isDevelopment: true,
      platform: 'darwin',
      recentWorkspaces: [],
      onOpenRecentWorkspace: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenWorkspace: vi.fn(),
    })
    const viewMenu = findMenuItem(template, 'View')
    const viewRoles = viewMenu?.submenu?.map((item) => item.role) ?? []

    expect(viewRoles).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']))
  })

  it('keeps standard macOS window actions and includes focusable app windows', () => {
    const onFocusWorkspaceWindow = vi.fn()
    const onFocusLauncherWindow = vi.fn()

    const template = createWorkspaceMenuTemplate({
      focusableWindows: [
        {
          label: 'Job Search',
          onFocus: onFocusWorkspaceWindow,
        },
        {
          label: 'Workspace Launcher',
          onFocus: onFocusLauncherWindow,
        },
      ],
      platform: 'darwin',
      recentWorkspaces: [],
      onOpenRecentWorkspace: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenWorkspace: vi.fn(),
    })
    const windowMenu = findMenuItem(template, 'Window')

    expect(windowMenu?.submenu).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'minimize' }),
        expect.objectContaining({ role: 'zoom' }),
        expect.objectContaining({ role: 'front' }),
      ]),
    )
    const workspaceWindow = findMenuItem(windowMenu?.submenu ?? [], 'Job Search')
    const launcherWindow = findMenuItem(windowMenu?.submenu ?? [], 'Workspace Launcher')

    workspaceWindow?.click?.()
    launcherWindow?.click?.()
    expect(onFocusWorkspaceWindow).toHaveBeenCalled()
    expect(onFocusLauncherWindow).toHaveBeenCalled()
  })
})
