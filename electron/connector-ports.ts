import {
  createJitterDelayRuntime,
  type DefaultLocalConnectorPorts,
} from '../src/modules/connectors/connector.runtime-ports'
import type { ConnectorBrowserSessionResolveResult } from '@sparxie/valedictorian-connectors-core'

export interface ElectronConnectorWindowOptions {
  show: boolean
  title: string
  width: number
  height: number
  webPreferences: {
    contextIsolation: boolean
    nodeIntegration: boolean
    partition: string
    sandbox: boolean
  }
}

export interface ElectronConnectorWindow {
  webContents?: {
    executeJavaScript<T = unknown>(script: string): Promise<T>
    getURL(): string
  }
  loadURL(url: string): Promise<unknown>
  on(event: 'closed', listener: () => void): unknown
  close?: () => void
  isDestroyed?: () => boolean
}

export interface CreateElectronConnectorPortsOptions {
  createBrowserWindow: (options: ElectronConnectorWindowOptions) => ElectronConnectorWindow
  jobrightLoginUrl?: string
  sessionNamespace: string
}

const defaultJobrightLoginUrl = 'https://jobright.ai/login'

export function createElectronConnectorPorts({
  createBrowserWindow,
  jobrightLoginUrl = defaultJobrightLoginUrl,
  sessionNamespace,
}: CreateElectronConnectorPortsOptions): DefaultLocalConnectorPorts {
  return {
    connectorAuth: {
      browserSessions: {
        async resolve(reference) {
          if (!reference.sessionKey) {
            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_key_missing',
              status: 'action_required',
            }
          }

          const authWindow = createBrowserWindow({
            height: 820,
            show: true,
            title: reference.label ?? 'Connector login',
            webPreferences: createSessionWebPreferences(sessionNamespace, reference.sessionKey),
            width: 1120,
          })
          const closed = waitForClosed(authWindow)

          await authWindow.loadURL(jobrightLoginUrl)
          await closed

          return {
            id: reference.id,
            mode: reference.mode,
            sessionId: reference.sessionKey,
            sessionKey: reference.sessionKey,
            status: 'ready',
          }
        },
      },
    },
    connectorRuntime: {
      browserSession: {
        async resolveLink(input) {
          if (input.source !== 'jobright') {
            return {
              method: 'electron_browser_session',
              officialUrl: null,
              reason: 'browser_session_source_not_supported',
              status: 'unresolved',
            }
          }

          const resolverWindow = createBrowserWindow({
            height: 760,
            show: false,
            title: 'Jobright link resolver',
            webPreferences: createSessionWebPreferences(sessionNamespace, input.sessionId),
            width: 1100,
          })

          try {
            await resolverWindow.loadURL(input.url)

            const currentUrl = resolverWindow.webContents?.getURL() ?? input.url
            const directUrl = externalHttpUrl(currentUrl)

            if (directUrl) {
              return {
                method: 'electron_browser_session',
                officialUrl: directUrl,
                status: 'resolved',
              }
            }

            const scrapeResult = await resolverWindow.webContents?.executeJavaScript(
              jobrightApplyLinkScript,
            )

            return normalizeBrowserSessionResult(scrapeResult)
          } catch (error) {
            return {
              method: 'electron_browser_session',
              officialUrl: null,
              reason: `browser_session_resolution_failed:${messageFromError(error)}`,
              status: 'unresolved',
            }
          } finally {
            if (!resolverWindow.isDestroyed?.()) {
              resolverWindow.close?.()
            }
          }
        },
      },
      delay: createJitterDelayRuntime(),
    },
  }
}

const jobrightApplyLinkScript = String.raw`
(() => {
  const isJobrightHost = (url) => {
    try {
      const parsed = new URL(url, location.href)
      return parsed.hostname === 'jobright.ai' || parsed.hostname.endsWith('.jobright.ai')
    } catch {
      return true
    }
  }
  const toAbsoluteHttpUrl = (value) => {
    try {
      const parsed = new URL(value, location.href)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null
      }
      return parsed.href
    } catch {
      return null
    }
  }
  const anchors = [...document.querySelectorAll('a[href]')]
    .map((anchor) => ({
      href: toAbsoluteHttpUrl(anchor.getAttribute('href')),
      label: [
        anchor.textContent,
        anchor.getAttribute('aria-label'),
        anchor.getAttribute('title'),
      ].filter(Boolean).join(' ').toLowerCase(),
    }))
    .filter((anchor) => anchor.href && !isJobrightHost(anchor.href))
  const preferred = anchors.find((anchor) =>
    /apply|career|company|continue|view job/.test(anchor.label),
  ) ?? anchors[0]
  const bodyText = (document.body?.innerText ?? '').toLowerCase()

  if (/captcha|verify you are human|unusual traffic/.test(bodyText)) {
    return { status: 'captcha', reason: 'jobright_captcha_required' }
  }

  if (/sign in|log in|login/.test(bodyText) && !preferred) {
    return { status: 'auth_required', reason: 'browser_session_action_required' }
  }

  if (/job closed|no longer available|position has been filled/.test(bodyText)) {
    return { status: 'closed', reason: 'jobright_job_closed' }
  }

  if (!preferred) {
    return { status: 'unresolved', reason: 'jobright_apply_link_not_found' }
  }

  return { status: 'resolved', officialUrl: preferred.href }
})()
`

function createSessionWebPreferences(sessionNamespace: string, sessionKey: string) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    partition: createPersistentPartition(sessionNamespace, sessionKey),
    sandbox: true,
  }
}

function normalizeBrowserSessionResult(value: unknown): ConnectorBrowserSessionResolveResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      method: 'electron_browser_session',
      officialUrl: null,
      reason: 'jobright_apply_link_not_found',
      status: 'unresolved',
    }
  }

  const record = value as Record<string, unknown>
  const status = browserSessionStatus(record.status)
  const officialUrl = typeof record.officialUrl === 'string'
    ? externalHttpUrl(record.officialUrl)
    : null
  const reason = typeof record.reason === 'string' && record.reason.trim().length > 0
    ? record.reason.trim()
    : undefined

  if (status === 'resolved' && !officialUrl) {
    return {
      method: 'electron_browser_session',
      officialUrl: null,
      reason: reason ?? 'jobright_apply_link_not_found',
      status: 'unresolved',
    }
  }

  return {
    method: 'electron_browser_session',
    ...(officialUrl === null ? {} : { officialUrl }),
    ...(reason === undefined ? {} : { reason }),
    status,
  }
}

function browserSessionStatus(value: unknown): ConnectorBrowserSessionResolveResult['status'] {
  if (
    value === 'auth_required' ||
    value === 'captcha' ||
    value === 'closed' ||
    value === 'direct_apply' ||
    value === 'hidden' ||
    value === 'rate_limited' ||
    value === 'resolved' ||
    value === 'unresolved'
  ) {
    return value
  }

  return 'unresolved'
}

function externalHttpUrl(value: string) {
  try {
    const url = new URL(value)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    if (isJobrightHost(url.hostname)) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

function isJobrightHost(hostname: string) {
  return hostname === 'jobright.ai' || hostname.endsWith('.jobright.ai')
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createPersistentPartition(sessionNamespace: string, sessionKey: string) {
  return [
    'persist:valedictorian-connector',
    sanitizePartitionSegment(sessionNamespace),
    sanitizePartitionSegment(sessionKey),
  ].join('-')
}

function sanitizePartitionSegment(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

  return normalized.length > 0 ? normalized : 'default'
}

function waitForClosed(window: ElectronConnectorWindow) {
  if (window.isDestroyed?.()) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    window.on('closed', resolve)
  })
}
