import fs from 'node:fs'
import path from 'node:path'
import type { WebContents } from 'electron'

import {
  captureRendererConsole,
  createElectronNativeUiDriver,
  executeElectronRendererScript,
  type ElectronNativeUiDriver,
  type ElectronProofWebContents,
  type SemanticTarget,
} from './native-ui-proof'
import type { IsolatedValidationManifest } from '../src/runtime/isolated-validation'
import type { WorkspaceSummary } from '../src/workspace/workspace.initializer'
import { requireIsolatedProofSession } from './isolated-proof-session'

const schemaVersion = 'valedictorian-dialog-close-target-proof@2'
const viewportHeight = 540
const viewportWidths = [320, 768, 1440] as const
const proofTimeoutMs = 2_000
const coordinateToleranceCssPixels = 1

type PointName = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

interface Rectangle {
  readonly bottom: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly width: number
}

interface Point {
  readonly x: number
  readonly y: number
}

interface HitTarget {
  readonly ariaLabel: string | null
  readonly dataSlot: string | null
  readonly isCloseTarget: boolean
  readonly tagName: string
}

interface PointMeasurement {
  readonly close: Rectangle
  readonly hit: HitTarget
  readonly name: PointName
  readonly nativePointerClosed: boolean
  readonly nativePointerEvents: readonly NativePointerEvent[]
  readonly nativeInputPoint: Point
  readonly point: Point
  readonly viewport: { readonly height: number; readonly width: number }
}

interface HoverMeasurement {
  readonly baseBackgroundColor: string
  readonly backgroundColor: string
  readonly hovered: boolean
  readonly nativeEvents: readonly NativePointerEvent[]
  readonly pointerMoveTarget: NativePointerEvent | null
  readonly receivedPointer: Point | null
}

interface NativePointerEvent {
  readonly ariaLabel: string | null
  readonly dataSlot: string | null
  readonly isCloseTarget: boolean
  readonly tagName: string
  readonly type: string
}

interface KeyboardMeasurement {
  readonly baseFocusStyle: FocusStyle
  readonly closed: boolean
  readonly focusStyle: FocusStyle
  readonly focusVisible: boolean
  readonly focusedCloseTarget: boolean
  readonly visibleFocusTreatment: boolean
}

interface FocusStyle {
  readonly borderColor: string
  readonly boxShadow: string
  readonly outlineColor: string
  readonly outlineStyle: string
  readonly outlineWidth: string
}

export interface DialogCloseTargetMeasurement {
  readonly accessibleName: string | null
  readonly close: Rectangle
  readonly consumer: 'capture-completion' | 'form-modal'
  readonly devicePixelRatio: number
  readonly hover: HoverMeasurement
  readonly keyboard: KeyboardMeasurement
  readonly points: readonly PointMeasurement[]
  readonly requestedViewport: { readonly height: number; readonly width: number }
  readonly viewport: { readonly height: number; readonly width: number }
  readonly zoomFactor: number
}

interface FailedMeasurement {
  readonly error: string
}

interface InputEventWebContents extends ElectronProofWebContents {
  focus(): void
  isDestroyed(): boolean
  sendInputEvent(event: ElectronInputEvent): void
  setZoomFactor(factor: number): void
}

interface CloseTargetProofWindow {
  focus(): void
  getBounds(): { readonly height: number; readonly width: number }
  getContentSize(): readonly number[]
  getMaximumSize(): readonly number[]
  getMinimumSize(): readonly number[]
  isDestroyed(): boolean
  setContentSize(width: number, height: number): void
  setMaximumSize(width: number, height: number): void
  setMinimumSize(width: number, height: number): void
  readonly webContents: InputEventWebContents
}

type ElectronInputEvent = Parameters<WebContents['sendInputEvent']>[0]

interface DialogConsumer {
  readonly dialog: SemanticTarget
  readonly id: DialogCloseTargetMeasurement['consumer']
  readonly open: (driver: ElectronNativeUiDriver) => Promise<void>
}

