import type {
  ConnectorBrowserSessionResolveInput,
  ConnectorBrowserSessionResolveResult,
} from '@sparxie/valedictorian-connectors-core'
import type { ElectronConnectorWindow } from './connector-ports'

interface ResolveJobrightLinkOptions {
  createResolverWindow: () => ElectronConnectorWindow
  input: ConnectorBrowserSessionResolveInput
  navigationTimeoutMs: number
  now: () => Date
}

const defaultNavigationTimeoutMs = 15_000
const pollIntervalMs = 100

export async function resolveJobrightLink({
  createResolverWindow,
  input,
  navigationTimeoutMs,
  now,
}: ResolveJobrightLinkOptions): Promise<ConnectorBrowserSessionResolveResult> {
  let resolverWindow: ElectronConnectorWindow | undefined

  try {
    resolverWindow = createResolverWindow()
    const externalNavigationCapture = captureExternalNavigation(resolverWindow)
    const navigation = await settleWithin(
      resolverWindow.loadURL(input.url),
      navigationTimeoutMs,
    )

    if (navigation.status === 'timed_out') {
      return {
        method: 'electron_browser_session',
        officialUrl: null,
        reason: 'browser_session_navigation_timed_out',
        status: 'auth_required',
      }
    }

    const currentUrl = resolverWindow.webContents?.getURL() ?? input.url
    const redirectedUrl = externalHttpUrl(currentUrl)
    const directUrl = redirectedUrl
      ? verifiedApplicationUrl(redirectedUrl)
      : null

    if (directUrl) {
      const capturedAt = now().toISOString()

      return {
        evidence: [
          createResolutionEvidence('jobright_apply_redirect', input.url, capturedAt),
          createResolutionEvidence(
            'jobright_apply_destination_accepted',
            directUrl,
            capturedAt,
          ),
        ],
        method: 'jobright_apply_redirect',
        officialUrl: directUrl,
        status: 'resolved',
      }
    }

    if (redirectedUrl) {
      const capturedAt = now().toISOString()

      return {
        evidence: [
          createResolutionEvidence('jobright_apply_redirect', input.url, capturedAt),
          createResolutionEvidence(
            'jobright_apply_destination_rejected',
            redirectedUrl,
            capturedAt,
          ),
        ],
        method: 'jobright_apply_redirect',
        officialUrl: null,
        reason: 'jobright_apply_destination_unverified',
        status: 'unresolved',
      }
    }

    const detailState = await waitForDetailState(resolverWindow, navigationTimeoutMs)

    if (detailState.status === 'script_timed_out') {
      return {
        method: 'electron_browser_session',
        officialUrl: null,
        reason: 'browser_session_script_timed_out',
        status: 'auth_required',
      }
    }

    if (detailState.status !== 'ready') {
      return stateResult(detailState, input.url, now)
    }

    const externalNavigation = externalNavigationCapture.begin()
    const click = await settleWithin(
      resolverWindow.webContents?.executeJavaScript(clickApplyActionScript, true) ??
        Promise.resolve(undefined),
      navigationTimeoutMs,
    )

    if (click.status === 'timed_out' || !isApplyActionClicked(click.value)) {
      const reason = click.status === 'timed_out'
        ? 'jobright_apply_action_timed_out'
        : 'jobright_apply_action_missing'

      return unresolvedResult(reason, input.url, now)
    }

    const applyOutcome = await waitForApplyOutcome(
      resolverWindow,
      externalNavigation,
      navigationTimeoutMs,
    )

    if (applyOutcome.status === 'state') {
      if (applyOutcome.state.status === 'script_timed_out') {
        return {
          evidence: [createResolutionEvidence(
            applyOutcome.state.reason,
            input.url,
            now,
          )],
          method: 'jobright_apply_action',
          officialUrl: null,
          reason: applyOutcome.state.reason,
          status: 'auth_required',
        }
      }

      if (isTerminalPageState(applyOutcome.state)) {
        return stateResult(applyOutcome.state, input.url, now)
      }
    }

    if (applyOutcome.status !== 'captured') {
      return unresolvedResult('jobright_apply_destination_missing', input.url, now)
    }

    const officialUrl = verifiedApplicationUrl(applyOutcome.value)
    const capturedAt = now().toISOString()

    if (!officialUrl) {
      return {
        evidence: [
          createResolutionEvidence('jobright_apply_action', input.url, capturedAt),
          createResolutionEvidence(
            'jobright_apply_destination_rejected',
            applyOutcome.value,
            capturedAt,
          ),
        ],
        method: 'jobright_apply_action',
        officialUrl: null,
        reason: 'jobright_apply_destination_unverified',
        status: 'unresolved',
      }
    }

    return {
      evidence: [
        createResolutionEvidence('jobright_apply_action', input.url, capturedAt),
        createResolutionEvidence(
          'jobright_apply_destination_accepted',
          officialUrl,
          capturedAt,
        ),
      ],
      method: 'jobright_apply_action',
      officialUrl,
      status: 'resolved',
    }
  } catch {
    return {
      method: 'electron_browser_session',
      officialUrl: null,
      reason: 'browser_session_resolution_failed',
      status: 'auth_required',
    }
  } finally {
    if (resolverWindow && !resolverWindow.isDestroyed?.()) {
      resolverWindow.close?.()
    }
  }
}

