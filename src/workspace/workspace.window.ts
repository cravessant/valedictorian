export interface WorkspaceWindowIdentity {
  name: string
}

export function createWorkspaceWindowTitle(workspace: WorkspaceWindowIdentity | null) {
  if (!workspace) {
    return 'Valedictorian'
  }

  return `${workspace.name} - Valedictorian`
}
