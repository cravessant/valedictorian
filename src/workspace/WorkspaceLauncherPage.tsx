import { useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item'
import { typography } from '@/components/ui/typography'
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
          className="border-r border-border bg-card px-6 pb-6 pt-14"
        >
          <h2 className="sr-only">Recent workspaces</h2>
          <div className="space-y-2">
            {launchState.recentWorkspaces.length > 0 ? (
              <ItemGroup>
                {launchState.recentWorkspaces.map((workspace) => (
                  <Item
                    key={workspace.id}
                    size="sm"
                    role="listitem"
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2 py-0 hover:bg-accent/40"
                  >
                    <ItemContent className="min-w-0 gap-0 py-2">
                      <ItemTitle className="block w-full truncate text-lg font-semibold text-foreground">
                        {workspace.name}
                      </ItemTitle>
                      <ItemDescription className="mt-1 block truncate text-nowrap text-sm font-medium text-muted-foreground">
                        {workspace.path}
                      </ItemDescription>
                      {workspace.missing ? (
                        <span className="mt-2 block text-xs font-medium text-destructive">
                          Missing folder
                        </span>
                      ) : null}
                    </ItemContent>
                    <ItemActions className="mt-2 gap-0">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={
                          workspace.missing
                            ? `${workspace.name} unavailable`
                            : `Open ${workspace.name}`
                        }
                        className="h-8 w-8 p-0 text-muted-foreground opacity-80"
                        disabled={workspace.missing}
                        onClick={() => onOpenRecent(workspace.id)}
                      >
                        <FolderOpen className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground opacity-80"
                        aria-label={`Remove ${workspace.name}`}
                        onClick={() => onRemoveRecent(workspace.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
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
              <h1 className={typography.pageTitle}>
                Valedictorian
              </h1>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                Workspace launcher
              </p>
            </div>

            {view === 'home' ? (
              <div className="mt-6 rounded-lg border border-border bg-card px-5 py-3.5 shadow-lg">
                <ItemGroup>
                  <Item
                    size="sm"
                    role="listitem"
                    className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-5 px-0 py-1"
                  >
                    <ItemContent className="min-w-0 gap-0">
                      <ItemTitle>
                        <h2 className={typography.panelTitle}>Create workspace</h2>
                      </ItemTitle>
                      <ItemDescription className="mt-1 text-xs font-medium text-muted-foreground">
                        Create a new workspace under a folder.
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        aria-label="Create workspace"
                        className="h-8 rounded-md text-xs"
                        onClick={() => setView('create')}
                      >
                        Create
                      </Button>
                    </ItemActions>
                  </Item>

                  <ItemSeparator className="my-4" />

                  <Item
                    size="sm"
                    role="listitem"
                    className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-5 px-0 py-1"
                  >
                    <ItemContent className="min-w-0 gap-0">
                      <ItemTitle>
                        <h2 className={typography.panelTitle}>
                          Open folder as workspace
                        </h2>
                      </ItemTitle>
                      <ItemDescription className="mt-1 text-xs font-medium text-muted-foreground">
                        Open an existing workspace folder.
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        aria-label="Open folder"
                        variant="outline"
                        className="h-8 rounded-md text-xs"
                        onClick={onOpenFolder}
                      >
                        Open
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </div>
            ) : (
              <div className="mt-6">
                <Button
                  type="button"
                  aria-label="Back"
                  variant="ghost"
                  size="xs"
                  className="h-auto px-0 py-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
                  onClick={() => setView('home')}
                >
                  Back
                </Button>
                <h2 className="mt-4 text-lg font-semibold text-foreground">
                  Create local workspace
                </h2>

                <div className="mt-4 rounded-lg border border-border bg-card px-5 py-4 shadow-lg">
                  <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-5">
                    <div className="min-w-0">
                      <Label
                        className="text-sm font-semibold text-foreground"
                        htmlFor="workspace-name"
                      >
                        Workspace name
                      </Label>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        Name this workspace.
                      </p>
                    </div>
                    <Input
                      className="h-8 text-xs"
                      id="workspace-name"
                      placeholder="New workspace name"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </div>

                  <Separator className="my-5" />

                  <div className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-5">
                    <div className="min-w-0">
                      <h3 className={typography.panelTitle}>Location</h3>
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
                      <Separator className="my-5" />
                      <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground" htmlFor="workspace-seed-demo-data">
                        <Checkbox
                          checked={seedSampleData}
                          id="workspace-seed-demo-data"
                          onCheckedChange={(value) => setSeedSampleData(value === true)}
                        />
                        Seed demo data
                      </Label>
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
