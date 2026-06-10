import envPaths from 'env-paths'
import { join } from 'pathe'

export const workspaceDataDirectoryName = '.valedictorian'
export const workspaceManifestFileName = 'manifest.json'
export const workspaceAppSettingsFileName = 'app.json'
export const workspaceSqliteFileName = 'valedictorian.sqlite'

export interface WorkspaceLayout {
  rootPath: string
  dataPath: string
  manifestPath: string
  appSettingsPath: string
  sqlitePath: string
  automationsPath: string
  promptsPath: string
  templatesPath: string
  notesPath: string
}

export function resolveWorkspaceLayout(rootPath: string): WorkspaceLayout {
  const dataPath = join(rootPath, workspaceDataDirectoryName)

  return {
    rootPath,
    dataPath,
    manifestPath: join(dataPath, workspaceManifestFileName),
    appSettingsPath: join(dataPath, workspaceAppSettingsFileName),
    sqlitePath: join(dataPath, workspaceSqliteFileName),
    automationsPath: join(dataPath, 'automations'),
    promptsPath: join(dataPath, 'prompts'),
    templatesPath: join(dataPath, 'templates'),
    notesPath: join(dataPath, 'notes'),
  }
}

export function getDefaultWorkspaceRegistryPath(appDataPath?: string) {
  return join(appDataPath ?? envPaths('valedictorian', { suffix: '' }).data, 'workspaces.json')
}
