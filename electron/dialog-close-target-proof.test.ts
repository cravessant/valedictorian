import { describe, expect, it } from 'vitest'

import {
  dialogCloseTargetMeasurementFailures,
  type DialogCloseTargetMeasurement,
} from './dialog-close-target-proof'

function measurement(overrides: Partial<DialogCloseTargetMeasurement> = {}): DialogCloseTargetMeasurement {
  const close = { bottom: 48, height: 32, left: 264, right: 296, top: 16, width: 32 }
  return {
    accessibleName: 'Close',
    close,
    consumer: 'form-modal',
    devicePixelRatio: 2,
    hover: {
      baseBackgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundColor: 'rgb(0, 0, 0)',
      hovered: true,
      nativeEvents: [{ ariaLabel: 'Close', dataSlot: 'dialog-close', isCloseTarget: true, tagName: 'BUTTON', type: 'click' }],
      pointerMoveTarget: { ariaLabel: 'Close', dataSlot: 'dialog-close', isCloseTarget: true, tagName: 'BUTTON', type: 'pointermove' },
      receivedPointer: { x: 280, y: 32 },
    },
    keyboard: {
      baseFocusStyle: {
        borderColor: 'transparent', boxShadow: 'none', outlineColor: 'transparent', outlineStyle: 'none', outlineWidth: '0px',
      },
      closed: true,
      focusStyle: {
        borderColor: 'rgb(1, 2, 3)', boxShadow: 'rgb(1, 2, 3) 0 0 0 3px', outlineColor: 'transparent', outlineStyle: 'none', outlineWidth: '0px',
      },
      focusVisible: true,
      focusedCloseTarget: true,
      visibleFocusTreatment: true,
    },
    points: [
      ['center', 280, 32], ['top-left', 272, 24], ['top-right', 288, 24],
      ['bottom-left', 272, 40], ['bottom-right', 288, 40],
    ].map(([name, x, y]) => ({
      close,
      hit: { ariaLabel: 'Close', dataSlot: 'dialog-close', isCloseTarget: true, tagName: 'BUTTON' },
      name: name as 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
      nativePointerClosed: true,
      nativePointerEvents: ['pointerdown', 'pointerup', 'click'].map((type) => ({
        ariaLabel: 'Close', dataSlot: 'dialog-close', isCloseTarget: true, tagName: 'BUTTON', type,
      })),
      nativeInputPoint: { x: x as number, y: y as number },
      point: { x: x as number, y: y as number },
      viewport: { height: 540, width: 320 },
    })),
    requestedViewport: { height: 540, width: 320 },
    viewport: { height: 540, width: 320 },
    zoomFactor: 1,
    ...overrides,
  }
}

describe('dialog close target proof', () => {
  it('accepts five native pointer hit targets plus keyboard and hover evidence', () => {
    expect(dialogCloseTargetMeasurementFailures(measurement())).toEqual([])
  })

  it('identifies an intercepted lower-half click and missing keyboard focus state', () => {
    const valid = measurement()
    const failures = dialogCloseTargetMeasurementFailures({
      ...valid,
      keyboard: { ...valid.keyboard, focusVisible: false, focusedCloseTarget: false, visibleFocusTreatment: false },
      points: valid.points.map((point) => point.name !== 'bottom-left' ? point : {
        ...point,
        hit: { ...point.hit, isCloseTarget: false, tagName: 'DIV' },
      }),
    })

    expect(failures).toEqual(expect.arrayContaining([
      'Keyboard navigation did not focus the close control.',
      'Keyboard focus did not expose the close control focus-visible state.',
      'Keyboard focus did not expose a computed visible focus treatment.',
      'bottom-left hit test is covered by DIV.',
    ]))
  })

  it('requires each point to dispatch a native close click in its requested viewport', () => {
    const valid = measurement()
    const failures = dialogCloseTargetMeasurementFailures({
      ...valid,
      points: valid.points.map((point) => point.name !== 'bottom-right' ? point : {
        ...point,
        nativePointerClosed: false,
        nativePointerEvents: [],
        viewport: { height: 540, width: 768 },
      }),
    })

    expect(failures).toEqual(expect.arrayContaining([
      'bottom-right pointer activation did not use the requested CSS viewport.',
      'bottom-right native pointer activation did not dispatch pointerdown, pointerup, and click to the close control.',
      'bottom-right native pointer activation did not close the Radix dialog.',
    ]))
  })
})
