import { useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CreateWorkspaceInput, WorkspaceLaunchState } from './workspace.service'

interface WorkspaceLauncherPageProps {
  launchState: Extract<WorkspaceLaunchState, { status: 'needs-workspace' }>
  onCreateWorkspace: (input: CreateWorkspaceInput) => void
  onOpenFolder: () => void
  onOpenRecent: (workspaceId: string) => void
  onRemoveRecent: (workspaceId: string) => void
  onReveal: (workspacePath: string) => void
}

function WorkspaceLauncherPage({
  launchState,
  onCreateWorkspace,
  onOpenFolder,
  onOpenRecent,
  onRemoveRecent,
  onReveal,
}: WorkspaceLauncherPageProps) {
  const [workspaceName, setWorkspaceName] = useState('')
  const canCreate = workspaceName.trim().length > 0

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
        <header className="border-b border-border pb-6">
          <p className="text-sm font-medium text-muted-foreground">Job App</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground">
            Open a workspace
          </h1>
        </header>

        <div className="grid flex-1 gap-8 py-8 lg:grid-cols-[1fr_320px]">
          <section aria-labelledby="recent-workspaces-title">
            <h2 id="recent-workspaces-title" className="text-sm font-semibold text-foreground">
              Recent workspaces
            </h2>
            <div className="mt-3 space-y-2">
              {launchState.recentWorkspaces.length > 0 ? (
                launchState.recentWorkspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {workspace.name}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {workspace.path}
                      </p>
                      {workspace.missing ? (
                        <p className="mt-2 text-xs font-medium text-destructive">Missing folder</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={workspace.missing}
                        onClick={() => onOpenRecent(workspace.id)}
                      >
                        {workspace.missing ? `${workspace.name} unavailable` : `Open ${workspace.name}`}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 w-9 p-0"
                        aria-label={`Reveal ${workspace.name}`}
                        disabled={workspace.missing}
                        onClick={() => onReveal(workspace.path)}
                      >
                        <FolderOpen className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 w-9 p-0"
                        aria-label={`Remove ${workspace.name}`}
                        onClick={() => onRemoveRecent(workspace.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                  No recent workspaces
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <section aria-labelledby="open-workspace-title" className="rounded-md border border-border bg-card p-4">
              <h2 id="open-workspace-title" className="text-sm font-semibold text-foreground">
                Open
              </h2>
              <Button type="button" className="mt-3 w-full gap-2" onClick={onOpenFolder}>
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                Open folder
              </Button>
            </section>

            <section aria-labelledby="create-workspace-title" className="rounded-md border border-border bg-card p-4">
              <h2 id="create-workspace-title" className="text-sm font-semibold text-foreground">
                Create
              </h2>
              <label className="mt-3 block text-xs font-medium text-muted-foreground">
                Workspace name
                <input
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              </label>
              <Button
                type="button"
                className="mt-3 w-full gap-2"
                disabled={!canCreate}
                onClick={() => onCreateWorkspace({ name: workspaceName.trim() })}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create workspace
              </Button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}

export { WorkspaceLauncherPage }
