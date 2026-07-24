import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const proofSchemaVersion = 'valedictorian-electron-native-ui-proof@1'
const screenshotTarget = 'main-window-web-contents'
const proofDestination = 'https://validation.example/careers'
const proofTimeoutMs = 20_000
const rendererDiagnosticLimit = 24
const rendererDiagnosticLength = 320

type SemanticRole =
  | 'button'
  | 'dialog'
  | 'list'
  | 'navigation'
  | 'radio'
  | 'table'
  | 'textbox'

export interface SemanticTarget {
  readonly name: string
  readonly role: SemanticRole
  readonly within?: SemanticTarget
}

export interface ElectronProofWebContents {
  capturePage(): Promise<{ toPNG(): Buffer }>
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
}

export interface ElectronNativeUiDriver {
  captureAppOnlyScreenshot(name: ProofScreenshot['name']): Promise<ProofScreenshot>
  click(target: SemanticTarget): Promise<void>
  expectText(target: SemanticTarget, expectedText: string): Promise<void>
  fill(target: SemanticTarget, value: string): Promise<void>
  waitFor(target: SemanticTarget, timeoutMs?: number): Promise<void>
  waitForText(target: SemanticTarget, expectedText: string, timeoutMs?: number): Promise<void>
}

export interface ProofScreenshot {
  readonly bytes: Buffer
  readonly name: 'before-completion' | 'after-completion' | 'failure'
  readonly target: typeof screenshotTarget
}

export interface ElectronNativeUiProofAssertions {
  captureCompletionOpened: boolean
  existingCompanySelected: boolean
  jobVisible: boolean
  workspaceCompanyVisible: boolean
}

export interface ElectronNativeUiProofResult {
  readonly assertions: ElectronNativeUiProofAssertions
  readonly build: {
    readonly branch: string
    readonly commit: string
    readonly worktree: { readonly state: 'clean' } | {
      readonly fingerprint: string
      readonly state: 'dirty'
    }
  }
  readonly diagnostics: {
    readonly assertionFailure?: string
    readonly rendererConsole: readonly string[]
  }
  readonly durationMs: number
  readonly fixture: {
    readonly captureId: string
    readonly companyId: string
    readonly destination: string
    readonly roleTitle: string
    readonly timestamp: string
    readonly version: string
  }
  readonly outcome: 'completed' | 'failed'
  readonly schemaVersion: typeof proofSchemaVersion
  readonly screenshots: readonly {
    readonly name: string
    readonly path: string
    readonly sha256: string
    readonly target: typeof screenshotTarget
  }[]
  readonly workspace: {
    readonly id: string
    readonly path: string
  }
}

export interface RunElectronNativeUiProofOptions {
  readonly build: ElectronNativeUiProofResult['build']
  readonly driver: ElectronNativeUiDriver
  readonly evidenceDirectory: string
  readonly fixture: {
    readonly captureId: string
    readonly companyId: string
    readonly timestamp: string
    readonly version: string
  }
  readonly rendererConsole: RendererConsoleCapture
  readonly workflow?: ElectronNativeUiWorkflowHooks
  readonly workspace: ElectronNativeUiProofResult['workspace']
}

export interface ElectronNativeUiWorkflowHooks {
  readonly afterJobVisible?: () => Promise<void>
  readonly beforeCompletion?: () => Promise<void>
  readonly expectedCompanyName?: string
}

export interface RendererConsoleCapture {
  entries(): readonly string[]
  stop(): void
}

interface RendererOperation {
  readonly kind: 'click' | 'exists' | 'fill' | 'text'
  readonly target: SemanticTarget
  readonly value?: string
}

const applicationViews: SemanticTarget = { name: 'Application views', role: 'navigation' }
const completionDialog: SemanticTarget = { name: 'Complete Capture into a Job', role: 'dialog' }

export function createElectronNativeUiDriver(
  webContents: ElectronProofWebContents,
): ElectronNativeUiDriver {
  return {
    async captureAppOnlyScreenshot(name) {
      const bytes = webContents ? (await webContents.capturePage()).toPNG() : Buffer.alloc(0)
      if (!isPng(bytes)) throw new Error('Electron proof did not capture an app-content PNG.')
      return { bytes, name, target: screenshotTarget }
    },
    async click(target) {
      await rendererOperation(webContents, { kind: 'click', target })
    },
    async expectText(target, expectedText) {
      const text = await rendererOperation<string>(webContents, { kind: 'text', target })
      if (!text.includes(expectedText)) {
        throw new Error(`Expected ${target.role} ${target.name} to contain ${expectedText}.`)
      }
    },
    async fill(target, value) {
      await rendererOperation(webContents, { kind: 'fill', target, value })
    },
    async waitFor(target, timeoutMs = proofTimeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (await rendererOperation<boolean>(webContents, { kind: 'exists', target })) return
        await sleep(50)
      }
      throw new Error(`Timed out waiting for ${target.role} ${target.name}.`)
    },
    async waitForText(target, expectedText, timeoutMs = proofTimeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try {
          await this.expectText(target, expectedText)
          return
        } catch {
          await sleep(50)
        }
      }
      throw new Error(`Timed out waiting for ${target.role} ${target.name} to contain ${expectedText}.`)
    },
  }
}

