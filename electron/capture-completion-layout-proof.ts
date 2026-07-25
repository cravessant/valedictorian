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
  captureCompletionLongContentFixture,
  isolatedValidationFixture,
} from '../src/runtime/isolated-validation.fixture-contract'
import {
  readIsolatedValidationEnvironment,
  type IsolatedValidationManifest,
} from '../src/runtime/isolated-validation'
import type { WorkspaceSummary } from '../src/workspace/workspace.initializer'

const schemaVersion = 'valedictorian-capture-completion-dialog-layout-proof@3'
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

interface BoundedSurfaceMeasurement extends SurfaceMeasurement {
  readonly rectangle: Rectangle
}

interface EvidenceMeasurement extends BoundedSurfaceMeasurement {
  readonly overflowX: string
}

type OwnedRegion = 'destination' | 'footer' | 'header' | 'provenance' | 'source'

interface OwnedRectangle {
  readonly name: string
  readonly owner: OwnedRegion
  readonly rectangle: Rectangle
}

interface LongContentMeasurement {
  readonly owned: readonly OwnedRectangle[]
  readonly destination: BoundedSurfaceMeasurement
  readonly provenance: BoundedSurfaceMeasurement
  readonly rawEvidence: EvidenceMeasurement
  readonly source: BoundedSurfaceMeasurement
}

interface LayoutSnapshot {
  readonly body: BoundedSurfaceMeasurement
  readonly close: Rectangle
  readonly content: LongContentMeasurement
  readonly footer: Rectangle
  readonly header: Rectangle
  readonly shell: BoundedSurfaceMeasurement
}