export interface DialogCloseTargetProofResult {
  readonly build: IsolatedValidationManifest['build']
  readonly diagnostics: {
    readonly assertionFailure?: string
    readonly rendererConsole: readonly string[]
  }
  readonly environment: {
    readonly deviceScale: 'default'
    readonly mode: 'development'
    readonly os: NodeJS.Platform
    readonly zoomFactor: number
  }
  readonly measurements: readonly DialogCloseTargetMeasurement[]
  readonly outcome: 'completed' | 'failed'
  readonly schemaVersion: typeof schemaVersion
  readonly steps: readonly string[]
  readonly workspace: IsolatedValidationManifest['workspace']
}

export async function runIsolatedDialogCloseTargetProof({
  manifest,
  window,
  workspace,
}: {
  readonly manifest: IsolatedValidationManifest | null
  readonly window: CloseTargetProofWindow
  readonly workspace: Pick<WorkspaceSummary, 'id' | 'rootPath'>
}): Promise<DialogCloseTargetProofResult> {
  const { manifest: verifiedManifest, session } = requireIsolatedProofSession({
    manifest, proofName: 'Dialog close target proof', window, workspace,
  })

  return measureDialogCloseTargets({ evidenceDirectory: session.evidenceDirectory, manifest: verifiedManifest, window })
}

export function dialogCloseTargetMeasurementFailures(measurement: DialogCloseTargetMeasurement): string[] {
  const failures: string[] = []
  if (measurement.accessibleName !== 'Close') failures.push('Close control does not expose the accessible name Close.')
  if (
    measurement.viewport.width !== measurement.requestedViewport.width
    || measurement.viewport.height !== measurement.requestedViewport.height
  ) {
    failures.push('Renderer viewport did not match the requested CSS viewport.')
  }
  if (
    measurement.close.width <= 0
    || measurement.close.height <= 0
    || measurement.close.left < 0
    || measurement.close.right > measurement.viewport.width
    || measurement.close.top < 0
    || measurement.close.bottom > measurement.viewport.height
  ) failures.push('Close control does not have visible clickable bounds in the requested viewport.')
  if (!hasNativeHoverEvidence(measurement.hover, measurement.close)) {
    failures.push('Close control did not receive a visible native hover treatment.')
  }
  if (!measurement.keyboard.focusedCloseTarget) failures.push('Keyboard navigation did not focus the close control.')
  if (!measurement.keyboard.focusVisible) failures.push('Keyboard focus did not expose the close control focus-visible state.')
  if (!measurement.keyboard.visibleFocusTreatment) {
    failures.push('Keyboard focus did not expose a computed visible focus treatment.')
  }
  if (!measurement.keyboard.closed) failures.push('Keyboard activation did not close the Radix dialog.')
  const expectedPoints: readonly PointName[] = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
  for (const pointName of expectedPoints) {
    const point = measurement.points.find((entry) => entry.name === pointName)
    if (!point) {
      failures.push(`Missing ${pointName} close-target measurement.`)
      continue
    }
    if (!point.hit.isCloseTarget) failures.push(`${pointName} hit test is covered by ${point.hit.tagName}.`)
    if (!matchesNamedCloseTargetPoint(point)) {
      failures.push(`${pointName} coordinate did not match its close-target quadrant.`)
    }
    if (
      point.viewport.width !== measurement.requestedViewport.width
      || point.viewport.height !== measurement.requestedViewport.height
    ) {
      failures.push(`${pointName} pointer activation did not use the requested CSS viewport.`)
    }
    if (!hasNativeCloseClick(point.nativePointerEvents)) {
      failures.push(`${pointName} native pointer activation did not dispatch pointerdown, pointerup, and click to the close control.`)
    }
    if (!point.nativePointerClosed) {
      failures.push(`${pointName} native pointer activation did not close the Radix dialog.`)
    }
  }
  return failures
}

function hasNativeCloseClick(events: readonly NativePointerEvent[]) {
  return ['pointerdown', 'pointerup', 'click'].every((type) => (
    events.some((event) => event.type === type && event.isCloseTarget)
  ))
}

function hasNativeHoverEvidence(hover: HoverMeasurement, close: Rectangle) {
  return hover.hovered
    && hover.pointerMoveTarget?.isCloseTarget === true
    && hover.receivedPointer !== null
    && isPointInsideCloseTarget(hover.receivedPointer, close)
    && hover.backgroundColor !== hover.baseBackgroundColor
    && !isTransparentColor(hover.backgroundColor)
}

