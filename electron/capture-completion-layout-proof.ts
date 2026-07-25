import fs from 'node:fs'
import path from 'node:path'

import {
  captureRendererConsole,
  completeElectronNativeUiCapture,
  createElectronNativeUiDriver,
  executeElectronRendererScript,
  type ElectronNativeUiProofAssertions,
  type ElectronProofWebContents,
} from './native-ui-proof'
import {
  isolatedValidationFixture,
} from '../src/runtime/isolated-validation.fixture-contract'
import {
  readIsolatedValidationEnvironment,
  type IsolatedValidationManifest,
} from '../src/runtime/isolated-validation'
import type { WorkspaceSummary } from '../src/workspace/workspace.initializer'

const schemaVersion = 'valedictorian-capture-completion-dialog-layout-proof@1'
const viewportHeight = 540
const viewportWidths = [320, 768, 1440] as const
const tolerance = 2

interface Rectangle {
  readonly bottom: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly width: number
}

interface SurfaceMeasurement {
  readonly clientHeight: number
  readonly clientWidth: number
  readonly scrollHeight: number
  readonly scrollTop: number
  readonly scrollWidth: number
}

interface ShellMeasurement extends SurfaceMeasurement {
  readonly rectangle: Rectangle
}

export interface CaptureCompletionLayoutMeasurement {
  readonly after: {
    readonly body: SurfaceMeasurement
    readonly close: Rectangle
    readonly footer: Rectangle
    readonly header: Rectangle
    readonly shell: ShellMeasurement
  }
  readonly before: {
    readonly body: SurfaceMeasurement
    readonly close: Rectangle
    readonly footer: Rectangle
    readonly header: Rectangle
    readonly shell: ShellMeasurement
  }
  readonly devicePixelRatio: number
  readonly requestedViewport: { readonly height: number; readonly width: number }
  readonly viewport: { readonly height: number; readonly width: number }
}

interface FailedMeasurement {
  readonly error: string
}

interface LayoutProofWindow {
  getMinimumSize(): readonly number[]
  isDestroyed(): boolean
  setContentSize(width: number, height: number): void
  setMinimumSize(width: number, height: number): void
  readonly webContents: ElectronProofWebContents & {
    isDestroyed(): boolean
    setZoomFactor(factor: number): void
  }
}

export interface CaptureCompletionLayoutProofResult {
  readonly assertions: ElectronNativeUiProofAssertions
  readonly build: IsolatedValidationManifest['build']
  readonly diagnostics: {
    readonly assertionFailure?: string
    readonly rendererConsole: readonly string[]
  }
  readonly measurements: readonly CaptureCompletionLayoutMeasurement[]
  readonly outcome: 'completed' | 'failed'
  readonly schemaVersion: typeof schemaVersion
  readonly viewport: {
    readonly deviceScale: 'default'
    readonly height: number
    readonly widths: readonly number[]
    readonly zoomFactor: number
  }
  readonly workspace: IsolatedValidationManifest['workspace']
}

export async function runIsolatedCaptureCompletionLayoutProof({
  manifest,
  window,
  workspace,
}: {
  readonly manifest: IsolatedValidationManifest | null
  readonly window: LayoutProofWindow
  readonly workspace: Pick<WorkspaceSummary, 'id' | 'rootPath'>
}): Promise<CaptureCompletionLayoutProofResult> {
  const session = readIsolatedValidationEnvironment()
  if (!session || !manifest) throw new Error('Capture completion layout proof requires an isolated validation session.')
  if (
    window.isDestroyed()
    || window.webContents.isDestroyed()
    || manifest.build.branch !== session.branch
    || manifest.build.commit !== session.commit
    || JSON.stringify(manifest.build.worktree) !== JSON.stringify(session.worktree)
    || manifest.workspace.id !== workspace.id
    || manifest.workspace.path !== workspace.rootPath
    || manifest.fixture.version !== isolatedValidationFixture.version
  ) {
    throw new Error('Capture completion layout proof identity does not match the ready isolated session.')
  }

  return measureCaptureCompletionDialog({
    evidenceDirectory: session.evidenceDirectory,
    manifest,
    window,
  })
}