export function captureRendererConsole(
  webContents: ElectronProofWebContents,
): RendererConsoleCapture {
  const messages: string[] = []
  const emitter = webContents as ElectronProofWebContents & {
    off?: (event: string, listener: (...args: unknown[]) => void) => void
    on?: (event: string, listener: (...args: unknown[]) => void) => void
  }
  const onConsoleMessage = (...args: unknown[]) => {
    const [, level, message, line, source] = args
    const entry = sanitizeDiagnostic(
      `level=${String(level)} source=${String(source)} line=${String(line)} ${String(message)}`,
    )
    if (messages.length < rendererDiagnosticLimit) messages.push(entry)
  }
  emitter.on?.('console-message', onConsoleMessage)
  return {
    entries: () => [...messages],
    stop: () => emitter.off?.('console-message', onConsoleMessage),
  }
}

export async function runElectronNativeUiProof({
  build,
  driver,
  evidenceDirectory,
  fixture,
  rendererConsole,
  workflow,
  workspace,
}: RunElectronNativeUiProofOptions): Promise<ElectronNativeUiProofResult> {
  const startedAt = Date.now()
  const assertions: ElectronNativeUiProofAssertions = {
    captureCompletionOpened: false,
    existingCompanySelected: false,
    jobVisible: false,
    workspaceCompanyVisible: false,
  }
  const screenshots: ElectronNativeUiProofResult['screenshots'][number][] = []
  let failure: unknown
  try {
    await runElectronNativeUiWorkflow(driver, assertions, async (screenshot) => {
      screenshots.push(writeScreenshot(evidenceDirectory, screenshot))
    }, workflow)
  } catch (error) {
    failure = error
    try {
      screenshots.push(writeScreenshot(
        evidenceDirectory,
        await driver.captureAppOnlyScreenshot('failure'),
      ))
    } catch (screenshotError) {
      failure = new AggregateError(
        [error, screenshotError],
        `${safeErrorMessage(error)} Failure screenshot: ${safeErrorMessage(screenshotError)}`,
      )
    }
  } finally {
    rendererConsole.stop()
  }
  const result: ElectronNativeUiProofResult = {
    assertions,
    build,
    diagnostics: {
      ...(failure ? { assertionFailure: safeErrorMessage(failure) } : {}),
      rendererConsole: rendererConsole.entries(),
    },
    durationMs: Date.now() - startedAt,
    fixture: {
      captureId: fixture.captureId,
      companyId: fixture.companyId,
      destination: proofDestination,
      roleTitle: 'Validation Engineer',
      timestamp: fixture.timestamp,
      version: fixture.version,
    },
    outcome: failure ? 'failed' : 'completed',
    schemaVersion: proofSchemaVersion,
    screenshots,
    workspace,
  }
  fs.writeFileSync(
    path.join(evidenceDirectory, 'electron-native-ui-proof.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  )
  return result
}

export async function runElectronNativeUiWorkflow(
  driver: ElectronNativeUiDriver,
  assertions: ElectronNativeUiProofAssertions,
  onScreenshot: (screenshot: ProofScreenshot) => Promise<void> | void,
  hooks: ElectronNativeUiWorkflowHooks = {},
) {
  const captureTable: SemanticTarget = { name: 'Captures', role: 'table' }
  const jobsTable: SemanticTarget = { name: 'Jobs', role: 'table' }
  const companiesTable: SemanticTarget = { name: 'Companies', role: 'table' }
  await driver.waitFor({ name: 'Complete Job information', role: 'button' })
  await hooks.beforeCompletion?.()
  await driver.click({ name: 'Complete Job information', role: 'button' })
  await driver.waitFor(completionDialog)
  await driver.waitForText(completionDialog, 'Validation Engineer')
  await driver.waitForText(completionDialog, 'Raw evidence (1)')
  assertions.captureCompletionOpened = true
  await onScreenshot(await driver.captureAppOnlyScreenshot('before-completion'))

  await driver.click({
    name: 'Use an existing local Company',
    role: 'radio',
    within: completionDialog,
  })
  await driver.fill({
    name: 'Search active local Companies',
    role: 'textbox',
    within: completionDialog,
  }, 'Validation Company')
  const companyResults: SemanticTarget = {
    name: 'Company search results',
    role: 'list',
    within: completionDialog,
  }
  await driver.waitFor({ name: 'Use', role: 'button', within: companyResults })
  await driver.click({ name: 'Use', role: 'button', within: companyResults })
  await driver.waitForText(completionDialog, 'Using Validation Company')
  assertions.existingCompanySelected = true

  await driver.fill({
    name: 'Employer or ATS URL',
    role: 'textbox',
    within: completionDialog,
  }, proofDestination)
  await driver.click({ name: 'Create Job', role: 'button', within: completionDialog })
  await driver.waitFor(captureTable)
  await driver.waitForText(captureTable, 'Job created')
  await driver.waitForText(captureTable, 'Validation Engineer · Validation Company')

  await driver.click({ name: 'Jobs', role: 'button', within: applicationViews })
  await driver.waitFor(jobsTable)
  await driver.waitForText(jobsTable, 'Validation Engineer')
  await driver.waitForText(jobsTable, 'Validation Company')
  assertions.jobVisible = true
  await hooks.afterJobVisible?.()

  await driver.click({ name: 'Companies', role: 'button', within: applicationViews })
  await driver.waitFor(companiesTable)
  await driver.waitForText(
    companiesTable,
    hooks.expectedCompanyName ?? 'Validation Company',
  )
  assertions.workspaceCompanyVisible = true
  await onScreenshot(await driver.captureAppOnlyScreenshot('after-completion'))
}

function writeScreenshot(evidenceDirectory: string, screenshot: ProofScreenshot) {
  if (screenshot.target !== screenshotTarget) {
    throw new Error('Electron proof screenshot did not target the main window web contents.')
  }
  const outputPath = path.join(evidenceDirectory, `electron-native-ui-${screenshot.name}.png`)
  fs.writeFileSync(outputPath, screenshot.bytes, { mode: 0o600 })
  return {
    name: screenshot.name,
    path: outputPath,
    sha256: `sha256:${createHash('sha256').update(screenshot.bytes).digest('hex')}`,
    target: screenshot.target,
  }
}

async function rendererOperation<Result>(
  webContents: ElectronProofWebContents,
  operation: RendererOperation,
): Promise<Result> {
  const result = await webContents.executeJavaScript(rendererOperationScript(operation), true) as {
    error?: string
    value?: Result
  }
  if (result?.error) throw new Error(result.error)
  return result?.value as Result
}

function rendererOperationScript(operation: RendererOperation) {
  return `(() => {
    const operation = ${JSON.stringify(operation)};
    const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const text = (element) => normalize(element.textContent);
    const role = (element) => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      if (element instanceof HTMLButtonElement) return 'button';
      if (element instanceof HTMLTableElement) return 'table';
      if (element instanceof HTMLDialogElement) return 'dialog';
      if (element instanceof HTMLUListElement || element instanceof HTMLOListElement) return 'list';
      if (element instanceof HTMLElement && element.tagName === 'NAV') return 'navigation';
      if (element instanceof HTMLInputElement) {
        if (element.type === 'radio') return 'radio';
        if (element.type !== 'hidden') return 'textbox';
      }
      return '';
    };
    const name = (element) => {
      const label = element.getAttribute('aria-label');
      if (label) return normalize(label);
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelledText = labelledBy.split(/\\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((labelled) => text(labelled))
          .join(' ');
        if (labelledText) return normalize(labelledText);
      }
      if (element instanceof HTMLInputElement) {
        const nativeLabel = Array.from(element.labels ?? []).map((label) => text(label)).join(' ');
        if (nativeLabel) return normalize(nativeLabel);
      }
      return text(element);
    };
    const nodes = (root) => [root, ...root.querySelectorAll('*')];
    const find = (target, root = document.documentElement) => {
      const scope = target.within ? find(target.within) : root;
      if (!scope) return null;
      return nodes(scope).find((element) => role(element) === target.role && name(element) === target.name) ?? null;
    };
    const target = find(operation.target);
    if (operation.kind === 'exists') return { value: Boolean(target) };
    if (!target) return { error: 'Missing accessible ' + operation.target.role + ': ' + operation.target.name };
    if (operation.kind === 'text') return { value: text(target) };
    if (operation.kind === 'click') {
      if (target.disabled) return { error: 'Accessible target is disabled: ' + operation.target.name };
      target.focus();
      target.click();
      return { value: null };
    }
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return { error: 'Accessible target cannot accept text: ' + operation.target.name };
    }
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value');
    descriptor?.set?.call(target, operation.value ?? '');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { value: null };
  })()`
}

function isPng(bytes: Buffer) {
  return bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

function safeErrorMessage(error: unknown) {
  return sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
}

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/(?:api[_-]?key|password|secret|token)\s+[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, rendererDiagnosticLength)
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
