// Real-layout regression probe for the Captures table. jsdom has no layout engine,
// so only a real Chromium can prove a long linked-Job label stops at its column
// edge instead of painting across Observed and Next action.
//
// ?v=control renders the pre-fix Capture cells and must FAIL, so a probe that
// stopped detecting the regression is loud rather than silently green.

import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const here = path.dirname(fileURLToPath(import.meta.url))
const harnessIndex = path.resolve(here, '../electron/capture-table-probe/dist/index.html')

const LABEL = 'Software Engineering Intern I, Summer 2027 · BAE Systems, Inc.'
const VIEWPORT_HEIGHT = 720
const DESKTOP_WIDTH = 1440
// The last two are narrower than the table's minimum, so the viewport must scroll.
const VIEWPORT_WIDTHS = [DESKTOP_WIDTH, 1280, 1120, 900, 640]
const MAX_LINKED_JOB_LINES = 2
const MIN_TABLE_WIDTH = 1024
const TOLERANCE_PX = 2

// Rendered text runs are measured with a Range: a clipped child still reports its
// own box, but the text it paints does not.
const MEASURE = `(() => {
  const tol = ${TOLERANCE_PX};
  const container = document.querySelector('[data-slot="table-container"]');
  const table = document.querySelector('[data-slot="table"]');
  if (!container || !table) return { error: 'harness did not render a table' };
  const round = (value) => Math.round(value * 100) / 100;
  const columns = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
  const horizontalSpan = (rectangle) => ({ left: round(rectangle.left), right: round(rectangle.right) });
  const textSpan = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rectangle = range.getBoundingClientRect();
    return rectangle.width > 0 ? horizontalSpan(rectangle) : null;
  };
  const escapes = [];
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  rows.forEach((row, rowIndex) => {
    Array.from(row.children).forEach((cell, cellIndex) => {
      const column = columns[cellIndex] || ('column ' + (cellIndex + 1));
      const box = horizontalSpan(cell.getBoundingClientRect());
      const report = (what, span) => {
        if (!span) return;
        if (span.left < box.left - tol || span.right > box.right + tol) {
          escapes.push({ cell: box, column, row: rowIndex, span, what });
        }
      };
      report('text', textSpan(cell));
      for (const element of cell.querySelectorAll('*')) {
        const rectangle = element.getBoundingClientRect();
        if (rectangle.width > 0) report(element.tagName.toLowerCase(), horizontalSpan(rectangle));
      }
    });
  });
  const linkedJobIndex = columns.indexOf('Linked Job');
  const linkedJobCell = rows
    .map((row) => row.children[linkedJobIndex])
    .find((cell) => cell && cell.textContent.includes(${JSON.stringify(LABEL)})) || null;
  const linkedJobLabel = linkedJobCell
    ? (linkedJobCell.querySelector('span') || linkedJobCell.firstElementChild || linkedJobCell)
    : null;
  const lineHeight = linkedJobLabel
    ? Number.parseFloat(getComputedStyle(linkedJobLabel).lineHeight) || 0
    : 0;
  return {
    accessibleLabel: linkedJobCell ? linkedJobCell.textContent.trim() : '',
    columns,
    escapes,
    linkedJobLines: linkedJobLabel && lineHeight > 0
      ? Math.round(linkedJobLabel.getBoundingClientRect().height / lineHeight)
      : 0,
    tableWidth: round(table.getBoundingClientRect().width),
    viewport: {
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
    },
    windowWidth: window.innerWidth,
  };
})()`

async function measure(win, variant, width) {
  win.setContentSize(width, VIEWPORT_HEIGHT)
  await win.loadFile(harnessIndex, { search: `?v=${variant}` })
  await win.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
  )
  return { ...(await win.webContents.executeJavaScript(MEASURE)), requestedWidth: width }
}

function describeEscape(escape) {
  return `${escape.column} ${escape.what} spans ${escape.span.left}–${escape.span.right} outside its cell ${escape.cell.left}–${escape.cell.right}`
}

function checkFixed(measurement, failures) {
  const at = `at ${measurement.requestedWidth}px`
  if (measurement.error) {
    failures.push(`fixed harness did not render ${at}: ${measurement.error}`)
    return
  }
  if (measurement.windowWidth !== measurement.requestedWidth) {
    failures.push(`renderer viewport ${measurement.windowWidth}px did not match the requested ${measurement.requestedWidth}px; the display server cannot lay this probe out`)
    return
  }
  for (const escape of measurement.escapes) {
    failures.push(`fixed composition ${at}: ${describeEscape(escape)}`)
  }
  if (measurement.accessibleLabel !== LABEL) {
    failures.push(`fixed composition ${at} did not keep the full linked-Job label (got "${measurement.accessibleLabel}")`)
  }
  if (measurement.linkedJobLines < 1 || measurement.linkedJobLines > MAX_LINKED_JOB_LINES) {
    failures.push(`fixed composition ${at} rendered the linked-Job label on ${measurement.linkedJobLines} lines`)
  }
  if (measurement.tableWidth < MIN_TABLE_WIDTH - TOLERANCE_PX) {
    failures.push(`fixed composition ${at} dropped below its minimum width (${measurement.tableWidth} < ${MIN_TABLE_WIDTH})`)
  }
  const scrolls = measurement.viewport.scrollWidth > measurement.viewport.clientWidth + TOLERANCE_PX
  if (measurement.viewport.clientWidth < MIN_TABLE_WIDTH - TOLERANCE_PX && !scrolls) {
    failures.push(`fixed composition ${at} did not offer horizontal scrolling in its labeled viewport`)
  }
}

async function main() {
  if (!existsSync(harnessIndex)) {
    console.error('[#472 capture table probe] ERROR: harness not built at', harnessIndex)
    console.error('[#472 capture table probe] run via: pnpm run smoke:capture-table-containment')
    return 1
  }

  const win = new BrowserWindow({
    width: DESKTOP_WIDTH,
    height: VIEWPORT_HEIGHT,
    show: false,
    // Not offscreen: that auto-sizes the viewport to content and defeats every width assertion.
    useContentSize: true,
    paintWhenInitiallyHidden: true,
  })

  const failures = []
  for (const width of VIEWPORT_WIDTHS) {
    const measurement = await measure(win, 'fixed', width)
    console.log('[#472 capture table probe] fixed:', JSON.stringify(measurement))
    checkFixed(measurement, failures)
  }

  const control = await measure(win, 'control', DESKTOP_WIDTH)
  win.destroy()
  console.log('[#472 capture table probe] control:', JSON.stringify(control))
  if (!control.error && control.escapes.length === 0) {
    failures.push('control (pre-fix Capture cells) kept every value inside its cell; probe is non-discriminating')
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error('[#472 capture table probe] FAIL:', failure)
    return 1
  }
  console.log('[#472 capture table probe] PASS: every Capture value stays inside its cell at', VIEWPORT_WIDTHS.join('/'), 'px; pre-fix control escapes as expected')
  return 0
}

app.disableHardwareAcceleration()
app.whenReady()
  .then(main)
  .then((code) => app.exit(code))
  .catch((err) => {
    console.error('[#472 capture table probe] ERROR:', err && err.stack ? err.stack : err)
    app.exit(1)
  })
