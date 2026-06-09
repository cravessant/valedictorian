import { useEffect, useState, type ComponentProps } from 'react'
import App from './App'
import { defaultWorkspaceApi } from './app/loaders'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import { WorkspaceLauncherPage } from './workspace/WorkspaceLauncherPage'
import type { WorkspaceLaunchState } from './workspace/workspace.service'

interface AppRootProps {
  appProps?: ComponentProps<typeof App>
  workspaceApi?: WorkspacePreloadApi
}

function AppRoot({
  appProps = {},
  workspaceApi = defaultWorkspaceApi,
}: AppRootProps) {
  const [launchState, setLaunchState] = useState<WorkspaceLaunchState | null>(null)

  useEffect(() => {
    let isMounted = true

    void workspaceApi.getLaunchState().then((nextLaunchState) => {
      if (isMounted) {
        setLaunchState(nextLaunchState)
      }
    })

    return () => {
      isMounted = false
    }
  }, [workspaceApi])

  if (!launchState) {
    return (
      <main className="min-h-screen bg-background px-6 py-10 text-foreground">
        <p className="text-sm text-muted-foreground">Loading workspace...</p>
      </main>
    )
  }

  if (launchState.status === 'active') {
    return <App {...appProps} workspaceApi={workspaceApi} />
  }

  return (
    <WorkspaceLauncherPage
      launchState={launchState}
      onCreateWorkspace={(input) => {
        void workspaceApi.createWorkspace(input).then(setLaunchState)
      }}
      onOpenFolder={() => {
        void workspaceApi.openFolder().then(setLaunchState)
      }}
      onOpenRecent={(workspaceId) => {
        void workspaceApi.openRecent(workspaceId).then(setLaunchState)
      }}
      onRemoveRecent={(workspaceId) => {
        void workspaceApi.removeRecent(workspaceId).then(setLaunchState)
      }}
    />
  )
}

export default AppRoot
