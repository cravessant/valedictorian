import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { actionFailureToastInput } from './error-presentation'
import { APP_VIEWS, type MainAppView } from './types'
import { AppSidebar, AppTopbar } from './AppChrome'
import { useMediaQuery } from './useMediaQuery'
import { useWindowChromeState } from './use-window-chrome-state'
import type { AppSettings, AppSettingsPatch } from '@/settings/app-settings'

const narrowSidebarMediaQuery = '(max-width: 767px)'
const visibleAppViews: readonly MainAppView[] = [
  APP_VIEWS.CAPTURES,
  APP_VIEWS.JOBS,
  APP_VIEWS.OPPORTUNITIES,
  APP_VIEWS.APPLICATIONS,
  APP_VIEWS.CONNECTOR_RUNS,
]

interface AppNavigationShellProps {
  readonly children: ReactNode
  readonly currentView: MainAppView
  readonly settings: AppSettings
  readonly title: string
  readonly onSettingsPatch: (patch: AppSettingsPatch) => void | Promise<void>
  readonly onViewChange: (view: MainAppView) => void
}

export function AppNavigationShell({
  children,
  currentView,
  settings,
  title,
  onSettingsPatch,
  onViewChange,
}: AppNavigationShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false)
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false)
  const { toast } = useToast()
  const isNarrowViewport = useMediaQuery(narrowSidebarMediaQuery)
  const windowChromeState = useWindowChromeState()
  const sidebarVisible = isNarrowViewport
    ? narrowSidebarOpen
    : !settings.sidebarCollapsed || sidebarHoverExpanded
  const sidebarState = isNarrowViewport
    ? narrowSidebarOpen ? 'drawer-open' : 'drawer-closed'
    : settings.sidebarCollapsed
      ? sidebarHoverExpanded ? 'hover' : 'collapsed'
      : 'expanded'
  const temporaryDesktopSidebar = !isNarrowViewport
    && settings.sidebarCollapsed
    && sidebarHoverExpanded

  function closeTransientSidebar() {
    setSidebarHoverExpanded(false)
    setNarrowSidebarOpen(false)
  }

  function toggleSidebar() {
    if (isNarrowViewport) {
      setNarrowSidebarOpen((open) => !open)
      return
    }
    if (settings.sidebarCollapsed) {
      setSidebarHoverExpanded(false)
    }
    void Promise.resolve(onSettingsPatch({
      sidebarCollapsed: !settings.sidebarCollapsed,
    })).catch((error: unknown) => {
      toast(actionFailureToastInput(error, {
        fallbackMessage: 'Sidebar preference could not be saved.',
        operationId: 'settings:sidebar',
      }))
    })
  }

  return (
    <div
      className="relative min-h-screen text-foreground"
      data-sidebar-state={sidebarState}
      data-testid="app-shell"
      data-view={currentView}
    >
      <AppTopbar
        isFullScreen={windowChromeState.isFullScreen}
        sidebarCollapsed={isNarrowViewport ? !narrowSidebarOpen : settings.sidebarCollapsed}
        title={title}
        onToggleSidebar={toggleSidebar}
      />
      {!isNarrowViewport && settings.sidebarCollapsed && !sidebarHoverExpanded ? (
        <button
          type="button"
          aria-label="Show sidebar temporarily"
          className="app-no-drag absolute left-0 top-12 z-30 h-[calc(100vh-3rem)] w-2 cursor-default bg-transparent"
          onMouseEnter={() => setSidebarHoverExpanded(true)}
        />
      ) : null}
      <div
        className={`relative grid h-[calc(100vh-3rem)] grid-cols-1 grid-rows-1 overflow-hidden ${
          settings.sidebarCollapsed ? 'md:grid-cols-[0px_1fr]' : 'md:grid-cols-[280px_1fr]'
        }`}
        data-testid="app-layout"
      >
        {isNarrowViewport && narrowSidebarOpen ? (
          <Button
            type="button"
            variant="ghost"
            aria-label="Close sidebar drawer"
            className="absolute inset-0 z-30 h-auto rounded-none bg-background/70 p-0 hover:bg-background/70 md:hidden"
            onClick={() => setNarrowSidebarOpen(false)}
          />
        ) : null}
        {sidebarVisible ? (
          <AppSidebar
            currentView={currentView}
            settings={settings}
            settingsOpen={settingsOpen}
            temporary={temporaryDesktopSidebar}
            visibleViews={visibleAppViews}
            onMouseLeave={() => {
              if (!isNarrowViewport && settings.sidebarCollapsed) {
                setSidebarHoverExpanded(false)
              }
            }}
            onViewChange={(view) => {
              setSettingsOpen(false)
              closeTransientSidebar()
              onViewChange(view)
            }}
            onSettingsOpenChange={setSettingsOpen}
            onSettingsPatch={onSettingsPatch}
          />
        ) : null}
        <main className="h-full min-w-0 overflow-auto px-5 py-6 text-foreground sm:px-8 lg:px-10">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
