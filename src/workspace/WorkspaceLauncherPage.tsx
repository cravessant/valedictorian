import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CreateWorkspaceInput, WorkspaceLaunchState } from './workspace.service'

interface WorkspaceLauncherPageProps {
  launchState: Extract<WorkspaceLaunchState, { status: 'needs-workspace' }>
  onChooseCreateParentFolder: () => Promise<string | null>
  onCreateWorkspace: (input: CreateWorkspaceInput) => void
  onOpenFolder: () => void
  onOpenRecent: (workspaceId: string) => void
  onRemoveRecent: (workspaceId: string) => void
}

function WorkspaceLauncherPage({
  launchState,
  onChooseCreateParentFolder,
  onCreateWorkspace,
  onOpenFolder,
  onOpenRecent,
  onRemoveRecent,
}: WorkspaceLauncherPageProps) {
  const [view, setView] = useState<'home' | 'create'>('home')
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceParentPath, setWorkspaceParentPath] = useState('')
  const [seedSampleData, setSeedSampleData] = useState(false)
  const canCreate = workspaceName.trim().length > 0 && workspaceParentPath.length > 0
  const canSeedSampleData = launchState.devOptions.canSeedSampleData
  const chooseParentFolder = () => {
    void onChooseCreateParentFolder().then((parentPath) => {
      if (parentPath) {
        setWorkspaceParentPath(parentPath)
      }
    })
  }
  const submitCreateWorkspace = () => {
    if (!canCreate) {
      return
    }

    onCreateWorkspace({
      name: workspaceName.trim(),
      parentPath: workspaceParentPath,
      ...(canSeedSampleData && seedSampleData ? { seedData: 'sample' } : {}),
    })
  }

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <div
        data-testid="workspace-launcher-shell"
        className="grid h-screen grid-cols-[250px_minmax(0,1fr)] bg-card"
      >
        <aside
          aria-label="Recent workspaces"
          className="border-r border-border bg-card px-6 pb-6 pt-32"
        >
          <h2 className="sr-only">Recent workspaces</h2>
          <div className="space-y-2">
            {launchState.recentWorkspaces.length > 0 ? (
              launchState.recentWorkspaces.map((workspace) => (
                <div
                  key={workspace.id}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md px-2 hover:bg-accent/40"
                >
                  <button
                    type="button"
                    aria-label={
                      workspace.missing
                        ? `${workspace.name} unavailable`
                        : `Open ${workspace.name}`
                    }
                    className="min-w-0 rounded-md py-2 text-left disabled:cursor-default"
                    disabled={workspace.missing}
                    onClick={() => onOpenRecent(workspace.id)}
                  >
                    <span className="block truncate text-lg font-semibold text-foreground">
                      {workspace.name}
                    </span>
                    <span className="mt-1 block truncate text-sm font-medium text-muted-foreground">
                      {workspace.path}
                    </span>
                    {workspace.missing ? (
                      <span className="mt-2 block text-xs font-medium text-destructive">
                        Missing folder
                      </span>
                    ) : null}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 h-8 w-8 p-0 text-muted-foreground opacity-80"
                    aria-label={`Remove ${workspace.name}`}
                    onClick={() => onRemoveRecent(workspace.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                No recent workspaces
              </div>
            )}
          </div>
        </aside>

        <section className="flex h-screen items-center justify-center bg-background px-10 py-8">
          <div className="w-full max-w-[430px]">
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-normal text-foreground">
                Job Automation
              </h1>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                Workspace launcher
              </p>
            </div>

            {view === 'home' ? (
              <div className="mt-6 rounded-lg border border-border bg-card px-5 py-3.5 shadow-lg">
                <div className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-5 py-1">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">Create workspace</h2>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      Create a new workspace under a folder.
                    </p>
                  </div>
                  <Button
                    type="button"
                    aria-label="Create workspace"
                    className="h-8 rounded-md text-xs"
                    onClick={() => setView('create')}
                  >
                    Create
                  </Button>
                </div>

                <div className="my-4 h-px bg-border" />

                <div className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-5 py-1">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">
                      Open folder as workspace
                    </h2>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      Open an existing workspace folder.
                    </p>
                  </div>
                  <Button
                    type="button"
                    aria-label="Open folder"
                    variant="outline"
                    className="h-8 rounded-md text-xs"
                    onClick={onOpenFolder}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <button
                  type="button"
                  aria-label="Back"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setView('home')}
                >
                  Back
                </button>
                <h2 className="mt-4 text-lg font-semibold text-foreground">
                  Create local workspace
                </h2>

                <div className="mt-4 rounded-lg border border-border bg-card px-5 py-4 shadow-lg">
                  <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-5">
                    <div className="min-w-0">
                      <label
                        className="text-sm font-semibold text-foreground"
                        htmlFor="workspace-name"
                      >
                        Workspace name
                      </label>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        Name this workspace.
                      </p>
                    </div>
                    <input
                      className="h-8 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground"
                      id="workspace-name"
                      placeholder="New workspace name"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </div>

                  <div className="my-5 h-px bg-border" />

                  <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-5">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">Location</h3>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        Choose a parent folder.
                      </p>
                      {workspaceParentPath ? (
                        <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                          {workspaceParentPath}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      aria-label="Browse"
                      variant="outline"
                      className="h-8 rounded-md text-xs"
                      onClick={chooseParentFolder}
                    >
                      Browse
                    </Button>
                  </div>

                  {canSeedSampleData ? (
                    <>
                      <div className="my-5 h-px bg-border" />
                      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <input
                          checked={seedSampleData}
                          className="h-4 w-4 rounded border-border bg-background text-primary"
                          onChange={(event) => setSeedSampleData(event.target.checked)}
                          type="checkbox"
                        />
                        Seed demo data
                      </label>
                    </>
                  ) : null}
                </div>

                <div className="mt-6 flex justify-center">
                  <Button
                    type="button"
                    aria-label="Create workspace"
                    className="h-8 rounded-md px-5 text-xs"
                    disabled={!canCreate}
                    onClick={submitCreateWorkspace}
                  >
                    Create
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export { WorkspaceLauncherPage }