export function layoutMeasurementFailures(measurement: CaptureCompletionLayoutMeasurement): string[] {
  const failures: string[] = []
  const { after, before, viewport } = measurement
  if (
    viewport.width !== measurement.requestedViewport.width
    || viewport.height !== measurement.requestedViewport.height
  ) {
    failures.push(`Renderer viewport ${viewport.width}×${viewport.height} did not match requested CSS viewport ${measurement.requestedViewport.width}×${measurement.requestedViewport.height}.`)
  }
  if (before.shell.scrollWidth > before.shell.clientWidth + tolerance) {
    failures.push(`Shell horizontally overflows before scrolling (${before.shell.scrollWidth} > ${before.shell.clientWidth}).`)
  }
  if (after.shell.scrollWidth > after.shell.clientWidth + tolerance) {
    failures.push(`Shell horizontally overflows after scrolling (${after.shell.scrollWidth} > ${after.shell.clientWidth}).`)
  }
  if (before.body.scrollWidth > before.body.clientWidth + tolerance) {
    failures.push(`Body horizontally overflows before scrolling (${before.body.scrollWidth} > ${before.body.clientWidth}).`)
  }
  if (after.body.scrollWidth > after.body.clientWidth + tolerance) {
    failures.push(`Body horizontally overflows after scrolling (${after.body.scrollWidth} > ${after.body.clientWidth}).`)
  }
  if (before.shell.scrollHeight > before.shell.clientHeight + tolerance) {
    failures.push(`Shell vertically overflows before scrolling (${before.shell.scrollHeight} > ${before.shell.clientHeight}).`)
  }
  if (after.shell.scrollHeight > after.shell.clientHeight + tolerance) {
    failures.push(`Shell vertically overflows after scrolling (${after.shell.scrollHeight} > ${after.shell.clientHeight}).`)
  }
  if (before.shell.scrollTop > tolerance) {
    failures.push(`Shell is vertically displaced before body scrolling (${before.shell.scrollTop}px).`)
  }
  if (after.shell.scrollTop > tolerance) {
    failures.push(`Shell is vertically displaced after body scrolling (${after.shell.scrollTop}px).`)
  }
  if (Math.abs(after.shell.scrollTop - before.shell.scrollTop) > tolerance) {
    failures.push('Shell moved while the body scrolled.')
  }
  if (before.body.scrollHeight <= before.body.clientHeight + tolerance) {
    failures.push(`Body is not vertically scrollable (${before.body.scrollHeight} <= ${before.body.clientHeight}).`)
  }
  if (after.body.scrollTop <= tolerance) failures.push('Body did not advance after scrolling.')
  for (const [name, beforeRect, afterRect] of [
    ['header', before.header, after.header],
    ['close control', before.close, after.close],
    ['footer actions', before.footer, after.footer],
  ] as const) {
    if (!rectanglesMatch(beforeRect, afterRect)) failures.push(`${name} moved while the body scrolled.`)
    if (!rectangleInsideShell(afterRect, after.shell)) failures.push(`${name} is not reachable inside the shell after scrolling.`)
  }
  return failures
}

