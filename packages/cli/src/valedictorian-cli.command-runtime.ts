import fs from 'node:fs'
import {
  buildCommand,
  type CommandBuilderArguments,
  type CommandContext,
  type CommandFunction,
  type StricliProcess,
} from '@stricli/core'
import {
  profileSecretKinds,
  type ProfileSecretKind,
  type ValedictorianClient,
  type ValedictorianWorkspaceClient,
} from 'sparxie'

import { formatHumanOutput } from './valedictorian-cli.output.js'
import { readRequiredText } from './valedictorian-cli.parsers.js'
import type { SecretsRunSpawnAdapter } from './valedictorian-cli.secrets-run-spawn.js'
import { isLocalApiUrl, readLocalWorkspaceList } from './valedictorian-cli.workspaces.js'

export interface ValedictorianCliContext extends CommandContext {
  readonly apiBaseUrl: string
  readonly apiToken?: string
  /**
   * Exact argv tokens after the first `--` in the normalized invocation, or `null`
   * when the escape marker is absent.
   */
  readonly argvEscapeSuffix: readonly string[] | null
  readonly client: ValedictorianClient
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  outputJson?: boolean
  readonly process: StricliProcess
  readonly secretsRunSpawn?: SecretsRunSpawnAdapter
}

const stringParser = (input: string) => input

const jsonFlag = {
  brief: 'Output as JSON.',
  kind: 'boolean',
  optional: true,
} as const

type RawFlagValue = string | boolean | readonly string[] | undefined
export type RawFlags = Readonly<Record<string, RawFlagValue>>
type CommandRunner = (
  context: ValedictorianCliContext,
  flags: RawFlags,
  ...args: string[]
) => Promise<void> | void

export function makeCommand({
  docs,
  flags = {},
  positionalCount = 0,
  run,
}: {
  docs: { brief: string; fullDescription?: string }
  flags?: Record<string, unknown>
  positionalCount?: number | { minimum: number; maximum?: number }
  run: CommandRunner
}) {
  const positionalBounds =
    typeof positionalCount === 'number'
      ? positionalCount > 0
        ? { minimum: positionalCount, maximum: positionalCount }
        : null
      : {
          minimum: positionalCount.minimum,
          ...(positionalCount.maximum === undefined ||
          !Number.isFinite(positionalCount.maximum)
            ? {}
            : { maximum: positionalCount.maximum }),
        }

  const parameters = {
    flags: {
      json: jsonFlag,
      ...flags,
    },
    ...(positionalBounds
      ? {
          positional: {
            kind: 'array',
            ...positionalBounds,
            parameter: {
              brief: 'Command argument',
              parse: stringParser,
              placeholder: 'argument',
            },
          },
        }
      : {}),
  } as const

  return buildCommand<RawFlags, string[], ValedictorianCliContext>({
    docs,
    parameters,
    func: async function command(flags, ...args) {
      this.outputJson = flags.json === true

      try {
        await run(this, flags, ...args)
      } catch (error) {
        return toError(error)
      }
    } satisfies CommandFunction<RawFlags, string[], ValedictorianCliContext>,
  } as unknown as CommandBuilderArguments<RawFlags, string[], ValedictorianCliContext>)
}

export function optionFlags(optional: string[] = [], required: string[] = []) {
  const result: Record<string, unknown> = {}

  for (const name of optional) {
    result[name] = {
      brief: readableOptionName(name),
      kind: 'parsed',
      optional: true,
      parse: stringParser,
    }
  }

  for (const name of required) {
    result[name] = {
      brief: readableOptionName(name),
      kind: 'parsed',
      parse: stringParser,
    }
  }

  return result
}

export function booleanFlags(names: string[]) {
  const result: Record<string, unknown> = {}

  for (const name of names) {
    result[name] = {
      brief: readableOptionName(name),
      kind: 'boolean',
      optional: true,
    }
  }

  return result
}

function toArgv(flags: RawFlags) {
  const argv: string[] = []

  for (const [name, value] of Object.entries(flags)) {
    if (name === 'json' || value === undefined || value === false) {
      continue
    }

    const option = `--${name}`

    if (value === true) {
      argv.push(option)
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        argv.push(option, String(item))
      }
      continue
    }

    argv.push(option, String(value))
  }

  return argv
}

export function toArgvWithoutWorkspace(flags: RawFlags) {
  const { workspace: _workspace, ...rest } = flags
  return toArgv(rest)
}

export async function workspaceClient(
  context: ValedictorianCliContext,
  flags: RawFlags,
): Promise<ValedictorianWorkspaceClient> {
  const workspaceId = await resolveWorkspaceId(
    context,
    readRequiredText(optionValue(flags, 'workspace'), '--workspace'),
  )
  return context.client.forWorkspace(workspaceId)
}

