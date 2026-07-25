import { describe, expect, it } from 'vitest'

import {
  electronNativeUiProofFailureMessage,
  hasDialogCloseTargetEvidence,
} from './electron-native-ui-proof-result'

const closeTargetPointNames = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

function closeTargetMeasurement(consumer: 'capture-completion' | 'form-modal', width: number) {
  const viewport = { height: 540, width }
  const close = { bottom: 48, height: 32, left: 0, right: 32, top: 16, width: 32 }
  return {
    close,
    consumer,
    hover: {
      backgroundColor: 'rgb(10, 20, 30)', baseBackgroundColor: 'transparent', hovered: true,
      pointerMoveTarget: { isCloseTarget: true }, receivedPointer: { x: 16, y: 32 },
    },
    keyboard: {
      baseFocusStyle: { boxShadow: 'none' }, closed: true,
      focusStyle: { boxShadow: 'rgb(10, 20, 30) 0 0 0 3px' },
      focusVisible: true, focusedCloseTarget: true, visibleFocusTreatment: true,
    },
    points: closeTargetPointNames.map((name) => {
      const point = closeTargetPoint(close, name)
      return {
        close, hit: { isCloseTarget: true }, name,
        nativeInputPoint: point, nativePointerClosed: true,
        nativePointerEvents: ['pointerdown', 'pointerup', 'click'].map((type) => ({ isCloseTarget: true, type })),
        point, viewport,
      }
    }),
    requestedViewport: viewport,
    viewport,
  }
}

function closeTargetPoint(
  close: { readonly height: number; readonly left: number; readonly top: number; readonly width: number },
  name: typeof closeTargetPointNames[number],
) {
  const positions = {
    center: [0.5, 0.5],
    'top-left': [0.25, 0.25],
    'top-right': [0.75, 0.25],
    'bottom-left': [0.25, 0.75],
    'bottom-right': [0.75, 0.75],
  } as const
  const [horizontal, vertical] = positions[name]
  return {
    x: Math.round(close.left + close.width * horizontal),
    y: Math.round(close.top + close.height * vertical),
  }
}

function closeTargetEvidence() {
  return [
    ...[320, 768, 1440].map((width) => closeTargetMeasurement('capture-completion', width)),
    ...[320, 768, 1440].map((width) => closeTargetMeasurement('form-modal', width)),
  ]
}

describe('Electron native UI proof result', () => {
  it('places the persisted assertion failure before truncated child output', () => {
    expect(electronNativeUiProofFailureMessage({
      output: 'very long child output',
      result: { diagnostics: { assertionFailure: 'form-modal at 768px: close is clipped' } },
      safeOutput: (value) => `[safe] ${value}`,
    })).toBe('Electron proof failed: [safe] form-modal at 768px: close is clipped. [safe] very long child output')
  })

  it('requires independently captured native input evidence for all six consumer viewports', () => {
    const evidence = closeTargetEvidence()

    expect(hasDialogCloseTargetEvidence(evidence)).toBe(true)
    evidence[0].points[3].nativePointerClosed = false
    expect(hasDialogCloseTargetEvidence(evidence)).toBe(false)
  })

  it('rejects duplicated quadrant geometry and an out-of-bounds hover pointer', () => {
    const duplicatedGeometry = closeTargetEvidence()
    const center = duplicatedGeometry[0].points[0].point
    duplicatedGeometry[0].points[1] = {
      ...duplicatedGeometry[0].points[1],
      nativeInputPoint: { ...center },
      point: { ...center },
    }
    expect(hasDialogCloseTargetEvidence(duplicatedGeometry)).toBe(false)

    const outOfBoundsHover = closeTargetEvidence()
    outOfBoundsHover[0].hover.receivedPointer = { x: 33, y: 32 }
    expect(hasDialogCloseTargetEvidence(outOfBoundsHover)).toBe(false)
  })
})
