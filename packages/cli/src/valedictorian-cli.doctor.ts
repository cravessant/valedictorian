import {
  defaultValedictorianApiBaseUrl,
  valedictorianApiPaths,
  type ValedictorianCapabilities,
  type WorkspaceListItem,
} from 'sparxie'

type DoctorClassification = 'local' | 'staging' | 'production' | 'invalid'
type DoctorCheckStatus = 'pass' | 'fail' | 'skip'
type WorkspaceResolutionStatus = 'ambiguous' | 'not_found' | 'not_requested' | 'resolved' | 'skipped'

export interface DoctorCheck {
  readonly name: string
  readonly status: DoctorCheckStatus
  readonly message: string
  readonly details?: Record<string, unknown>
}

export interface DoctorReport {
  readonly ok: boolean
  readonly cliVersion: string
  readonly nodeVersion: string
  readonly target: {
    readonly apiUrl: string
    readonly classification: DoctorClassification
    readonly tokenPresent: boolean
  }
  readonly workspace: DoctorWorkspaceContext
  readonly capabilities?: Partial<ValedictorianCapabilities> & Record<string, unknown>
  readonly checks: DoctorCheck[]
}

export interface DoctorWorkspaceContext {
  readonly selector?: string
  readonly resolution: WorkspaceResolutionStatus
  readonly id?: string
  readonly name?: string
  readonly open?: boolean
  readonly path?: string
  readonly source?: string
  readonly openWorkspaces?: Array<Pick<WorkspaceListItem, 'id' | 'name' | 'open' | 'source'>>
}

export interface CliContextReport {
  readonly target: DoctorReport['target']
  readonly workspace: DoctorWorkspaceContext & {
    readonly note: string
  }
  readonly capabilities?: DoctorReport['capabilities']
}

export async function runDoctor({
  cliVersion,
  env,
  skipNetwork,
  timeoutMs,
  workspaceSelector,
}: {
  cliVersion: string
  env: Record<string, string | undefined>
  skipNetwork: boolean
  timeoutMs: number
  workspaceSelector?: string
}): Promise<DoctorReport> {
  const rawApiUrl = env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl
  const apiUrl = sanitizeApiUrl(rawApiUrl)
  const classification = classifyApiUrl(rawApiUrl)
  let workspace: DoctorWorkspaceContext = { resolution: 'not_requested' }
  let capabilities: DoctorReport['capabilities']
  const checks: DoctorCheck[] = [
    nodeVersionCheck(),
    apiUrlCheck(rawApiUrl, classification),
  ]

  if (skipNetwork) {
    checks.push(skipCheck('api-health'))
    checks.push(skipCheck('capabilities'))
    workspace = {
      resolution: 'skipped',
      selector: workspaceSelector,
    }
    checks.push(skipCheck('workspace'))
    checks.push(skipCheck('workspace-route-scope'))
  } else {
    checks.push(await apiHealthCheck(rawApiUrl, env.VALEDICTORIAN_API_TOKEN, timeoutMs))

    const capabilitiesResult = await capabilitiesCheck(rawApiUrl, env.VALEDICTORIAN_API_TOKEN, timeoutMs)
    checks.push(capabilitiesResult.check)
    capabilities = capabilitiesResult.capabilities

    const workspaceResult = await workspaceCheck(
      rawApiUrl,
      env.VALEDICTORIAN_API_TOKEN,
      timeoutMs,
      workspaceSelector,
    )
    checks.push(workspaceResult.check)
    workspace = workspaceResult.workspace
    checks.push(
      await workspaceRouteScopeCheck(
        rawApiUrl,
        env.VALEDICTORIAN_API_TOKEN,
        timeoutMs,
        workspace.id,
      ),
    )
  }

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    cliVersion,
    nodeVersion: `v${process.versions.node}`,
    target: {
      apiUrl,
      classification,
      tokenPresent: Boolean(env.VALEDICTORIAN_API_TOKEN),
    },
    workspace,
    capabilities,
    checks,
  }
}