export async function workspaceConnectorClient(
  context: ValedictorianCliContext,
  flags: RawFlags,
): Promise<ValedictorianWorkspaceClient['connectors']> {
  return (await workspaceClient(context, flags)).connectors
}

async function resolveWorkspaceId(context: ValedictorianCliContext, selector: string) {
  if (looksLikeWorkspaceId(selector)) {
    return selector
  }

  const result = (await listWorkspaces(context)) as {
    items?: Array<{ id: string; name: string }>
  }
  const workspaces = Array.isArray(result.items) ? result.items : []
  const idMatch = workspaces.find((workspace) => workspace.id === selector)

  if (idMatch) {
    return idMatch.id
  }

  const exactNameMatches = workspaces.filter((workspace) => workspace.name === selector)

  if (exactNameMatches.length === 1) {
    return exactNameMatches[0].id
  }

  if (exactNameMatches.length > 1) {
    throw new Error(formatAmbiguousWorkspaceError(selector, exactNameMatches))
  }

  const lowerSelector = selector.toLocaleLowerCase()
  const caseInsensitiveMatches = workspaces.filter(
    (workspace) => workspace.name.toLocaleLowerCase() === lowerSelector,
  )

  if (caseInsensitiveMatches.length === 1) {
    return caseInsensitiveMatches[0].id
  }

  if (caseInsensitiveMatches.length > 1) {
    throw new Error(formatAmbiguousWorkspaceError(selector, caseInsensitiveMatches))
  }

  throw new Error(`Workspace not found: ${selector}`)
}

function looksLikeWorkspaceId(selector: string) {
  return (
    /^workspace[-_]/i.test(selector) ||
    /^ws[-_]/i.test(selector) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      selector,
    )
  )
}

function formatAmbiguousWorkspaceError(
  selector: string,
  workspaces: Array<{ id: string; name: string }>,
) {
  return `Workspace name is ambiguous: ${selector}. Rerun with an id: ${workspaces
    .map((workspace) => `${workspace.name} (${workspace.id})`)
    .join(', ')}`
}

export async function listWorkspaces(context: ValedictorianCliContext) {
  const clientWithWorkspaces = context.client as ValedictorianClient & {
    workspaces?: {
      list(): Promise<unknown>
    }
  }

  try {
    if (clientWithWorkspaces.workspaces) {
      return await clientWithWorkspaces.workspaces.list()
    }

    return await requestJson(context, '/v1/workspaces')
  } catch (error) {
    const localWorkspaces = isLocalApiUrl(context.apiBaseUrl)
      ? readLocalWorkspaceList(context.env)
      : null

    if (localWorkspaces) {
      return localWorkspaces
    }

    throw error
  }
}

export async function openWorkspace(context: ValedictorianCliContext, path: string, rekey: boolean) {
  const clientWithWorkspaces = context.client as ValedictorianClient & {
    workspaces?: {
      open(input: { path: string; rekey?: boolean }): Promise<unknown>
    }
  }
  const input = rekey ? { path, rekey } : { path }

  if (clientWithWorkspaces.workspaces) {
    return clientWithWorkspaces.workspaces.open(input)
  }

  return requestJson(context, '/v1/workspaces/open', {
    body: input,
    method: 'POST',
  })
}

export async function createWorkspace(context: ValedictorianCliContext, path: string) {
  const clientWithWorkspaces = context.client as ValedictorianClient & {
    workspaces?: {
      create(input: { path: string }): Promise<unknown>
    }
  }
  const input = { path }

  if (clientWithWorkspaces.workspaces) {
    return clientWithWorkspaces.workspaces.create(input)
  }

  return requestJson(context, '/v1/workspaces/create', {
    body: input,
    method: 'POST',
  })
}

async function requestJson(
  context: ValedictorianCliContext,
  path: string,
  options: { body?: unknown; method?: 'GET' | 'POST' } = {},
) {
  const url = new URL(path, context.apiBaseUrl)
  const headers: Record<string, string> = {
    accept: 'application/json',
  }

  if (context.apiToken) {
    headers.authorization = `Bearer ${context.apiToken}`
  }

  const init: RequestInit = {
    headers,
    method: options.method ?? 'GET',
  }

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  const response = await fetch(url.toString(), init)
  const body = await response.json().catch(() => undefined)

  if (!response.ok) {
    throw new Error(readResponseMessage(body, response.statusText))
  }

  return body
}

function readResponseMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message
  }

  return fallback || 'Valedictorian request failed'
}