type JobrightPageStatus =
  | 'auth_required'
  | 'captcha'
  | 'closed'
  | 'hidden'
  | 'pending'
  | 'ready'
  | 'unresolved'

type JobrightDetailState =
  | {
      [Status in JobrightPageStatus]: { reason: string; status: Status }
    }[JobrightPageStatus]
  | {
      reason: 'browser_session_script_timed_out'
      status: 'script_timed_out'
    }

type JobrightApplyOutcome =
  | { status: 'captured'; value: string }
  | { state: JobrightDetailState; status: 'state' }
  | { status: 'timed_out' }

type JobrightTerminalStatus = 'auth_required' | 'captcha' | 'closed' | 'hidden' | 'unresolved'

const applyControlHelpers = String.raw`
  const normalizeText = (value) => (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const hasEmployerSiteLabel = (button) => {
    let container = button

    for (let depth = 0; depth < 4 && container; depth += 1) {
      if (normalizeText(container.textContent).includes('apply on employer site')) {
        return true
      }
      container = container.parentElement
    }

    return false
  }
  const isHidden = (element) => {
    let current = element

    while (current) {
      const inlineStyle = current.getAttribute('style') ?? ''
      const computedStyle = typeof getComputedStyle === 'function'
        ? getComputedStyle(current)
        : null
      if (current.hidden ||
        current.getAttribute('aria-hidden') === 'true' ||
        /display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)/i.test(inlineStyle) ||
        computedStyle?.display === 'none' ||
        computedStyle?.visibility === 'hidden' ||
        computedStyle?.visibility === 'collapse') {
        return true
      }
      current = current.parentElement
    }

    return false
  }
  const findApplyControls = () => [...document.querySelectorAll('button, [role="button"]')]
    .filter((element) => normalizeText(element.textContent) === 'apply now')
    .filter(hasEmployerSiteLabel)
`

const detailStateScript = String.raw`
(() => {
${applyControlHelpers}
  const bodyText = normalizeText(document.body?.innerText ?? document.body?.textContent)

  if (/captcha|verify you are human|unusual traffic/.test(bodyText)) {
    return { status: 'captcha', reason: 'jobright_captcha_required' }
  }

  if (/(?:this )?job (?:is |has )?closed|no longer available|position has been filled/.test(bodyText)) {
    return { status: 'closed', reason: 'jobright_job_closed' }
  }

  const hasVisibleAuthPrompt = [...document.querySelectorAll('dialog, [role="dialog"], form')]
    .some((element) => !isHidden(element) &&
      /sign up to apply|sign in to apply|log in to apply|welcome back to jobright/.test(
        normalizeText(element.textContent),
      ))

  if (hasVisibleAuthPrompt) {
    return { status: 'auth_required', reason: 'browser_session_action_required' }
  }

  const candidates = findApplyControls()

  if (candidates.length > 1) {
    return { status: 'unresolved', reason: 'jobright_apply_action_ambiguous' }
  }

  const candidate = candidates[0]

  if (!candidate) {
    return { status: 'pending', reason: 'jobright_apply_action_not_ready' }
  }

  if (candidate.disabled || candidate.getAttribute('aria-disabled') === 'true' || isHidden(candidate)) {
    return { status: 'hidden', reason: 'jobright_apply_action_hidden' }
  }

  return { status: 'ready', reason: 'jobright_apply_action_ready' }
})()
`

