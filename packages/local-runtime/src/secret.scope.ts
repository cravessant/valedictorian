/** Nominal scopes prevent application and workspace ciphertext stores from mixing. */
export type ApplicationSecretScope = {
  readonly domain: 'application'
}

export type WorkspaceSecretScope = {
  readonly domain: 'workspace'
  readonly workspaceId: string
}

export type SecretScope = ApplicationSecretScope | WorkspaceSecretScope

export function createApplicationSecretScope(): ApplicationSecretScope {
  return Object.freeze({ domain: 'application' })
}

export function createWorkspaceSecretScope(workspaceId: string): WorkspaceSecretScope {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('workspaceId is required')
  }

  return Object.freeze({ domain: 'workspace', workspaceId })
}
