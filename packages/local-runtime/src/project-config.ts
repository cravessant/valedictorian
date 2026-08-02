import { cosmiconfigSync } from 'cosmiconfig'
import * as sparxie from '@sparxie/sdk'

/** Local workspace project-file discovery owned by the local runtime package. */
export interface ValedictorianProjectConfig {
  version: 1
  workspace: {
    name?: string
  }
}

export type ProjectConfigDiscoveryResult =
  | {
      config: ValedictorianProjectConfig
      path: string
      status: 'found'
    }
  | {
      status: 'not_found'
    }
  | {
      message: string
      path?: string
      status: 'invalid'
    }

export function loadValedictorianProjectConfig(cwd: string): ProjectConfigDiscoveryResult {
  const explorer = cosmiconfigSync('valedictorian', {
    searchPlaces: ['valedictorian.config.json', '.valedictorianrc.json', 'package.json'],
  })

  try {
    const result = explorer.search(cwd)

    if (!result || result.isEmpty) {
      return { status: 'not_found' }
    }

    return {
      config: parseProjectConfig(result.config),
      path: result.filepath,
      status: 'found',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      path: readErrorFilepath(error),
      status: 'invalid',
    }
  }
}

function parseProjectConfig(value: unknown): ValedictorianProjectConfig {
  const parser = (sparxie as { parseValedictorianProjectConfig?: (value: unknown) => ValedictorianProjectConfig })
    .parseValedictorianProjectConfig

  return parser ? parser(value) : parseProjectConfigCompat(value)
}

function parseProjectConfigCompat(value: unknown): ValedictorianProjectConfig {
  assertNoSecretLikeKeys(value)

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Valedictorian project config: expected an object')
  }

  const candidate = value as Record<string, unknown>
  const version = typeof candidate.version === 'number' ? candidate.version : 1

  if (version > 1) {
    throw new Error(`Project config version ${version} is newer than this package supports.`)
  }

  if (version !== 1) {
    throw new Error('Invalid Valedictorian project config: version must be 1')
  }

  const workspace = readWorkspaceConfig(candidate.workspace)

  return {
    version: 1,
    workspace,
  }
}

function readWorkspaceConfig(value: unknown): ValedictorianProjectConfig['workspace'] {
  if (value === undefined) {
    return {}
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Valedictorian project config: workspace must be an object')
  }

  const candidate = value as Record<string, unknown>

  if (candidate.name === undefined) {
    return {}
  }

  if (typeof candidate.name !== 'string') {
    throw new Error('Invalid Valedictorian project config: workspace.name must be a string')
  }

  const name = candidate.name.trim()

  if (!name) {
    throw new Error('Invalid Valedictorian project config: workspace.name must not be empty')
  }

  return { name }
}

function assertNoSecretLikeKeys(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoSecretLikeKeys(item)
    }
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (['apitoken', 'token', 'secret', 'clientsecret'].includes(key.toLowerCase())) {
      throw new Error(`Project config must not contain secret-like key: ${key}`)
    }

    assertNoSecretLikeKeys(child)
  }
}

function readErrorFilepath(error: unknown) {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const candidate = error as { filepath?: unknown }

  return typeof candidate.filepath === 'string' ? candidate.filepath : undefined
}