const clickApplyActionScript = String.raw`
(() => {
${applyControlHelpers}
  const candidates = findApplyControls()

  if (candidates.length !== 1) {
    return { status: candidates.length > 1 ? 'ambiguous' : 'missing' }
  }

  const candidate = candidates[0]

  if (candidate.disabled || candidate.getAttribute('aria-disabled') === 'true' || isHidden(candidate)) {
    return { status: 'hidden' }
  }

  candidate.click()
  return { status: 'clicked' }
})()
`

async function waitForDetailState(
  resolverWindow: ElectronConnectorWindow,
  timeoutMs: number,
): Promise<JobrightDetailState> {
  const deadline = Date.now() + normalizeDuration(timeoutMs)

  while (Date.now() < deadline) {
    const state = await readDetailState(
      resolverWindow,
      Math.max(1, deadline - Date.now()),
    )

    if (state.status !== 'pending') {
      return state
    }

    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
  }

  return {
    reason: 'jobright_apply_action_not_ready',
    status: 'unresolved',
  }
}

async function readDetailState(
  resolverWindow: ElectronConnectorWindow,
  timeoutMs: number,
): Promise<JobrightDetailState> {
  const script = await settleWithin(
    resolverWindow.webContents?.executeJavaScript(detailStateScript) ??
      Promise.resolve(undefined),
    timeoutMs,
  )

  if (script.status === 'timed_out') {
    return {
      reason: 'browser_session_script_timed_out',
      status: 'script_timed_out',
    }
  }

  if (!script.value || typeof script.value !== 'object' || Array.isArray(script.value)) {
    return invalidDetailState()
  }

  const record = script.value as Record<string, unknown>
  const status = record.status
  const reason = typeof record.reason === 'string' && record.reason.trim().length > 0
    ? record.reason.trim()
    : 'jobright_apply_action_state_invalid'

  if (
    status === 'auth_required' ||
    status === 'captcha' ||
    status === 'closed' ||
    status === 'hidden' ||
    status === 'pending' ||
    status === 'ready' ||
    status === 'unresolved'
  ) {
    return { reason, status }
  }

  return invalidDetailState()
}

function invalidDetailState(): JobrightDetailState {
  return {
    reason: 'jobright_apply_action_state_invalid',
    status: 'unresolved',
  }
}

function captureExternalNavigation(resolverWindow: ElectronConnectorWindow): {
  begin(): Promise<string>
} {
  let activeCapture: ((value: string) => void) | null = null
  const capture = (value: string) => {
    const externalUrl = externalHttpUrl(value)

    if (activeCapture && externalUrl) {
      const resolve = activeCapture
      activeCapture = null
      resolve(externalUrl)
    }
  }

  resolverWindow.webContents?.setWindowOpenHandler?.(({ url }) => {
    capture(url)
    return { action: 'deny' }
  })
  resolverWindow.webContents?.on?.('will-navigate', (event, url) => {
    if (externalHttpUrl(url)) {
      event.preventDefault?.()
      capture(url)
    }
  })

  return {
    begin() {
      return new Promise((resolve) => {
        activeCapture = resolve
      })
    },
  }
}

function isApplyActionClicked(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).status === 'clicked',
  )
}