async function measureCaptureCompletionDialog({
  evidenceDirectory,
  manifest,
  window,
}: {
  readonly evidenceDirectory: string
  readonly manifest: IsolatedValidationManifest
  readonly window: LayoutProofWindow
}): Promise<CaptureCompletionLayoutProofResult> {
  const rendererConsole = captureRendererConsole(window.webContents)
  const assertions: ElectronNativeUiProofAssertions = {
    captureCompletionOpened: false,
    existingCompanySelected: false,
    jobVisible: false,
    workspaceCompanyVisible: false,
  }
  const measurements: CaptureCompletionLayoutMeasurement[] = []
  let failure: unknown
  const [minimumWidth = 0, minimumHeight = 0] = window.getMinimumSize()
  try {
    window.setMinimumSize(0, 0)
    window.webContents.setZoomFactor(1)
    const driver = createElectronNativeUiDriver(window.webContents)
    await driver.waitFor({ name: 'Complete Job information', role: 'button' })
    await driver.click({ name: 'Complete Job information', role: 'button' })
    await driver.waitFor({ name: 'Complete Capture into a Job', role: 'dialog' })
    await driver.waitForText({ name: 'Complete Capture into a Job', role: 'dialog' }, 'Raw evidence (1)')
    assertions.captureCompletionOpened = true
    for (const width of viewportWidths) {
      window.setContentSize(width, viewportHeight)
      await waitForLayout(window.webContents)
      const result = await measureDialog(window.webContents, { height: viewportHeight, width })
      if ('error' in result) throw new Error(result.error)
      measurements.push(result)
      const failures = layoutMeasurementFailures(result)
      if (failures.length > 0) throw new Error(`Viewport ${width}px: ${failures.join(' ')}`)
    }
    await resetDialogBodyScroll(window.webContents)
    await completeElectronNativeUiCapture(driver, assertions)
  } catch (error) {
    failure = error
  } finally {
    window.setMinimumSize(minimumWidth, minimumHeight)
    rendererConsole.stop()
  }

  const result: CaptureCompletionLayoutProofResult = {
    assertions,
    build: manifest.build,
    diagnostics: {
      ...(failure ? { assertionFailure: safeErrorMessage(failure) } : {}),
      rendererConsole: rendererConsole.entries(),
    },
    measurements,
    outcome: failure ? 'failed' : 'completed',
    schemaVersion,
    viewport: {
      deviceScale: 'default',
      height: viewportHeight,
      widths: viewportWidths,
      zoomFactor: 1,
    },
    workspace: manifest.workspace,
  }
  fs.writeFileSync(
    path.join(evidenceDirectory, 'capture-completion-dialog-layout-proof.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  )
  return result
}

async function waitForLayout(webContents: ElectronProofWebContents) {
  await executeElectronRendererScript(
    webContents,
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  )
}

async function resetDialogBodyScroll(webContents: ElectronProofWebContents) {
  const result = await executeElectronRendererScript<{ error?: string }>(webContents, `(() => {
    const body = document.querySelector('[data-probe="capture-completion-body"]');
    if (!body) return { error: 'Missing Capture completion body before workflow completion.' };
    body.scrollTop = 0;
    return {};
  })()`)
  if (result.error) throw new Error(result.error)
  await waitForLayout(webContents)
}

async function measureDialog(
  webContents: ElectronProofWebContents,
  requestedViewport: CaptureCompletionLayoutMeasurement['requestedViewport'],
): Promise<CaptureCompletionLayoutMeasurement | FailedMeasurement> {
  const result = await executeElectronRendererScript<FailedMeasurement | Omit<CaptureCompletionLayoutMeasurement, 'requestedViewport'>>(webContents, `(async () => {
    const shell = document.querySelector('[data-probe="capture-completion-shell"]');
    const body = document.querySelector('[data-probe="capture-completion-body"]');
    const header = document.querySelector('[data-probe="capture-completion-header"]');
    const close = shell?.querySelector('[data-slot="dialog-close"]');
    const footer = document.querySelector('[data-probe="capture-completion-footer"]');
    if (!shell || !body || !header || !close || !footer) {
      return { error: 'Missing Capture completion shell, body, header, close control, or footer.' };
    }
    const round = (value) => Math.round(value * 100) / 100;
    const rectangle = (element) => {
      const value = element.getBoundingClientRect();
      return { bottom: round(value.bottom), height: round(value.height), left: round(value.left), right: round(value.right), top: round(value.top), width: round(value.width) };
    };
    const surface = (element) => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      scrollWidth: element.scrollWidth,
    });
    const snapshot = () => ({
      body: surface(body),
      close: rectangle(close),
      footer: rectangle(footer),
      header: rectangle(header),
      shell: { ...surface(shell), rectangle: rectangle(shell) },
    });
    body.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = snapshot();
    body.scrollTop = body.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      after: snapshot(),
      before,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  })()`)
  if ('error' in result) return result
  return { ...result, requestedViewport }
}

function rectangleInsideShell(rectangle: Rectangle, shell: ShellMeasurement) {
  return rectangle.height > 0
    && rectangle.width > 0
    && rectangle.bottom <= shell.rectangle.bottom + tolerance
    && rectangle.left >= shell.rectangle.left - tolerance
    && rectangle.right <= shell.rectangle.right + tolerance
    && rectangle.top >= shell.rectangle.top - tolerance
}

function rectanglesMatch(left: Rectangle, right: Rectangle) {
  return Math.abs(left.bottom - right.bottom) <= tolerance
    && Math.abs(left.left - right.left) <= tolerance
    && Math.abs(left.right - right.right) <= tolerance
    && Math.abs(left.top - right.top) <= tolerance
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500)
}
