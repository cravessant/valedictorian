import {
  createJitterDelayRuntime,
  type DefaultLocalConnectorPorts,
} from '../src/modules/connectors/connector.runtime-ports'
import { resolveJobrightLink } from './jobright-link-resolver'

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
    executeJavaScript<T = unknown>(script: string, userGesture?: boolean): Promise<T>
    getURL(): string
    on?: (
      event: 'will-navigate',
      listener: (event: { preventDefault?: () => void }, url: string) => void
    ) => unknown
    setWindowOpenHandler?: (
      handler: (details: { url: string }) => { action: 'allow' | 'deny' }
    ) => void
  }
  loadURL(url: string): Promise<unknown>
  on(event: 'closed', listener: () => void): unknown
  close?: () => void
  isDestroyed?: () => boolean
}

export interface CreateElectronConnectorPortsOptions {
  authProbeIntervalMs?: number
  authSetupTimeoutMs?: number
  createBrowserWindow: (options: ElectronConnectorWindowOptions) => ElectronConnectorWindow
  jobrightLoginUrl?: string
  navigationTimeoutMs?: number
  now?: () => Date
  sessionNamespace: string
}

const defaultJobrightLoginUrl = 'https://jobright.ai'
const defaultNavigationTimeoutMs = 15_000
const defaultAuthProbeIntervalMs = 1_000
const defaultAuthSetupTimeoutMs = 10 * 60_000

export function createElectronConnectorPorts({
  authProbeIntervalMs = defaultAuthProbeIntervalMs,
  authSetupTimeoutMs = defaultAuthSetupTimeoutMs,
  createBrowserWindow,
  jobrightLoginUrl = defaultJobrightLoginUrl,
  navigationTimeoutMs = defaultNavigationTimeoutMs,
  now = () => new Date(),
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

          let authWindow: ElectronConnectorWindow

          try {
            authWindow = createBrowserWindow({
              height: 820,
              show: true,
              title: reference.label ?? 'Connector login',
              webPreferences: createSessionWebPreferences(sessionNamespace, reference.sessionKey),
              width: 1120,
            })
          } catch {
            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_login_failed',
              status: 'action_required',
            }
          }

          const closed = waitForClosed(authWindow).then(() => 'closed' as const)
          const unsupportedGoogleSignIn = waitForUnsupportedGoogleSignIn(authWindow)

          try {
            const navigation = await settleWithin(
              authWindow.loadURL(jobrightLoginUrl),
              navigationTimeoutMs,
            )

            if (navigation.status === 'timed_out') {
              closeWindow(authWindow)
              return {
                id: reference.id,
                mode: reference.mode,
                reason: 'browser_session_verification_timed_out',
                status: 'action_required',
              }
            }
          } catch {
            closeWindow(authWindow)
            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_login_failed',
              status: 'action_required',
            }
          }

          await settleWithin(
            authWindow.webContents?.executeJavaScript(jobrightOpenSignInScript) ??
              Promise.resolve(false),
            navigationTimeoutMs,
          ).catch(() => undefined)

          const outcome = await waitForVerifiedJobrightSession({
            authWindow,
            closed,
            intervalMs: authProbeIntervalMs,
            probeTimeoutMs: navigationTimeoutMs,
            setupTimeoutMs: authSetupTimeoutMs,
            unsupportedGoogleSignIn,
          })

          if (outcome === 'ready') {
            closeWindow(authWindow)
            return {
              id: reference.id,
              mode: reference.mode,
              sessionId: reference.sessionKey,
              sessionKey: reference.sessionKey,
              status: 'ready',
            }
          }

          if (
            outcome === 'failed' ||
            outcome === 'google_unsupported' ||
            outcome === 'timed_out'
          ) {
            closeWindow(authWindow)
          }

          return {
            id: reference.id,
            mode: reference.mode,
            reason: outcome === 'failed'
              ? 'browser_session_verification_failed'
              : outcome === 'google_unsupported'
                ? 'browser_session_google_sign_in_unsupported'
                : outcome === 'timed_out'
                  ? 'browser_session_verification_timed_out'
                  : 'browser_session_login_cancelled',
            status: 'action_required',
          }
        },
        async validate(reference) {
          if (!reference.sessionKey) {
            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_key_missing',
              status: 'action_required',
            }
          }

          let probeWindow: ElectronConnectorWindow | undefined

          try {
            probeWindow = createBrowserWindow({
              height: 640,
              show: false,
              title: 'Jobright session verifier',
              webPreferences: createSessionWebPreferences(sessionNamespace, reference.sessionKey),
              width: 960,
            })
            const navigation = await settleWithin(
              probeWindow.loadURL(jobrightLoginUrl),
              navigationTimeoutMs,
            )

            if (navigation.status === 'timed_out') {
              return {
                id: reference.id,
                mode: reference.mode,
                reason: 'browser_session_verification_timed_out',
                status: 'action_required',
              }
            }

            const probe = await settleWithin(
              probeWindow.webContents?.executeJavaScript<boolean>(jobrightAuthProbeScript) ??
                Promise.resolve(false),
              navigationTimeoutMs,
            )

            if (probe.status === 'timed_out') {
              return {
                id: reference.id,
                mode: reference.mode,
                reason: 'browser_session_verification_timed_out',
                status: 'action_required',
              }
            }

            if (probe.value === true) {
              return {
                id: reference.id,
                mode: reference.mode,
                sessionId: reference.sessionKey,
                sessionKey: reference.sessionKey,
                status: 'ready',
              }
            }

            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_expired',
              status: 'expired',
            }
          } catch {
            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_verification_failed',
              status: 'action_required',
            }
          } finally {
            if (probeWindow) {
              closeWindow(probeWindow)
            }
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

          return resolveJobrightLink({
            createResolverWindow: () => createBrowserWindow({
              height: 760,
              show: false,
              title: 'Jobright link resolver',
              webPreferences: createSessionWebPreferences(sessionNamespace, input.sessionId),
              width: 1100,
            }),
            input,
            navigationTimeoutMs,
            now,
          })
        },
      },
      delay: createJitterDelayRuntime(),
    },
  }
}

