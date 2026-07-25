import { describe, expect, it } from 'vitest'

import {
  layoutMeasurementFailures,
  type CaptureCompletionLayoutMeasurement,
} from './capture-completion-layout-proof'

const shellRectangle = { bottom: 520, height: 500, left: 0, right: 320, top: 20, width: 320 }
const bodyRectangle = { bottom: 440, height: 340, left: 20, right: 300, top: 100, width: 280 }
const fixedRectangle = { bottom: 80, height: 40, left: 20, right: 300, top: 40, width: 280 }
const footerRectangle = { bottom: 500, height: 56, left: 20, right: 300, top: 444, width: 280 }
const provenanceRectangle = { bottom: 140, height: 32, left: 20, right: 300, top: 108, width: 280 }
const sourceRectangle = { bottom: 420, height: 260, left: 20, right: 150, top: 160, width: 130 }
const destinationRectangle = { bottom: 420, height: 260, left: 170, right: 300, top: 160, width: 130 }
const rawEvidenceRectangle = { bottom: 300, height: 80, left: 28, right: 142, top: 220, width: 114 }

function bounded(rectangle: typeof bodyRectangle, surface: { readonly clientHeight: number; readonly clientWidth: number; readonly scrollHeight: number; readonly scrollTop: number; readonly scrollWidth: number }) {
  return { ...surface, rectangle }
}

function measurement(overrides: Partial<CaptureCompletionLayoutMeasurement> = {}): CaptureCompletionLayoutMeasurement {
  const body = bounded(bodyRectangle, { clientHeight: 320, clientWidth: 280, scrollHeight: 640, scrollTop: 0, scrollWidth: 280 })
  const content = {
    owned: [
      { name: 'destination control 1', owner: 'destination' as const, rectangle: destinationRectangle },
      { name: 'selected Company status', owner: 'destination' as const, rectangle: destinationRectangle },
      { name: 'validation status', owner: 'destination' as const, rectangle: destinationRectangle },
    ],
    destination: bounded(destinationRectangle, { clientHeight: 260, clientWidth: 130, scrollHeight: 260, scrollTop: 0, scrollWidth: 130 }),
    provenance: bounded(provenanceRectangle, { clientHeight: 32, clientWidth: 280, scrollHeight: 32, scrollTop: 0, scrollWidth: 280 }),
    rawEvidence: {
      ...bounded(rawEvidenceRectangle, { clientHeight: 80, clientWidth: 114, scrollHeight: 80, scrollTop: 0, scrollWidth: 480 }),
      overflowX: 'auto',
    },
    source: bounded(sourceRectangle, { clientHeight: 260, clientWidth: 130, scrollHeight: 260, scrollTop: 0, scrollWidth: 130 }),
  }
  const before = {
    body,
    close: fixedRectangle,
    content,
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

  it('rejects source escapes, sibling overlap, and globally suppressed local machine-text scrolling', () => {
    const valid = measurement()
    const failures = layoutMeasurementFailures({
      ...valid,
      before: {
        ...valid.before,
        content: {
          ...valid.before.content,
          owned: [{
            name: 'validation status',
            owner: 'destination',
            rectangle: { ...destinationRectangle, right: 324 },
          }],
          destination: {
            ...valid.before.content.destination,
            rectangle: { ...valid.before.content.destination.rectangle, left: 120 },
          },
          rawEvidence: {
            ...valid.before.content.rawEvidence,
            overflowX: 'hidden',
            rectangle: { ...valid.before.content.rawEvidence.rectangle, right: 156 },
          },
          source: {
            ...valid.before.content.source,
            scrollWidth: 136,
          },
        },
      },
    })

    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('source evidence horizontally overflows before scrolling'),
      'Raw evidence escapes its source panel before scrolling.',
      'Raw evidence does not expose intentional local horizontal scrolling before scrolling.',
      'validation status escapes its destination region before scrolling.',
      'Source evidence overlaps the destination form before scrolling.',
    ]))
  })

  it('rejects a destination-owned child displaced into the source region', () => {
    const valid = measurement()
    const failures = layoutMeasurementFailures({
      ...valid,
      before: {
        ...valid.before,
        content: {
          ...valid.before.content,
          owned: [{
            name: 'Role title field',
            owner: 'destination',
            rectangle: sourceRectangle,
          }],
        },
      },
    })

    expect(failures).toContain('Role title field escapes its destination region before scrolling.')
  })
})
