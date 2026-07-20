// Real-layout regression probe for cravessant/valedictorian-app#309.
//
// jsdom has no layout engine (scrollHeight/clientHeight are always 0), so the
// jsdom structural test can only pin the *classes* the connector details modal
// uses. This probe boots a real Chromium layout engine (Electron BrowserWindow)
// at a constrained viewport height and loads a Vite-built harness that mounts the
// REAL app dialog primitives (Dialog / DialogContent / ScrollArea) with the
// modal's exact scroll composition. It proves the shipped composition produces a
// bounded scroll viewport (scrollHeight > clientHeight) whose final "Connector
// management" section becomes reachable by scrolling, while the header stays
// visible.
//
// Red-first / discriminating: the harness also renders the pre-fix composition
// (a min-h-0 flex-1 Radix ScrollArea) as a control. That composition does NOT
// clamp under the dialog's indefinite max-height — its height:100% viewport grows
// to content height and is clipped instead of scrolling — so the probe requires
// the control to FAIL. If the control ever passed, the probe would be blind to
// the regression and fails loudly. (This control is the exact composition an
// earlier attempt at the fix shipped; only a real engine, not jsdom, catches it.)

import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const here = path.dirname(fileURLToPath(import.meta.url))
const harnessIndex = path.resolve(here, '../electron/scroll-probe/dist/index.html')

// Constrained viewport: small enough that the modal body overflows so the scroll
// path is exercised (AC: "constrained viewport heights").
const VIEWPORT_WIDTH = 900
const VIEWPORT_HEIGHT = 520
const TOLERANCE_PX = 2

// Runs in the renderer after mount. Scrolls the surface to the bottom and reports
// whether it is a bounded scroll viewport, whether the final marker is inside the
// dialog's (clipped) visible box afterwards, and whether the header stays visible.
const MEASURE = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  // Fixed variant scrolls on the div[data-probe]; the ScrollArea control scrolls
  // on its inner viewport.
  const surface = document.querySelector('[data-slot="scroll-area-viewport"]')
    || document.querySelector('[data-probe="scroll-surface"]');
  const header = document.querySelector('[data-probe="header"]');
  const marker = document.getElementById('connector-management');
  if (!dialog || !surface || !header || !marker) {
    return { error: 'missing nodes', dialog: !!dialog, surface: !!surface, header: !!header, marker: !!marker };
  }
  surface.scrollTop = surface.scrollHeight;
  const tol = ${TOLERANCE_PX};
  const d = dialog.getBoundingClientRect();
  const m = marker.getBoundingClientRect();
  const h = header.getBoundingClientRect();
  return {
    innerHeight: window.innerHeight,
    dialogHeight: Math.round(d.height),
    scrollHeight: surface.scrollHeight,
    clientHeight: surface.clientHeight,
    overflows: surface.scrollHeight > surface.clientHeight + tol,
    markerReachable: m.top >= d.top - tol && m.bottom <= d.bottom + tol,
    headerVisible: h.height > 0 && h.top >= d.top - tol && h.bottom <= d.bottom + tol,
  };
})()`

async function measure(win, variant) {
  await win.loadFile(harnessIndex, { search: `?v=${variant}` })
  // Let React mount and Radix run its ScrollArea layout effects.
  await win.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
  )
  return win.webContents.executeJavaScript(MEASURE)
}

async function main() {
  if (!existsSync(harnessIndex)) {
    console.error('[#309 scroll probe] ERROR: harness not built at', harnessIndex)
    console.error('[#309 scroll probe] run via: pnpm run smoke:connector-modal-scroll (builds the harness + provisions Electron)')
    return 1
  }

  const win = new BrowserWindow({
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    show: false,
    // A normal hidden window, not offscreen: offscreen rendering auto-sizes the
    // viewport to content height, defeating the 100vh clamp under test. macOS CI
    // runners have a window server, so a hidden window still lays out at height.
    useContentSize: true,
    paintWhenInitiallyHidden: true,
  })

  const fixed = await measure(win, 'fixed')
  const control = await measure(win, 'control')
  win.destroy()

  console.log('[#309 scroll probe] viewport height:', fixed.innerHeight, 'px (constrained)')
  console.log('[#309 scroll probe] fixed  :', JSON.stringify(fixed))
  console.log('[#309 scroll probe] control:', JSON.stringify(control))

  const failures = []
  if (fixed.error) failures.push(`fixed harness did not render: ${JSON.stringify(fixed)}`)
  if (!fixed.error) {
    if (!fixed.overflows) {
      failures.push(`fixed composition is not a bounded scroll viewport (scrollHeight=${fixed.scrollHeight} clientHeight=${fixed.clientHeight})`)
    }
    if (!fixed.markerReachable) {
      failures.push('fixed composition cannot scroll "Connector management" into the dialog viewport')
    }
    if (!fixed.headerVisible) {
      failures.push('fixed composition does not keep the dialog header visible')
    }
  }

  // The pre-fix control must fail, proving the probe is red-first and can detect
  // the regression. A rendering error also counts as "did not pass".
  const controlPasses = !control.error && control.overflows && control.markerReachable
  if (controlPasses) {
    failures.push('control (pre-fix ScrollArea) composition unexpectedly scrolled; probe is non-discriminating')
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error('[#309 scroll probe] FAIL:', failure)
    return 1
  }
  console.log('[#309 scroll probe] PASS: fixed composition scrolls to the final section with the header visible; pre-fix control is clipped as expected')
  return 0
}

app.disableHardwareAcceleration()
app.whenReady()
  .then(main)
  .then((code) => app.exit(code))
  .catch((err) => {
    console.error('[#309 scroll probe] ERROR:', err && err.stack ? err.stack : err)
    app.exit(1)
  })