async function waitForApplyOutcome(
  resolverWindow: ElectronConnectorWindow,
  externalNavigation: Promise<string>,
  timeoutMs: number,
): Promise<JobrightApplyOutcome> {
  const deadline = Date.now() + normalizeDuration(timeoutMs)

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const next = await Promise.race([
      externalNavigation.then((value) => ({ status: 'captured' as const, value })),
      delay(Math.min(pollIntervalMs, remainingMs)).then(() => ({ status: 'poll' as const })),
    ])

    if (next.status === 'captured') {
      return next
    }

    const state = await readDetailState(
      resolverWindow,
      Math.max(1, deadline - Date.now()),
    )

    if (state.status !== 'ready' && state.status !== 'pending') {
      return { state, status: 'state' }
    }
  }

  return { status: 'timed_out' }
}

function stateResult(
  state: { reason: string; status: JobrightTerminalStatus | 'pending' },
  sourceUrl: string,
  now: () => Date,
): ConnectorBrowserSessionResolveResult {
  const status = state.status === 'pending' ? 'unresolved' : state.status

  return {
    evidence: [createResolutionEvidence(state.reason, sourceUrl, now)],
    method: 'jobright_apply_action',
    officialUrl: null,
    reason: state.reason,
    status,
  }
}

function unresolvedResult(
  reason: string,
  sourceUrl: string,
  now: () => Date,
): ConnectorBrowserSessionResolveResult {
  return {
    evidence: [createResolutionEvidence(reason, sourceUrl, now)],
    method: 'jobright_apply_action',
    officialUrl: null,
    reason,
    status: 'unresolved',
  }
}

function isTerminalPageState(
  state: JobrightDetailState,
): state is { reason: string; status: JobrightTerminalStatus } {
  return state.status === 'auth_required' ||
    state.status === 'captcha' ||
    state.status === 'closed' ||
    state.status === 'hidden' ||
    state.status === 'unresolved'
}

function createResolutionEvidence(
  type: string,
  sourceUrl: string,
  timestamp: (() => Date) | string,
) {
  return {
    capturedAt: typeof timestamp === 'string' ? timestamp : timestamp().toISOString(),
    sourceUrl: sanitizeEvidenceUrl(sourceUrl),
    type,
  }
}

function sanitizeEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

const exactApplicationHosts = new Set([
  'apply.workable.com',
  'boards.greenhouse.io',
  'jobs.ashbyhq.com',
  'jobs.lever.co',
  'jobs.smartrecruiters.com',
])
const tenantApplicationHostSuffixes = [
  'bamboohr.com',
  'dayforcehcm.com',
  'icims.com',
  'myworkdayjobs.com',
  'oraclecloud.com',
  'paylocity.com',
  'ultipro.com',
]
const applicationQueryKeys = new Set([
  'gh_jid',
  'job',
  'jobid',
  'job_id',
  'postingid',
  'posting_id',
])

function verifiedApplicationUrl(value: string): string | null {
  const candidate = externalHttpUrl(value)

  if (!candidate) {
    return null
  }

  const url = new URL(candidate)
  const hostname = url.hostname.toLowerCase()

  if (url.username || url.password || !isSupportedApplicationHost(hostname)) {
    return null
  }

  const pathSegments = url.pathname.toLowerCase().split('/').filter(Boolean)
  const hasApplicationQuery = [...url.searchParams.keys()].some((key) =>
    applicationQueryKeys.has(key.toLowerCase()))

  if (!hasApplicationQuery && pathSegments.length < 2) {
    return null
  }

  return candidate
}

function isSupportedApplicationHost(hostname: string): boolean {
  return exactApplicationHosts.has(hostname) || tenantApplicationHostSuffixes.some((suffix) =>
    hostname !== suffix && hostname.endsWith(`.${suffix}`))
}

function externalHttpUrl(value: string): string | null {
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

function isJobrightHost(hostname: string): boolean {
  return hostname === 'jobright.ai' || hostname.endsWith('.jobright.ai')
}

function normalizeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : defaultNavigationTimeoutMs
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<
  | { status: 'completed'; value: T }
  | { status: 'timed_out' }
> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation.then((value) => ({ status: 'completed' as const, value })),
      new Promise<{ status: 'timed_out' }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: 'timed_out' }), normalizeDuration(timeoutMs))
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}