async function waitForVerifiedJobrightSession({
  authWindow,
  closed,
  intervalMs,
  probeTimeoutMs,
  setupTimeoutMs,
  unsupportedGoogleSignIn,
}: {
  authWindow: ElectronConnectorWindow
  closed: Promise<'closed'>
  intervalMs: number
  probeTimeoutMs: number
  setupTimeoutMs: number
  unsupportedGoogleSignIn: Promise<'google_unsupported'>
}): Promise<'closed' | 'failed' | 'google_unsupported' | 'ready' | 'timed_out'> {
  const deadline = Date.now() + normalizeDuration(setupTimeoutMs, defaultAuthSetupTimeoutMs)
  const boundedIntervalMs = normalizeDuration(intervalMs, defaultAuthProbeIntervalMs)

  while (Date.now() < deadline) {
    if (authWindow.isDestroyed?.()) {
      return 'closed'
    }

    const webContents = authWindow.webContents
    if (!webContents) {
      return 'timed_out'
    }

    const probe = settleWithin(
      webContents.executeJavaScript<boolean>(jobrightAuthProbeScript),
      probeTimeoutMs,
    ).then((result) => result.status === 'completed' && result.value === true
      ? 'ready' as const
      : 'pending' as const)
      .catch(() => 'failed' as const)
    const outcome = await Promise.race([closed, unsupportedGoogleSignIn, probe])

    if (
      outcome === 'closed' ||
      outcome === 'failed' ||
      outcome === 'google_unsupported' ||
      outcome === 'ready'
    ) {
      return outcome
    }

    const waitOutcome = await Promise.race([
      closed,
      unsupportedGoogleSignIn,
      delay(boundedIntervalMs).then(() => 'pending' as const),
    ])

    if (waitOutcome === 'closed' || waitOutcome === 'google_unsupported') {
      return waitOutcome
    }
  }

  return 'timed_out'
}

function waitForUnsupportedGoogleSignIn(
  authWindow: ElectronConnectorWindow,
): Promise<'google_unsupported'> {
  return new Promise((resolve) => {
    authWindow.webContents?.setWindowOpenHandler?.(({ url }) => {
      if (isGoogleAuthUrl(url)) {
        resolve('google_unsupported')
        return { action: 'deny' }
      }

      return { action: 'allow' }
    })
  })
}

function isGoogleAuthUrl(value: string): boolean {
  try {
    return new URL(value).hostname === 'accounts.google.com'
  } catch {
    return false
  }
}

const jobrightAuthProbeScript = String.raw`
(async () => {
  try {
    const response = await fetch('/swan/auth/newinfo', {
      cache: 'no-store',
      credentials: 'include',
    })
    if (!response.ok) {
      return false
    }
    const payload = await response.json()
    return payload?.success === true && payload?.result?.logined === true
  } catch {
    return false
  }
})()
`

const jobrightOpenSignInScript = String.raw`
(() => {
  const normalizeText = (value) => (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const candidate = [...document.querySelectorAll('button, a, [role="button"], span')]
    .find((element) => normalizeText(element.textContent) === 'sign in')

  if (!candidate) {
    return false
  }

  candidate.click()
  return true
})()
`

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function normalizeDuration(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : fallback
}

function closeWindow(window: ElectronConnectorWindow): void {
  if (!window.isDestroyed?.()) {
    window.close?.()
  }
}

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<
  | { status: 'completed'; value: T }
  | { status: 'timed_out' }
> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : defaultNavigationTimeoutMs

  try {
    return await Promise.race([
      operation.then((value) => ({ status: 'completed' as const, value })),
      new Promise<{ status: 'timed_out' }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: 'timed_out' }), boundedTimeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function createSessionWebPreferences(sessionNamespace: string, sessionKey: string) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    partition: createPersistentPartition(sessionNamespace, sessionKey),
    sandbox: true,
  }
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
