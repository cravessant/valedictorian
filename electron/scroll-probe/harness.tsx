// Renderer harness for the cravessant/valedictorian-app#309 real-layout probe.
//
// It mounts the REAL app dialog primitives (Dialog / DialogContent / ScrollArea)
// with the connector details modal's exact scroll composition, so the Electron
// probe measures the same computed layout the shipped modal produces. Mounting
// the full ConnectorSettingsInstanceCard would drag in the connectors, schedule,
// and profile API contexts plus mutation/workspace state; the composition
// primitive keeps the harness bounded while still exercising the real Radix
// positioning + Tailwind CSS that a raw-DOM/jsdom replica cannot reproduce (a
// jsdom replica is blind to Radix ScrollArea's height:100% viewport not
// clamping, which is exactly the failure mode this probe exists to catch).
//
// ?v=fixed   -> the shipped fix: a single min-h-0 flex-1 overflow-y-auto scroller.
// ?v=control -> the pre-fix composition (a min-h-0 flex-1 ScrollArea) that fails
//               to scroll, so the probe is self-evidently red-first.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

const variant = new URLSearchParams(window.location.search).get('v') === 'control' ? 'control' : 'fixed'
const SECTION_COUNT = 12

function Sections() {
  return (
    <div className="grid gap-0 px-6 pb-6 text-sm">
      <h4 id="provider-filters">Provider filters</h4>
      {Array.from({ length: SECTION_COUNT }, (_, index) => index).map((index) =>
        index < SECTION_COUNT - 1 ? (
          <div key={index} className="border-b border-border" style={{ minHeight: 120 }}>
            Provider filters — section {index + 1}
          </div>
        ) : (
          <div key={index} style={{ minHeight: 120 }}>
            <h4 id="connector-management">Connector management</h4>
          </div>
        ),
      )}
    </div>
  )
}

function Harness() {
  return (
    <Dialog open>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-6 py-5" data-probe="header">
          <DialogTitle>Jobright scroll details</DialogTitle>
          <DialogDescription>Review connector status and configuration.</DialogDescription>
        </DialogHeader>
        {variant === 'control' ? (
          <ScrollArea className="min-h-0 flex-1" data-probe="scroll-surface">
            <Sections />
          </ScrollArea>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto" data-probe="scroll-surface">
            <Sections />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
