import { defaultValedictorianApiBaseUrl, valedictorianApiPaths } from 'sparxie'

type DoctorClassification = 'local' | 'staging' | 'production' | 'invalid'
type DoctorCheckStatus = 'pass' | 'fail' | 'skip'

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
  readonly checks: DoctorCheck[]
}

export async function runDoctor({
  cliVersion,
  env,
  skipNetwork,
  timeoutMs,
}: {
  cliVersion: string
  env: Record<string, string | undefined>
  skipNetwork: boolean
  timeoutMs: number
}): Promise<DoctorReport> {
  const rawApiUrl = env.VALEDICTORIAN_API_URL ?? defaultValedictorianApiBaseUrl
  const apiUrl = sanitizeApiUrl(rawApiUrl)
  const classification = classifyApiUrl(rawApiUrl)
  const checks: DoctorCheck[] = [
    nodeVersionCheck(),
    apiUrlCheck(rawApiUrl, classification),
  ]

  if (skipNetwork) {
    checks.push({
      name: 'api-health',
      status: 'skip',
      message: 'Skipped by --skip-network.',
    })
  } else {
    checks.push(await apiHealthCheck(rawApiUrl, env.VALEDICTORIAN_API_TOKEN, timeoutMs))
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
    checks,
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
    'Checks:',
    ...report.checks.map((check) => `  ${check.status.toUpperCase()} ${check.name}: ${check.message}`),
  ]

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
  let url: URL

  try {
    url = new URL(valedictorianApiPaths.health, rawApiUrl)
  } catch (error) {
    return {
      name: 'api-health',
      status: 'fail',
      message: `Invalid VALEDICTORIAN_API_URL: ${errorMessage(error)}`,
    }
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

    if (!response.ok) {
      return {
        name: 'api-health',
        status: 'fail',
        message: `Health check returned HTTP ${response.status}.`,
        details: { status: response.status },
      }
    }

    return {
      name: 'api-health',
      status: 'pass',
      message: `Health check succeeded at ${sanitizeApiUrl(rawApiUrl)}.`,
      details: { status: response.status },
    }
  } catch (error) {
    return {
      name: 'api-health',
      status: 'fail',
      message: `Health check failed: ${errorMessage(error)}`,
    }
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