export async function runContext({
  env,
  skipNetwork,
  timeoutMs,
  workspaceSelector,
}: {
  env: Record<string, string | undefined>
  skipNetwork: boolean
  timeoutMs: number
  workspaceSelector?: string
}): Promise<CliContextReport> {
  const rawApiUrl = env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl
  const target = {
    apiUrl: sanitizeApiUrl(rawApiUrl),
    classification: classifyApiUrl(rawApiUrl),
    tokenPresent: Boolean(env.VALEDICTORIAN_API_TOKEN),
  }

  if (skipNetwork) {
    return {
      target,
      workspace: {
        resolution: 'skipped',
        selector: workspaceSelector,
        note: 'Skipped workspace discovery by --skip-network.',
      },
    }
  }

  const capabilitiesResult = await capabilitiesCheck(rawApiUrl, env.VALEDICTORIAN_API_TOKEN, timeoutMs)
  const workspaceResult = await workspaceCheck(
    rawApiUrl,
    env.VALEDICTORIAN_API_TOKEN,
    timeoutMs,
    workspaceSelector,
  )

  return {
    target,
    workspace: {
      ...workspaceResult.workspace,
      note:
        workspaceResult.workspace.resolution === 'resolved'
          ? 'Workspace resolved explicitly. Workspace-scoped commands still require --workspace.'
          : 'No implicit CLI workspace is active. Pass --workspace <id-or-name> for workspace-scoped commands.',
    },
    capabilities: capabilitiesResult.capabilities,
  }
}

export function formatDoctorText(report: DoctorReport) {
  const lines = [
    'Valedictorian CLI doctor',
    `Status: ${report.ok ? 'ok' : 'failed'}`,
    `CLI version: ${report.cliVersion}`,
    `Node: ${report.nodeVersion}`,
    `API URL: ${report.target.apiUrl} (${report.target.classification})`,
    `Token: ${report.target.tokenPresent ? 'present' : 'not set'}`,
    `Workspace: ${formatWorkspace(report.workspace)}`,
    report.capabilities ? `Capabilities: ${formatCapabilities(report.capabilities)}` : undefined,
    'Checks:',
    ...report.checks.map((check) => `  ${check.status.toUpperCase()} ${check.name}: ${check.message}`),
  ].filter((line): line is string => line !== undefined)

  return `${lines.join('\n')}\n`
}

function nodeVersionCheck(): DoctorCheck {
  const required = '22.12.0'
  const actual = process.versions.node
  const ok = compareVersions(actual, required) >= 0

  return {
    name: 'node',
    status: ok ? 'pass' : 'fail',
    message: ok
      ? `v${actual} satisfies >=${required}.`
      : `v${actual} does not satisfy >=${required}.`,
  }
}

function apiUrlCheck(rawApiUrl: string, classification: DoctorClassification): DoctorCheck {
  if (classification === 'invalid') {
    return {
      name: 'api-url',
      status: 'fail',
      message: `Invalid VALEDICTORIAN_API_URL: ${rawApiUrl}`,
    }
  }

  if (classification === 'production') {
    return {
      name: 'api-url',
      status: 'pass',
      message: `${sanitizeApiUrl(rawApiUrl)} is a non-local target; confirm intent before mutations.`,
    }
  }

  return {
    name: 'api-url',
    status: 'pass',
    message: `${sanitizeApiUrl(rawApiUrl)} is classified as ${classification}.`,
  }
}

async function apiHealthCheck(
  rawApiUrl: string,
  token: string | undefined,
  timeoutMs: number,
): Promise<DoctorCheck> {
  const result = await fetchJson(rawApiUrl, valedictorianApiPaths.health, token, timeoutMs)

  if ('error' in result) {
    return {
      name: 'api-health',
      status: 'fail',
      message: `Health check failed: ${result.error}`,
    }
  }

  if (!result.response.ok) {
    return {
      name: 'api-health',
      status: 'fail',
      message: `Health check returned HTTP ${result.response.status}.`,
      details: { status: result.response.status },
    }
  }

  return {
    name: 'api-health',
    status: 'pass',
    message: `Health check succeeded at ${sanitizeApiUrl(rawApiUrl)}.`,
    details: { status: result.response.status },
  }
}

async function capabilitiesCheck(
  rawApiUrl: string,
  token: string | undefined,
  timeoutMs: number,
): Promise<{ capabilities?: DoctorReport['capabilities']; check: DoctorCheck }> {
  const result = await fetchJson(rawApiUrl, valedictorianApiPaths.capabilities, token, timeoutMs)

  if ('error' in result) {
    return {
      check: {
        name: 'capabilities',
        status: 'fail',
        message: `Capabilities check failed: ${result.error}`,
      },
    }
  }

  if (!result.response.ok) {
    return {
      check: {
        name: 'capabilities',
        status: 'fail',
        message: `Capabilities check returned HTTP ${result.response.status}.`,
        details: { status: result.response.status },
      },
    }
  }

  const capabilities = isPlainRecord(result.body) ? result.body : undefined

  return {
    capabilities,
    check: {
      name: 'capabilities',
      status: 'pass',
      message: capabilities
        ? `Capabilities loaded: ${formatCapabilities(capabilities)}.`
        : 'Capabilities loaded.',
      details: capabilities,
    },
  }
}