export function optionValue(flags: RawFlags, name: string) {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

export function requiredOption(flags: RawFlags, name: string, label: string) {
  return readRequiredText(optionValue(flags, name), label)
}

export function parseProfileSecretKind(value: string): ProfileSecretKind {
  if (profileSecretKinds.includes(value as ProfileSecretKind)) {
    return value as ProfileSecretKind
  }

  throw new Error(`Invalid profile secret kind: ${value}`)
}

export function readJsonObjectFile<T extends object>(path: string, label: string): T {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }

  return parsed as T
}

export function writeJson(context: ValedictorianCliContext, value: unknown, pretty = true) {
  if (context.outputJson) {
    context.process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`)
    return
  }

  context.process.stdout.write(formatHumanOutput(value))
}

export function normalizeArgv(argv: string[]) {
  const normalized = argv[0] === '--' ? argv.slice(1) : [...argv]
  const leadingFlags: string[] = []
  let index = 0

  while (index < normalized.length) {
    const token = normalized[index]

    if (token === '--json') {
      leadingFlags.push(token)
      index += 1
      continue
    }

    if (token === '--workspace') {
      const value = normalized[index + 1]

      if (value === undefined || value.startsWith('--')) {
        return normalized
      }

      leadingFlags.push(token, value)
      index += 2
      continue
    }

    break
  }

  if (leadingFlags.length > 0) {
    return normalizeLeadingFlags(normalized.slice(index), leadingFlags)
  }

  if (normalized[0] !== '--json') {
    return normalized
  }

  const withoutGlobalJson = normalized.slice(1)

  if (
    withoutGlobalJson.length === 0 ||
    withoutGlobalJson[0] === '--help' ||
    withoutGlobalJson[0] === '-h' ||
    withoutGlobalJson[0] === '--version' ||
    withoutGlobalJson[0] === '-v' ||
    withoutGlobalJson.includes('--json')
  ) {
    return withoutGlobalJson
  }

  return insertBeforeEscape(withoutGlobalJson, ['--json'])
}

/** Exact tokens after the first `--`, or `null` when the marker is absent. */
export function readArgvEscapeSuffix(argv: readonly string[]): readonly string[] | null {
  const escapeIndex = argv.indexOf('--')
  if (escapeIndex === -1) {
    return null
  }
  return argv.slice(escapeIndex + 1)
}

function normalizeLeadingFlags(argv: string[], leadingFlags: string[]) {
  let result = [...argv]
  const commandTokens = tokensBeforeEscape(result)
  const hasGlobalJson = leadingFlags.includes('--json')
  const globalWorkspaceIndex = leadingFlags.indexOf('--workspace')
  const flagsToInsert: string[] = []

  if (
    hasGlobalJson &&
    result.length > 0 &&
    !isHelpOrVersion(result) &&
    !commandTokens.includes('--json')
  ) {
    flagsToInsert.push('--json')
  }

  if (
    globalWorkspaceIndex >= 0 &&
    shouldForwardGlobalWorkspace(result) &&
    !commandTokens.includes('--workspace')
  ) {
    flagsToInsert.push('--workspace', leadingFlags[globalWorkspaceIndex + 1])
  }

  if (flagsToInsert.length === 0) {
    return result
  }

  return insertBeforeEscape(result, flagsToInsert)
}

function tokensBeforeEscape(argv: string[]) {
  const escapeIndex = argv.indexOf('--')
  return escapeIndex === -1 ? argv : argv.slice(0, escapeIndex)
}

function insertBeforeEscape(argv: string[], flags: readonly string[]) {
  const escapeIndex = argv.indexOf('--')
  if (escapeIndex === -1) {
    return [...argv, ...flags]
  }
  return [...argv.slice(0, escapeIndex), ...flags, ...argv.slice(escapeIndex)]
}

function isHelpOrVersion(argv: string[]) {
  return (
    argv.length === 0 ||
    argv[0] === '--help' ||
    argv[0] === '-h' ||
    argv[0] === '--version' ||
    argv[0] === '-v'
  )
}

function shouldForwardGlobalWorkspace(argv: string[]) {
  if (isHelpOrVersion(argv)) {
    return false
  }

  return argv[0] !== 'workspaces' && argv[0] !== 'examples'
}

export function parseTimeoutMs(value: string | undefined) {
  if (value === undefined) {
    return 3000
  }

  const timeoutMs = Number(value)

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${value}`)
  }

  return timeoutMs
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function readableOptionName(name: string) {
  return name.replace(/-/g, ' ')
}

export function definedEnv(env: Record<string, string | undefined>) {
  const output: Record<string, string> = {}

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      output[name] = value
    }
  }

  return output
}

export async function readPackageVersion() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string }

    return packageJson.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
