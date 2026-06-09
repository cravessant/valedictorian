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
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      <div
        data-testid="workspace-launcher-shell"
        className="w-full max-w-xl rounded-md border border-border bg-card shadow-sm"
      >
        <header className="border-b border-border px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">Job App</p>
          <h1 className="mt-1 text-xl font-semibold tracking-normal text-foreground">
            Open a workspace
          </h1>
        </header>

        <div className="px-5 py-4">
          <section aria-labelledby="recent-workspaces-title" className="min-h-32">
            <h2 id="recent-workspaces-title" className="text-xs font-semibold text-foreground">
              Recent workspaces
            </h2>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border">
              {launchState.recentWorkspaces.length > 0 ? (
                launchState.recentWorkspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="grid gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
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
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant={workspace.missing ? 'ghost' : 'outline'}
                        className="h-8 px-2 text-xs"
                        disabled={workspace.missing}
                        onClick={() => onOpenRecent(workspace.id)}
                      >
                        {workspace.missing
                          ? `${workspace.name} unavailable`
                          : `Open ${workspace.name}`}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`Reveal ${workspace.name}`}
                        disabled={workspace.missing}
                        onClick={() => onReveal(workspace.path)}
                      >
                        <FolderOpen className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`Remove ${workspace.name}`}
                        onClick={() => onRemoveRecent(workspace.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No recent workspaces
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="space-y-3 border-t border-border px-5 py-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="gap-2 sm:w-40" onClick={onOpenFolder}>
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Open folder
            </Button>
            <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
              Workspace name
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </label>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={!canCreate}
            onClick={() => onCreateWorkspace({ name: workspaceName.trim() })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create workspace
          </Button>
        </footer>
      </div>
    </main>
  )
}

export { WorkspaceLauncherPage }