async function workspaceCheck(
  rawApiUrl: string,
  token: string | undefined,
  timeoutMs: number,
  selector: string | undefined,
): Promise<{ check: DoctorCheck; workspace: DoctorWorkspaceContext }> {
  const result = await fetchJson(rawApiUrl, valedictorianApiPaths.workspaces, token, timeoutMs)

  if ('error' in result) {
    return {
      check: {
        name: 'workspace',
        status: 'fail',
        message: `Workspace discovery failed: ${result.error}`,
      },
      workspace: {
        resolution: selector ? 'not_found' : 'not_requested',
        selector,
      },
    }
  }

  if (!result.response.ok) {
    return {
      check: {
        name: 'workspace',
        status: 'fail',
        message: `Workspace discovery returned HTTP ${result.response.status}.`,
        details: { status: result.response.status },
      },
      workspace: {
        resolution: selector ? 'not_found' : 'not_requested',
        selector,
      },
    }
  }

  const items = readWorkspaceItems(result.body)
  const openWorkspaces = items
    .filter((workspace) => workspace.open)
    .map(({ id, name, open, source }) => ({ id, name, open, source }))

  if (!selector) {
    return {
      check: {
        name: 'workspace',
        status: 'skip',
        message: 'No workspace provided; route scoping checks require --workspace <id-or-name>.',
        details: { openWorkspaces },
      },
      workspace: {
        resolution: 'not_requested',
        openWorkspaces,
      },
    }
  }

  const resolved = resolveWorkspaceSelector(items, selector)

  if (resolved.status === 'ambiguous') {
    return {
      check: {
        name: 'workspace',
        status: 'fail',
        message: `Workspace name is ambiguous: ${selector}. Rerun with an id.`,
        details: { matches: resolved.matches },
      },
      workspace: {
        resolution: 'ambiguous',
        selector,
      },
    }
  }

  if (!resolved.workspace) {
    return {
      check: {
        name: 'workspace',
        status: 'fail',
        message: `Workspace not found: ${selector}.`,
      },
      workspace: {
        resolution: 'not_found',
        selector,
      },
    }
  }

  return {
    check: {
      name: 'workspace',
      status: 'pass',
      message: `Resolved workspace ${resolved.workspace.name} (${resolved.workspace.id}).`,
    },
    workspace: {
      id: resolved.workspace.id,
      name: resolved.workspace.name,
      open: resolved.workspace.open,
      path: resolved.workspace.path,
      resolution: 'resolved',
      selector,
      source: resolved.workspace.source,
    },
  }
}

async function workspaceRouteScopeCheck(
  rawApiUrl: string,
  token: string | undefined,
  timeoutMs: number,
  workspaceId: string | undefined,
): Promise<DoctorCheck> {
  if (!workspaceId) {
    return {
      name: 'workspace-route-scope',
      status: 'skip',
      message: 'Skipped because no workspace resolved. Pass --workspace <id-or-name>.',
    }
  }

  const unscoped = await fetchJson(rawApiUrl, `${valedictorianApiPaths.applications}?limit=1`, token, timeoutMs)
  const scopedPath = `/v1/workspaces/${encodeURIComponent(workspaceId)}${valedictorianApiPaths.applications.slice('/v1'.length)}?limit=1`
  const scoped = await fetchJson(rawApiUrl, scopedPath, token, timeoutMs)

  if ('error' in scoped) {
    return {
      name: 'workspace-route-scope',
      status: 'fail',
      message: `Workspace-scoped read failed: ${scoped.error}`,
    }
  }

  if (!scoped.response.ok) {
    return {
      name: 'workspace-route-scope',
      status: 'fail',
      message: `Workspace-scoped read returned HTTP ${scoped.response.status}; check --workspace and app/CLI version alignment.`,
      details: { scopedStatus: scoped.response.status },
    }
  }

  const unscopedStatus = 'error' in unscoped ? undefined : unscoped.response.status

  return {
    name: 'workspace-route-scope',
    status: 'pass',
    message:
      unscopedStatus === 404
        ? 'Unscoped data route returned 404 as expected; workspace-scoped read succeeded.'
        : `Workspace-scoped read succeeded; unscoped data route returned ${unscopedStatus ?? 'unavailable'}.`,
    details: {
      scopedStatus: scoped.response.status,
      unscopedStatus,
      workspaceId,
    },
  }
}

