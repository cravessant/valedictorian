import { describe, expect, it } from 'vitest'

import {
  layoutMeasurementFailures,
  type CaptureCompletionLayoutMeasurement,
} from './capture-completion-layout-proof'

const shellRectangle = { bottom: 520, height: 500, left: 0, right: 320, top: 20, width: 320 }
const fixedRectangle = { bottom: 80, height: 40, left: 20, right: 300, top: 40, width: 280 }
const footerRectangle = { bottom: 500, height: 56, left: 20, right: 300, top: 444, width: 280 }

function measurement(overrides: Partial<CaptureCompletionLayoutMeasurement> = {}): CaptureCompletionLayoutMeasurement {
  const before = {
    body: { clientHeight: 320, clientWidth: 280, scrollHeight: 640, scrollTop: 0, scrollWidth: 280 },
    close: fixedRectangle,
    footer: footerRectangle,
    header: fixedRectangle,
    shell: { clientHeight: 500, clientWidth: 320, scrollHeight: 500, scrollTop: 0, scrollWidth: 320, rectangle: shellRectangle },
  }
  return {
    after: { ...before, body: { ...before.body, scrollTop: 320 } },
    before,
    devicePixelRatio: 2,
    requestedViewport: { height: 540, width: 320 },
    viewport: { height: 540, width: 320 },
    ...overrides,
  }
}

describe('Capture completion layout proof', () => {
  it('accepts bounded vertical scrolling with anchored shell controls', () => {
    expect(layoutMeasurementFailures(measurement())).toEqual([])
  })

  it('rejects shell overflow, a mismatched viewport, and moved fixed controls', () => {
    const valid = measurement()
    const failures = layoutMeasurementFailures({
      ...valid,
      after: {
        ...valid.after,
        close: { ...valid.after.close, top: 84 },
        shell: { ...valid.after.shell, scrollWidth: 324 },
      },
      viewport: { height: 540, width: 321 },
    })

    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('did not match requested CSS viewport'),
      expect.stringContaining('Shell horizontally overflows after scrolling'),
      'close control moved while the body scrolled.',
    ]))
  })

  it('rejects body horizontal overflow before and after scrolling', () => {
    const valid = measurement()
    const failures = layoutMeasurementFailures({
      ...valid,
      after: { ...valid.after, body: { ...valid.after.body, scrollWidth: 284 } },
      before: { ...valid.before, body: { ...valid.before.body, scrollWidth: 283 } },
    })

    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('Body horizontally overflows before scrolling'),
      expect.stringContaining('Body horizontally overflows after scrolling'),
    ]))
  })

  it('rejects a vertically overflowing or displaced shell before and after body scrolling', () => {
    const valid = measurement()
    const failures = layoutMeasurementFailures({
      ...valid,
      after: {
        ...valid.after,
        shell: { ...valid.after.shell, scrollHeight: 504, scrollTop: 14 },
      },
      before: {
        ...valid.before,
        shell: { ...valid.before.shell, scrollHeight: 503, scrollTop: 7 },
      },
    })

    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('Shell vertically overflows before scrolling'),
      expect.stringContaining('Shell vertically overflows after scrolling'),
      expect.stringContaining('Shell is vertically displaced before body scrolling'),
      expect.stringContaining('Shell is vertically displaced after body scrolling'),
      'Shell moved while the body scrolled.',
    ]))
  })
})
