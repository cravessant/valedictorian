export interface ElectronNativeUiProofResultSummary {
  readonly diagnostics?: {
    readonly assertionFailure?: unknown
  }
}

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

export function hasDialogCloseTargetEvidence(value: unknown) {
  if (!Array.isArray(value) || value.length !== 6) return false
  const coverage = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) return false
    const consumer = entry.consumer
    const requestedViewport = entry.requestedViewport
    const viewport = entry.viewport
    const close = entry.close
    if (
      (consumer !== 'capture-completion' && consumer !== 'form-modal')
      || !isViewport(requestedViewport)
      || !isViewport(viewport)
      || viewport.width !== requestedViewport.width
      || viewport.height !== requestedViewport.height
      || !hasVisibleBounds(close, viewport)
      || !hasNativeHoverEvidence(entry.hover, close)
      || !hasKeyboardEvidence(entry.keyboard)
      || !hasPointEvidence(entry.points, requestedViewport)
    ) return false
    coverage.add(`${consumer}:${viewport.width}`)
  }
  return coverage.size === 6
}

function hasVisibleBounds(
  value: unknown,
  viewport: { readonly height: number; readonly width: number },
): value is Rectangle {
  if (!isRecord(value)) return false
  return typeof value.width === 'number'
    && typeof value.height === 'number'
    && typeof value.left === 'number'
    && typeof value.right === 'number'
    && typeof value.top === 'number'
    && typeof value.bottom === 'number'
    && value.width > 0
    && value.height > 0
    && value.left >= 0
    && value.right <= viewport.width
    && value.top >= 0
    && value.bottom <= viewport.height
}

function hasNativeHoverEvidence(value: unknown, close: Rectangle) {
  if (!isRecord(value) || !isRecord(value.pointerMoveTarget) || !isPoint(value.receivedPointer)) return false
  return value.hovered === true
    && value.pointerMoveTarget.isCloseTarget === true
    && isPointInsideCloseTarget(value.receivedPointer, close)
    && typeof value.backgroundColor === 'string'
    && value.backgroundColor !== value.baseBackgroundColor
    && !isTransparentColor(value.backgroundColor)
}

function hasKeyboardEvidence(value: unknown) {
  if (!isRecord(value) || !isRecord(value.focusStyle) || !isRecord(value.baseFocusStyle)) return false
  return value.focusedCloseTarget === true
    && value.focusVisible === true
    && value.visibleFocusTreatment === true
    && value.closed === true
    && hasComputedFocusTreatment(value.focusStyle, value.baseFocusStyle)
}

function hasComputedFocusTreatment(focused: Record<string, unknown>, baseline: Record<string, unknown>) {
  const outlineStyle = focused.outlineStyle
  const outlineWidth = focused.outlineWidth
  const outlineColor = focused.outlineColor
  const hasOutline = typeof outlineStyle === 'string'
    && typeof outlineWidth === 'string'
    && typeof outlineColor === 'string'
    && outlineStyle !== 'none'
    && outlineWidth !== '0px'
    && !isTransparentColor(outlineColor)
    && outlineColor !== baseline.outlineColor
  const boxShadow = focused.boxShadow
  const hasRing = typeof boxShadow === 'string'
    && boxShadow !== 'none'
    && boxShadow !== ''
    && boxShadow !== baseline.boxShadow
  const borderColor = focused.borderColor
  const hasBorder = typeof borderColor === 'string'
    && !isTransparentColor(borderColor)
    && borderColor !== baseline.borderColor
  return hasOutline || hasRing || hasBorder
}

function hasPointEvidence(value: unknown, requestedViewport: { readonly height: number; readonly width: number }) {
  if (!Array.isArray(value) || value.length !== 5) return false
  const names = new Set<string>()
  for (const point of value) {
    const close = isRecord(point) ? point.close : undefined
    const coordinate = isRecord(point) ? point.point : undefined
    const nativeInputPoint = isRecord(point) ? point.nativeInputPoint : undefined
    if (
      !isRecord(point)
      || !isRecord(point.hit)
      || !isViewport(point.viewport)
      || !isPoint(coordinate)
      || !isPoint(nativeInputPoint)
      || !hasVisibleBounds(close, point.viewport)
    ) return false
    if (
      !isPointName(point.name)
      || point.hit.isCloseTarget !== true
      || point.nativePointerClosed !== true
      || point.viewport.width !== requestedViewport.width
      || point.viewport.height !== requestedViewport.height
      || coordinate.x !== nativeInputPoint.x
      || coordinate.y !== nativeInputPoint.y
      || !isPointInsideCloseTarget(coordinate, close)
      || !matchesNamedCloseTargetPoint(point.name, coordinate, close)
      || !matchesNamedCloseTargetPoint(point.name, nativeInputPoint, close)
      || !Array.isArray(point.nativePointerEvents)
      || !hasNativeCloseClick(point.nativePointerEvents)
    ) return false
    names.add(point.name)
  }
  return ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].every((name) => names.has(name))
}

function matchesNamedCloseTargetPoint(name: PointName, point: Point, close: Rectangle) {
  const [horizontal, vertical] = closeTargetPointPositions[name]
  const expectedX = close.left + close.width * horizontal
  const expectedY = close.top + close.height * vertical
  // Bounds are serialized to hundredths while Electron mouse coordinates are integral CSS pixels.
  return Math.abs(point.x - expectedX) <= coordinateToleranceCssPixels
    && Math.abs(point.y - expectedY) <= coordinateToleranceCssPixels
}

function isPointInsideCloseTarget(point: Point, close: Rectangle) {
  return point.x >= close.left
    && point.x <= close.right
    && point.y >= close.top
    && point.y <= close.bottom
}

const closeTargetPointPositions: Record<PointName, readonly [number, number]> = {
  center: [0.5, 0.5],
  'top-left': [0.25, 0.25],
  'top-right': [0.75, 0.25],
  'bottom-left': [0.25, 0.75],
  'bottom-right': [0.75, 0.75],
}

function hasNativeCloseClick(events: readonly unknown[]) {
  return ['pointerdown', 'pointerup', 'click'].every((type) => (
    events.some((event) => isRecord(event) && event.type === type && event.isCloseTarget === true)
  ))
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number'
}

function isPointName(value: unknown): value is PointName {
  return typeof value === 'string' && value in closeTargetPointPositions
}

function isViewport(value: unknown): value is { readonly height: number; readonly width: number } {
  return isRecord(value) && typeof value.height === 'number' && typeof value.width === 'number'
}

function isTransparentColor(value: string) {
  return value === 'transparent' || value === 'rgba(0, 0, 0, 0)'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function electronNativeUiProofFailureMessage({
  output,
  result,
  safeOutput,
}: {
  readonly output: string
  readonly result: ElectronNativeUiProofResultSummary
  readonly safeOutput: (value: string) => string
}) {
  const assertionFailure = typeof result.diagnostics?.assertionFailure === 'string'
    ? safeOutput(result.diagnostics.assertionFailure)
    : null
  return `Electron proof failed${assertionFailure ? `: ${assertionFailure}` : ''}. ${safeOutput(output)}`
}