async function fetchJson(
  rawApiUrl: string,
  path: string,
  token: string | undefined,
  timeoutMs: number,
): Promise<{ body: unknown; response: Response; error?: never } | { body?: never; response?: never; error: string }> {
  let url: URL

  try {
    url = new URL(path, rawApiUrl)
  } catch (error) {
    return { error: `Invalid VALEDICTORIAN_API_URL: ${errorMessage(error)}` }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      accept: 'application/json',
    }

    if (token) {
      headers.authorization = `Bearer ${token}`
    }

    const response = await fetch(url.toString(), {
      headers,
      method: 'GET',
      signal: controller.signal,
    })
    const body = await response.json().catch(() => undefined)

    return { body, response }
  } catch (error) {
    return { error: errorMessage(error) }
  } finally {
    clearTimeout(timeout)
  }
}

function sanitizeApiUrl(rawApiUrl: string) {
  try {
    const url = new URL(rawApiUrl)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return '<invalid>'
  }
}

function classifyApiUrl(rawApiUrl: string): DoctorClassification {
  let url: URL

  try {
    url = new URL(rawApiUrl)
  } catch {
    return 'invalid'
  }

  const hostname = url.hostname.toLowerCase()

  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  ) {
    return 'local'
  }

  if (/(^|[.-])(dev|preview|qa|stage|staging|test)([.-]|$)/.test(hostname)) {
    return 'staging'
  }

  return 'production'
}

function compareVersions(actual: string, required: string) {
  const actualParts = versionParts(actual)
  const requiredParts = versionParts(required)

  for (let index = 0; index < Math.max(actualParts.length, requiredParts.length); index += 1) {
    const difference = (actualParts[index] ?? 0) - (requiredParts[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

function versionParts(value: string) {
  return value.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function skipCheck(name: string): DoctorCheck {
  return {
    name,
    status: 'skip',
    message: 'Skipped by --skip-network.',
  }
}

function readWorkspaceItems(body: unknown): WorkspaceListItem[] {
  if (!isPlainRecord(body) || !Array.isArray(body.items)) {
    return []
  }

  return body.items.filter(isWorkspaceListItem)
}

function isWorkspaceListItem(value: unknown): value is WorkspaceListItem {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.open === 'boolean' &&
    typeof value.source === 'string'
  )
}

function resolveWorkspaceSelector(items: WorkspaceListItem[], selector: string) {
  const idMatch = items.find((workspace) => workspace.id === selector)

  if (idMatch) {
    return { workspace: idMatch }
  }

  const exactNameMatches = items.filter((workspace) => workspace.name === selector)

  if (exactNameMatches.length === 1) {
    return { workspace: exactNameMatches[0] }
  }

  if (exactNameMatches.length > 1) {
    return { matches: exactNameMatches, status: 'ambiguous' as const }
  }

  const lowerSelector = selector.toLocaleLowerCase()
  const caseInsensitiveMatches = items.filter(
    (workspace) => workspace.name.toLocaleLowerCase() === lowerSelector,
  )

  if (caseInsensitiveMatches.length === 1) {
    return { workspace: caseInsensitiveMatches[0] }
  }

  if (caseInsensitiveMatches.length > 1) {
    return { matches: caseInsensitiveMatches, status: 'ambiguous' as const }
  }

  return {}
}

function formatWorkspace(workspace: DoctorWorkspaceContext) {
  if (workspace.resolution === 'resolved') {
    return `${workspace.name ?? 'workspace'} (${workspace.id})`
  }

  if (workspace.resolution === 'not_requested') {
    const openCount = workspace.openWorkspaces?.length ?? 0
    return `not selected; ${openCount} open workspace${openCount === 1 ? '' : 's'} discovered`
  }

  return workspace.selector
    ? `${workspace.resolution}: ${workspace.selector}`
    : workspace.resolution
}

function formatCapabilities(capabilities: Record<string, unknown>) {
  return Object.entries(capabilities)
    .filter(([, value]) => typeof value === 'boolean')
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(', ')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
