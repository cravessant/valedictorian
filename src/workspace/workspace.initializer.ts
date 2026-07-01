import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { defaultAppSettings } from '../settings/app-settings'
import { loadValedictorianProjectConfig } from './project-config'
import { resolveWorkspaceLayout, type WorkspaceLayout } from './workspace.paths'

export interface WorkspaceManifest {
  app: 'valedictorian'
  workspaceVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSummary extends WorkspaceLayout {
  id: string
  name: string
}

export interface InitializeWorkspaceOptions {
  createId?: () => string
  now?: Date
}

export function initializeWorkspace(
  rootPath: string,
  { createId = () => crypto.randomUUID(), now = new Date() }: InitializeWorkspaceOptions = {},
): WorkspaceSummary {
  const layout = resolveWorkspaceLayout(rootPath)
  const manifest = readManifest(layout.manifestPath) ?? {
    app: 'valedictorian',
    workspaceVersion: 1,
    id: createId(),
    name: readInitialWorkspaceName(rootPath),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  fs.mkdirSync(layout.dataPath, { recursive: true })
  for (const directoryPath of [
    layout.automationsPath,
    layout.promptsPath,
    layout.templatesPath,
    layout.notesPath,
  ]) {
    fs.mkdirSync(directoryPath, { recursive: true })
  }
  writeJsonFile(layout.manifestPath, manifest)

  if (!fs.existsSync(layout.appSettingsPath)) {
    writeJsonFile(layout.appSettingsPath, defaultAppSettings)
  }

  return {
    ...layout,
    id: manifest.id,
    name: manifest.name,
  }
}

function readInitialWorkspaceName(rootPath: string) {
  const projectConfig = loadValedictorianProjectConfig(rootPath)

  if (projectConfig.status === 'found' && projectConfig.config.workspace.name) {
    return projectConfig.config.workspace.name
  }

  return path.basename(rootPath)
}

function readManifest(manifestPath: string): WorkspaceManifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown

    if (!value || typeof value !== 'object') {
      return null
    }

    const candidate = value as Record<string, unknown>

    if (
      candidate.app !== 'valedictorian' ||
      candidate.workspaceVersion !== 1 ||
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.createdAt !== 'string' ||
      typeof candidate.updatedAt !== 'string'
    ) {
      return null
    }

    return candidate as unknown as WorkspaceManifest
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