export interface CaptureCompletionLayoutMeasurement {
  readonly after: LayoutSnapshot
  readonly before: LayoutSnapshot
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
  for (const [moment, snapshot] of [['before', before], ['after', after]] as const) {
    const { content } = snapshot
    for (const [name, region] of [
      ['provenance', content.provenance],
      ['source evidence', content.source],
      ['destination form', content.destination],
    ] as const) {
      if (!rectangleHorizontallyInside(region.rectangle, snapshot.body.rectangle)) {
        failures.push(`${name} escapes the body horizontally ${moment} scrolling.`)
      }
      if (region.scrollWidth > region.clientWidth + tolerance) {
        failures.push(`${name} horizontally overflows ${moment} scrolling (${region.scrollWidth} > ${region.clientWidth}).`)
      }
    }
    if (!rectangleInside(content.rawEvidence.rectangle, content.source)) {
      failures.push(`Raw evidence escapes its source panel ${moment} scrolling.`)
    }
    if (content.rawEvidence.scrollWidth <= content.rawEvidence.clientWidth + tolerance) {
      failures.push(`Raw evidence did not retain bounded local machine-text scrolling ${moment} scrolling.`)
    }
    if (!['auto', 'scroll'].includes(content.rawEvidence.overflowX)) {
      failures.push(`Raw evidence does not expose intentional local horizontal scrolling ${moment} scrolling.`)
    }
    const ownerRegions: Record<OwnedRegion, Rectangle> = {
      destination: content.destination.rectangle,
      footer: snapshot.footer,
      header: snapshot.header,
      provenance: content.provenance.rectangle,
      source: content.source.rectangle,
    }
    for (const element of content.owned) {
      if (!rectangleInsideRectangle(element.rectangle, ownerRegions[element.owner])) {
        failures.push(`${element.name} escapes its ${element.owner} region ${moment} scrolling.`)
      }
    }
    if (rectanglesOverlap(content.source.rectangle, content.destination.rectangle)) {
      failures.push(`Source evidence overlaps the destination form ${moment} scrolling.`)
    }
  }
  for (const [name, beforeRect, afterRect] of [
    ['header', before.header, after.header],
    ['close control', before.close, after.close],
    ['footer actions', before.footer, after.footer],
  ] as const) {
    if (!rectanglesMatch(beforeRect, afterRect)) failures.push(`${name} moved while the body scrolled.`)
    if (!rectangleInside(afterRect, after.shell)) failures.push(`${name} is not reachable inside the shell after scrolling.`)
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
    window.setMinimumSize(1, 1)
    window.webContents.setZoomFactor(1)
    const driver = createElectronNativeUiDriver(window.webContents)
    await driver.waitFor({ name: 'Complete Job information', role: 'button' })
    await driver.click({ name: 'Complete Job information', role: 'button' })
    await driver.waitFor({ name: 'Complete Capture into a Job', role: 'dialog' })
    const completionDialog = { name: 'Complete Capture into a Job', role: 'dialog' } as const
    await driver.waitForText(completionDialog, 'Raw evidence (3)')
    await driver.waitForText(completionDialog, captureCompletionLongContentFixture.destinationUrl)
    assertions.captureCompletionOpened = true
    await prepareLongContentFixtures(driver, window.webContents)
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
    await driver.fill({ name: 'Job facts company', role: 'textbox' }, 'Validation Company')
    await completeElectronNativeUiCapture(driver, assertions, {
      completionCompanyName: captureCompletionLongContentFixture.companyDisplayName,
    })
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

async function prepareLongContentFixtures(
  driver: ReturnType<typeof createElectronNativeUiDriver>,
  webContents: ElectronProofWebContents,
) {
  const completionDialog = { name: 'Complete Capture into a Job', role: 'dialog' } as const
  await driver.click({
    name: 'Use an existing local Company',
    role: 'radio',
    within: completionDialog,
  })
  await driver.fill({
    name: 'Search active local Companies',
    role: 'textbox',
    within: completionDialog,
  }, captureCompletionLongContentFixture.companyDisplayName)
  const companyResults = { name: 'Company search results', role: 'list', within: completionDialog } as const
  await driver.waitFor({ name: 'Use', role: 'button', within: companyResults })
  await driver.click({ name: 'Use', role: 'button', within: companyResults })
  await driver.waitForText(
    completionDialog,
    `Using ${captureCompletionLongContentFixture.companyDisplayName}`,
  )
  await driver.fill({ name: 'Job facts company', role: 'textbox', within: completionDialog }, captureCompletionLongContentFixture.formValue)
  await driver.fill({ name: 'Destination URL', role: 'textbox', within: completionDialog }, captureCompletionLongContentFixture.validationUrl)
  await driver.click({ name: 'Create Job', role: 'button', within: completionDialog })
  await driver.waitForText(completionDialog, captureCompletionLongContentFixture.validationMessage)
  const result = await executeElectronRendererScript<{ error?: string }>(webContents, `(() => {
    const details = document.querySelector('[data-probe="capture-completion-source"] details');
    if (!details) return { error: 'Missing raw evidence details for the long-content layout fixture.' };
    details.open = true;
    return {};
  })()`)
  if (result.error) throw new Error(result.error)
  await waitForLayout(webContents)
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
    const provenance = document.querySelector('[data-probe="capture-completion-provenance"]');
    const source = document.querySelector('[data-probe="capture-completion-source"]');
    const rawEvidenceControl = source?.querySelector('summary');
    const rawEvidence = document.querySelector('[data-probe="capture-completion-raw-evidence"]');
    const destination = document.querySelector('[data-probe="capture-completion-destination"]');
    const provenanceUrl = document.querySelector('[data-probe="capture-completion-provenance-url"]');
    const selectedCompany = document.querySelector('[data-probe="capture-completion-selected-company"]');
    const validationMessage = document.querySelector('[data-probe="capture-completion-message"]');
    if (!shell || !body || !header || !close || !footer || !provenance || !provenanceUrl || !source || !rawEvidenceControl || !rawEvidence || !destination || !selectedCompany || !validationMessage) {
      return { error: 'Missing Capture completion long-content shell, panel, control, validation, or status fixture.' };
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
    const bounded = (element) => ({ ...surface(element), rectangle: rectangle(element) });
    const ownedRectangle = (name, owner, element) => ({ name, owner, rectangle: rectangle(element) });
    const owned = () => [
      ownedRectangle('close control', 'header', close),
      ownedRectangle('resolved destination value', 'provenance', provenanceUrl),
      ownedRectangle('raw evidence control', 'source', rawEvidenceControl),
      ownedRectangle('raw evidence', 'source', rawEvidence),
      ...Array.from(destination.querySelectorAll('button, input, label')).map((element, index) => ownedRectangle('destination control ' + (index + 1), 'destination', element)),
      ownedRectangle('selected Company status', 'destination', selectedCompany),
      ownedRectangle('validation status', 'destination', validationMessage),
      ...Array.from(footer.querySelectorAll('button')).map((element, index) => ownedRectangle('footer action ' + (index + 1), 'footer', element)),
    ];
    const snapshot = () => ({
      body: bounded(body),
      close: rectangle(close),
      content: {
        owned: owned(),
        destination: bounded(destination),
        provenance: bounded(provenance),
        rawEvidence: { ...bounded(rawEvidence), overflowX: getComputedStyle(rawEvidence).overflowX },
        source: bounded(source),
      },
      footer: rectangle(footer),
      header: rectangle(header),
      shell: bounded(shell),
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

function rectangleInside(rectangle: Rectangle, container: BoundedSurfaceMeasurement) {
  return rectangleInsideRectangle(rectangle, container.rectangle)
}

function rectangleInsideRectangle(rectangle: Rectangle, container: Rectangle) {
  return rectangle.height > 0
    && rectangle.width > 0
    && rectangle.bottom <= container.bottom + tolerance
    && rectangle.left >= container.left - tolerance
    && rectangle.right <= container.right + tolerance
    && rectangle.top >= container.top - tolerance
}

function rectangleHorizontallyInside(rectangle: Rectangle, container: Rectangle) {
  return rectangle.width > 0
    && rectangle.left >= container.left - tolerance
    && rectangle.right <= container.right + tolerance
}

function rectanglesOverlap(left: Rectangle, right: Rectangle) {
  return left.left < right.right - tolerance
    && left.right > right.left + tolerance
    && left.top < right.bottom - tolerance
    && left.bottom > right.top + tolerance
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
