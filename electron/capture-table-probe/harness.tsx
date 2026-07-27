// Mounts the REAL shared LifecycleTable and Capture configuration so the probe
// measures shipped geometry. ?v=control renders the pre-fix cells instead.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { CaptureListPresentation } from '@sparxie/sdk'
import './harness.css'
import { Button } from '@/components/ui/button'
import { LifecycleTable, type LifecycleTableConfig } from '@/modules/lifecycle-table/lifecycle-table'
import { createCaptureConfig } from '@/modules/lifecycle-table/configs/capture-config'
import { captureContainmentRows } from '@/modules/lifecycle-table/capture-containment.fixture'

const variant = new URLSearchParams(window.location.search).get('v') === 'control' ? 'control' : 'fixed'

// Every callback the workbench wires, so the row-actions column is in the measured budget.
const fixedConfig = createCaptureConfig({
  onComplete: () => {},
  onOpenJob: () => {},
  onRemove: () => {},
  onRestore: () => {},
  onViewHistory: () => {},
  onViewResolution: () => {},
}).table

function observed(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value))
}

const controlConfig: LifecycleTableConfig<CaptureListPresentation> = {
  caption: 'Captures',
  rowId: (row) => row.captureId,
  rowLabel: (row) => row.lead.fallbackLabel,
  empty: { title: 'No captures', description: 'Captured leads will appear here after intake.' },
  // One action is all the shared table needs to allocate the same row-actions column.
  actions: [{ key: 'remove-capture', label: 'Remove Capture', onActivate: () => {} }],
  columns: [
    {
      key: 'lead',
      header: 'Lead',
      render: (row) => (
        <div className="min-w-44">
          <p className="font-medium text-foreground">{row.lead.roleTitle ?? row.lead.fallbackLabel}</p>
          {row.lead.companyName ? (
            <p className="text-xs text-muted-foreground">{row.lead.companyName}</p>
          ) : null}
        </div>
      ),
    },
    { key: 'source', header: 'Source', render: (row) => row.source.displayName },
    {
      key: 'destination',
      header: 'Destination',
      render: (row) => row.destination.displayHost ?? 'Needs attention',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (row.processingSummary === 'promoted' ? 'Job created' : 'Needs information'),
    },
    {
      key: 'linked-job',
      header: 'Linked Job',
      render: (row) => (row.linkedJob ? (
        <Button type="button" variant="link" className="h-auto max-w-56 justify-start p-0 text-left">
          {`${row.linkedJob.roleTitle} · ${row.linkedJob.companyName}`}
        </Button>
      ) : '—'),
    },
    { key: 'observedAt', header: 'Observed', render: (row) => observed(row.observedAt) },
    {
      key: 'next-action',
      header: 'Next action',
      render: (row) => (
        <Button type="button" variant="link" className="h-auto p-0">
          {row.linkedJob ? 'View Job' : 'Complete Job information'}
        </Button>
      ),
    },
  ],
}

function Harness() {
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <LifecycleTable
        config={variant === 'control' ? controlConfig : fixedConfig}
        data={captureContainmentRows}
        state={{ status: 'loaded' }}
      />
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