function matchesNamedCloseTargetPoint(point: PointMeasurement) {
  const expected = closeTargetPoint(point.close, point.name)
  return Math.abs(point.point.x - expected.x) <= coordinateToleranceCssPixels
    && Math.abs(point.point.y - expected.y) <= coordinateToleranceCssPixels
    && Math.abs(point.nativeInputPoint.x - expected.x) <= coordinateToleranceCssPixels
    && Math.abs(point.nativeInputPoint.y - expected.y) <= coordinateToleranceCssPixels
}

function isPointInsideCloseTarget(point: Point, close: Rectangle) {
  return point.x >= close.left
    && point.x <= close.right
    && point.y >= close.top
    && point.y <= close.bottom
}

function isTransparentColor(value: string) {
  return value === 'transparent' || value === 'rgba(0, 0, 0, 0)'
}

async function measureDialogCloseTargets({
  evidenceDirectory,
  manifest,
  window,
}: {
  readonly evidenceDirectory: string
  readonly manifest: IsolatedValidationManifest
  readonly window: CloseTargetProofWindow
}): Promise<DialogCloseTargetProofResult> {
  const rendererConsole = captureRendererConsole(window.webContents)
  const measurements: DialogCloseTargetMeasurement[] = []
  let failure: unknown
  const [minimumWidth = 0, minimumHeight = 0] = window.getMinimumSize()
  const [maximumWidth = 0, maximumHeight = 0] = window.getMaximumSize()
  try {
    window.setMinimumSize(1, 1)
    window.setMaximumSize(0, 0)
    window.webContents.setZoomFactor(1)
    const driver = createElectronNativeUiDriver(window.webContents)
    for (const consumer of dialogConsumers()) {
      for (const measurement of await measureConsumer({ consumer, driver, window })) {
        measurements.push(measurement)
        const failures = dialogCloseTargetMeasurementFailures(measurement)
        if (failures.length > 0) {
          throw new Error(`${consumer.id} at ${measurement.requestedViewport.width}px: ${failures.join(' ')}`)
        }
      }
    }
  } catch (error) {
    failure = error
  } finally {
    window.setMaximumSize(maximumWidth, maximumHeight)
    window.setMinimumSize(minimumWidth, minimumHeight)
    rendererConsole.stop()
  }

  const result: DialogCloseTargetProofResult = {
    build: manifest.build,
    diagnostics: {
      ...(failure ? { assertionFailure: safeErrorMessage(failure) } : {}),
      rendererConsole: rendererConsole.entries(),
    },
    environment: {
      deviceScale: 'default', mode: 'development', os: process.platform, zoomFactor: 1,
    },
    measurements,
    outcome: failure ? 'failed' : 'completed',
    schemaVersion,
    steps: [
      'Open each visible shared-dialog consumer in the isolated development Electron window.',
      'Set the Electron content viewport to 320×540, 768×540, and 1440×540 CSS pixels at zoom factor 1.',
      'Wait for every exiting dialog content and overlay layer to unmount before opening the next consumer.',
      'Record close bounds and document.elementFromPoint at center plus four interior quadrants.',
      'Use webContents.sendInputEvent for every hover, pointer attempt, and keyboard Space activation; explicitly focus the native window and web contents before the Tab/Space sequence.',
    ],
    workspace: manifest.workspace,
  }
  fs.writeFileSync(
    path.join(evidenceDirectory, 'dialog-close-target-proof.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  )
  return result
}

function dialogConsumers(): readonly DialogConsumer[] {
  return [
    {
      dialog: { name: 'Complete Capture into a Job', role: 'dialog' },
      id: 'capture-completion',
      async open(driver) {
        await driver.waitFor({ name: 'Complete Job information', role: 'button' })
        await driver.click({ name: 'Complete Job information', role: 'button' })
        await driver.waitFor({ name: 'Complete Capture into a Job', role: 'dialog' })
      },
    },
    {
      dialog: { name: 'Add capture', role: 'dialog' },
      id: 'form-modal',
      async open(driver) {
        await driver.waitFor({ name: 'Add capture', role: 'button' })
        await driver.click({ name: 'Add capture', role: 'button' })
        await driver.waitFor({ name: 'Add capture', role: 'dialog' })
      },
    },
  ]
}

async function measureConsumer({
  consumer,
  driver,
  window,
}: {
  readonly consumer: DialogConsumer
  readonly driver: ElectronNativeUiDriver
  readonly window: CloseTargetProofWindow
}): Promise<readonly DialogCloseTargetMeasurement[]> {
  const measurements: DialogCloseTargetMeasurement[] = []
  for (const width of viewportWidths) {
    const points: PointMeasurement[] = []
    for (const name of closeTargetPointNames) {
      points.push(await measurePointActivation({
        consumer,
        driver,
        name,
        viewport: { height: viewportHeight, width },
        window,
      }))
    }

    await setViewport({
      consumer,
      driver,
      viewport: { height: viewportHeight, width },
      window,
    })
    const initial = await inspectCloseTarget(window.webContents, consumer.dialog)
    if (isFailedMeasurement(initial)) throw new Error(initial.error)
    const center = closeTargetPoint(initial.close, 'center')
    const hover = await measureNativeHover(window, consumer.dialog, center)
    const keyboardBaseline = await inspectKeyboardState(window.webContents, consumer.dialog)
    if (isFailedMeasurement(keyboardBaseline)) throw new Error(keyboardBaseline.error)
    // Tab and Space are one contiguous native interaction: refocusing after Tab can clear the close control.
    await focusNativeKeyboardInput(window)
    const keyboard = await nativeTabToClose(window, consumer.dialog)
    await nativeSpace(window)
    const keyboardClosed = await waitForDialogClosed(driver, consumer.dialog)
    if (!keyboardClosed) throw new Error('Keyboard activation did not close the Radix dialog.')
    await waitForDialogLayersRemoved(window.webContents)

    measurements.push({
      accessibleName: initial.accessibleName,
      close: initial.close,
      consumer: consumer.id,
      devicePixelRatio: initial.devicePixelRatio,
      hover,
      points,
      requestedViewport: { height: viewportHeight, width },
      viewport: initial.viewport,
      zoomFactor: 1,
      keyboard: {
        ...keyboard,
        baseFocusStyle: keyboardBaseline.focusStyle,
        closed: keyboardClosed,
        visibleFocusTreatment: hasComputedVisibleFocusTreatment(keyboard.focusStyle, keyboardBaseline.focusStyle),
      },
    })
  }
  return measurements
}

async function setViewport({
  consumer,
  driver,
  viewport,
  window,
}: {
  readonly consumer: DialogConsumer
  readonly driver: ElectronNativeUiDriver
  readonly viewport: { readonly height: number; readonly width: number }
  readonly window: CloseTargetProofWindow
}) {
  await consumer.open(driver)
  lockWindowToContentViewport(window, viewport)
  window.setContentSize(viewport.width, viewport.height)
  await waitForLayout(window.webContents)
}

function lockWindowToContentViewport(
  window: CloseTargetProofWindow,
  viewport: { readonly height: number; readonly width: number },
) {
  window.setMinimumSize(1, 1)
  window.setMaximumSize(0, 0)
  const bounds = window.getBounds()
  const [contentWidth = bounds.width, contentHeight = bounds.height] = window.getContentSize()
  const width = viewport.width + Math.max(0, bounds.width - contentWidth)
  const height = viewport.height + Math.max(0, bounds.height - contentHeight)
  window.setMaximumSize(width, height)
  window.setMinimumSize(width, height)
}

async function measurePointActivation({
  consumer,
  driver,
  name,
  viewport,
  window,
}: {
  readonly consumer: DialogConsumer
  readonly driver: ElectronNativeUiDriver
  readonly name: PointName
  readonly viewport: { readonly height: number; readonly width: number }
  readonly window: CloseTargetProofWindow
}): Promise<PointMeasurement> {
  await setViewport({ consumer, driver, viewport, window })
  const initial = await inspectCloseTarget(window.webContents, consumer.dialog)
  if (isFailedMeasurement(initial)) throw new Error(initial.error)
  const point = closeTargetPoint(initial.close, name)
  const hitTest = await inspectCloseTarget(window.webContents, consumer.dialog, point)
  if (isFailedMeasurement(hitTest)) throw new Error(hitTest.error)
  await resetPointerProbe(window.webContents)
  await nativeClick(window, point)
  const nativePointerClosed = await waitForDialogClosed(driver, consumer.dialog)
  const nativePointerEvents = await inspectPointerEvents(window.webContents)
  if (!nativePointerClosed) throw new Error(`${name} native pointer activation did not close the Radix dialog.`)
  await waitForDialogLayersRemoved(window.webContents)
  return {
    close: hitTest.close,
    hit: hitTest.hit,
    name,
    nativePointerClosed,
    nativePointerEvents,
    nativeInputPoint: point,
    point,
    viewport: hitTest.viewport,
  }
}

function hasComputedVisibleFocusTreatment(focused: FocusStyle, baseline: FocusStyle) {
  const hasOutline = focused.outlineStyle !== 'none'
    && focused.outlineWidth !== '0px'
    && !isTransparentColor(focused.outlineColor)
    && focused.outlineColor !== baseline.outlineColor
  const hasRing = focused.boxShadow !== 'none'
    && focused.boxShadow !== ''
    && focused.boxShadow !== baseline.boxShadow
  const hasBorder = !isTransparentColor(focused.borderColor)
    && focused.borderColor !== baseline.borderColor
  return hasOutline || hasRing || hasBorder
}

async function inspectCloseTarget(
  webContents: ElectronProofWebContents,
  dialog: SemanticTarget,
  point?: Point,
): Promise<FailedMeasurement | {
  readonly accessibleName: string | null
  readonly close: Rectangle
  readonly devicePixelRatio: number
  readonly hit: HitTarget
  readonly viewport: { readonly height: number; readonly width: number }
}> {
  return executeElectronRendererScript(webContents, `(() => {
    const dialogName = ${JSON.stringify(dialog.name)};
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const dialog = dialogs.find((element) => element.getAttribute('aria-label') === dialogName || element.getAttribute('aria-labelledby') && element.getAttribute('aria-labelledby').split(/\\s+/).some((id) => document.getElementById(id)?.textContent?.replace(/\\s+/g, ' ').trim() === dialogName));
    const close = dialog?.querySelector('[data-slot="dialog-close"]');
    if (!(close instanceof HTMLButtonElement)) return { error: 'Missing shared close button for dialog ' + dialogName + '.' };
    const rect = close.getBoundingClientRect();
    const round = (value) => Math.round(value * 100) / 100;
    const element = ${point ? `document.elementFromPoint(${point.x}, ${point.y})` : 'close'};
    const target = element instanceof Element ? element : null;
    return {
      accessibleName: close.getAttribute('aria-label'),
      close: { bottom: round(rect.bottom), height: round(rect.height), left: round(rect.left), right: round(rect.right), top: round(rect.top), width: round(rect.width) },
      devicePixelRatio: window.devicePixelRatio,
      hit: {
        ariaLabel: target?.getAttribute('aria-label') ?? null,
        dataSlot: target?.getAttribute('data-slot') ?? null,
        isCloseTarget: target === close || Boolean(target?.closest('[data-slot="dialog-close"]')),
        tagName: target?.tagName ?? 'NONE',
      },
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  })()`) as Promise<FailedMeasurement | {
    readonly accessibleName: string | null
    readonly close: Rectangle
    readonly devicePixelRatio: number
    readonly hit: HitTarget
    readonly viewport: { readonly height: number; readonly width: number }
  }>
}

async function inspectKeyboardState(
  webContents: ElectronProofWebContents,
  dialog: SemanticTarget,
): Promise<FailedMeasurement | Omit<KeyboardMeasurement, 'baseFocusStyle' | 'closed'>> {
  return executeElectronRendererScript(webContents, `(() => {
    const dialogName = ${JSON.stringify(dialog.name)};
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((element) => element.getAttribute('aria-label') === dialogName || element.getAttribute('aria-labelledby') && element.getAttribute('aria-labelledby').split(/\\s+/).some((id) => document.getElementById(id)?.textContent?.replace(/\\s+/g, ' ').trim() === dialogName));
    const close = dialog?.querySelector('[data-slot="dialog-close"]');
    if (!(close instanceof HTMLButtonElement)) return { error: 'Missing shared close button for keyboard check.' };
    const style = getComputedStyle(close);
    const focusStyle = {
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
    return {
      focusStyle,
      focusVisible: close.matches(':focus-visible'),
      focusedCloseTarget: document.activeElement === close,
      visibleFocusTreatment: false,
    };
  })()`) as Promise<FailedMeasurement | Omit<KeyboardMeasurement, 'baseFocusStyle' | 'closed'>>
}

async function inspectHoverState(
  webContents: ElectronProofWebContents,
  dialog: SemanticTarget,
): Promise<FailedMeasurement | HoverMeasurement> {
  return executeElectronRendererScript(webContents, `(() => {
    const dialogName = ${JSON.stringify(dialog.name)};
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((element) => element.getAttribute('aria-label') === dialogName || element.getAttribute('aria-labelledby') && element.getAttribute('aria-labelledby').split(/\\s+/).some((id) => document.getElementById(id)?.textContent?.replace(/\\s+/g, ' ').trim() === dialogName));
    const close = dialog?.querySelector('[data-slot="dialog-close"]');
    if (!(close instanceof HTMLButtonElement)) return { error: 'Missing shared close button for hover check.' };
    const pointer = window.__dialogCloseTargetPointer;
    const events = Array.isArray(window.__dialogCloseTargetEvents) ? window.__dialogCloseTargetEvents : [];
    return {
      baseBackgroundColor: window.__dialogCloseTargetBaseBackgroundColor ?? getComputedStyle(close).backgroundColor,
      backgroundColor: getComputedStyle(close).backgroundColor,
      hovered: close.matches(':hover'),
      nativeEvents: events,
      pointerMoveTarget: [...events].reverse().find((event) => event.type === 'pointermove') ?? null,
      receivedPointer: pointer && typeof pointer.x === 'number' && typeof pointer.y === 'number' ? pointer : null,
    };
  })()`) as Promise<FailedMeasurement | HoverMeasurement>
}

async function resetPointerProbe(webContents: ElectronProofWebContents) {
  await executeElectronRendererScript(webContents, `(() => {
    window.__dialogCloseTargetPointer = null;
    window.__dialogCloseTargetEvents = [];
    if (window.__dialogCloseTargetPointerProbeInstalled) return;
    window.__dialogCloseTargetPointerProbeInstalled = true;
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'click']) {
      document.addEventListener(type, (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (type === 'pointermove') window.__dialogCloseTargetPointer = { x: event.clientX, y: event.clientY };
        window.__dialogCloseTargetEvents.push({
          ariaLabel: target?.getAttribute('aria-label') ?? null,
          dataSlot: target?.getAttribute('data-slot') ?? null,
          isCloseTarget: Boolean(target?.closest('[data-slot="dialog-close"]')),
          tagName: target?.tagName ?? 'NONE',
          type,
        });
      }, true);
    }
  })()`)
}

async function inspectPointerEvents(webContents: ElectronProofWebContents) {
  return executeElectronRendererScript(
    webContents,
    'Array.isArray(window.__dialogCloseTargetEvents) ? window.__dialogCloseTargetEvents : []',
  ) as Promise<readonly NativePointerEvent[]>
}

const closeTargetPointNames: readonly PointName[] = [
  'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
]

function closeTargetPoint(close: Rectangle, name: PointName): Point {
  const position: Record<PointName, readonly [number, number]> = {
    center: [0.5, 0.5],
    'top-left': [0.25, 0.25],
    'top-right': [0.75, 0.25],
    'bottom-left': [0.25, 0.75],
    'bottom-right': [0.75, 0.75],
  }
  const [horizontal, vertical] = position[name]
  return {
    x: Math.round(close.left + close.width * horizontal),
    y: Math.round(close.top + close.height * vertical),
  }
}

async function nativeTabToClose(window: CloseTargetProofWindow, dialog: SemanticTarget) {
  let result: FailedMeasurement | Omit<KeyboardMeasurement, 'baseFocusStyle' | 'closed'> = {
    focusStyle: {
      borderColor: 'transparent', boxShadow: 'none', outlineColor: 'transparent', outlineStyle: 'none', outlineWidth: '0px',
    },
    focusVisible: false,
    focusedCloseTarget: false,
    visibleFocusTreatment: false,
  }
  for (let step = 0; step < 32; step += 1) {
    await sendInput(window, { keyCode: 'TAB', type: 'keyDown' })
    await sendInput(window, { keyCode: 'TAB', type: 'keyUp' })
    result = await inspectKeyboardState(window.webContents, dialog)
    if (isFailedMeasurement(result)) throw new Error(result.error)
    if (result.focusedCloseTarget) return result
  }
  if (isFailedMeasurement(result)) throw new Error(result.error)
  return result
}

async function nativeSpace(window: CloseTargetProofWindow) {
  await sendInput(window, { keyCode: 'Space', type: 'keyDown' })
  await sendInput(window, { keyCode: 'Space', type: 'keyUp' })
}

async function focusNativeKeyboardInput(window: CloseTargetProofWindow) {
  window.focus()
  window.webContents.focus()
  await waitForLayout(window.webContents)
}

async function nativeMouseMove(window: CloseTargetProofWindow, point: Point) {
  await sendInput(window, { type: 'mouseMove', ...point })
}

async function measureNativeHover(
  window: CloseTargetProofWindow,
  dialog: SemanticTarget,
  point: Point,
) {
  let hover: FailedMeasurement | HoverMeasurement = {
    baseBackgroundColor: 'transparent',
    backgroundColor: 'transparent',
    hovered: false,
    nativeEvents: [],
    pointerMoveTarget: null,
    receivedPointer: null,
  }
  await nativeMouseMove(window, { x: 0, y: 0 })
  await sleep(200)
  const baseline = await inspectHoverState(window.webContents, dialog)
  if (isFailedMeasurement(baseline)) throw new Error(baseline.error)
  await executeElectronRendererScript(
    window.webContents,
    `window.__dialogCloseTargetBaseBackgroundColor = ${JSON.stringify(baseline.backgroundColor)}`,
  )
  await resetPointerProbe(window.webContents)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await nativeMouseMove(window, { x: Math.max(0, point.x - 48), y: point.y })
    await nativeMouseMove(window, point)
    await sleep(150)
    hover = await inspectHoverState(window.webContents, dialog)
    if (isFailedMeasurement(hover)) throw new Error(hover.error)
    if (
      hover.hovered
      && hover.pointerMoveTarget?.isCloseTarget
      && hover.receivedPointer?.x === point.x
      && hover.receivedPointer.y === point.y
      && hover.backgroundColor !== hover.baseBackgroundColor
      && !isTransparentColor(hover.backgroundColor)
    ) return hover
    await sleep(25)
  }
  if (isFailedMeasurement(hover)) throw new Error(hover.error)
  return hover
}

async function nativeClick(window: CloseTargetProofWindow, point: Point) {
  window.webContents.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseDown', ...point })
  window.webContents.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseUp', ...point })
  await waitForLayout(window.webContents)
}

async function sendInput(window: CloseTargetProofWindow, event: ElectronInputEvent) {
  window.webContents.sendInputEvent(event)
  await waitForLayout(window.webContents)
}

async function waitForDialogClosed(driver: ElectronNativeUiDriver, dialog: SemanticTarget) {
  const deadline = Date.now() + proofTimeoutMs
  while (Date.now() < deadline) {
    if (!await driver.exists(dialog)) return true
    await sleep(25)
  }
  return false
}

async function waitForDialogLayersRemoved(webContents: ElectronProofWebContents) {
  const deadline = Date.now() + proofTimeoutMs
  while (Date.now() < deadline) {
    const layersPresent = await executeElectronRendererScript(
      webContents,
      "Boolean(document.querySelector('[data-slot=\"dialog-content\"], [data-slot=\"dialog-overlay\"]'))",
    )
    if (!layersPresent) return
    await sleep(25)
  }
  throw new Error('Closed dialog layers did not unmount before the next consumer opened.')
}

async function waitForLayout(webContents: ElectronProofWebContents) {
  await executeElectronRendererScript(
    webContents,
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  )
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 320)
}

function isFailedMeasurement(value: FailedMeasurement | object): value is FailedMeasurement {
  return 'error' in value && typeof value.error === 'string'
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
