import { useMemo, type ReactElement } from 'react'
import type { Capture, Job, Opportunity } from 'sparxie'

import {
  LifecycleTable,
  type LifecycleLoadState,
  type LifecycleTableConfig,
} from './lifecycle-table'

interface CaptureProcessingRow {
  readonly capture: Capture
  readonly job: Job | null
  readonly opportunity: Opportunity | null
}

export function CaptureProcessingMode({
  captures,
  jobs,
  opportunities,
  state,
  onRefresh,
  toolbar,
}: {
  readonly captures: ReadonlyArray<Capture> | null
  readonly jobs: ReadonlyArray<Job> | null
  readonly opportunities: ReadonlyArray<Opportunity> | null
  readonly state: LifecycleLoadState
  readonly onRefresh: () => Promise<void> | void
  readonly toolbar?: ReactElement
}): ReactElement {
  const rows = useMemo(() => captures?.map((capture) => {
    const job = jobs?.find((candidate) =>
      candidate.removedAt === null
      && candidate.captureEvidenceReferences.some((reference) => reference.captureId === capture.id)) ?? null
    const opportunity = job === null
      ? null
      : opportunities?.find((candidate) =>
        candidate.removedAt === null && candidate.jobId === job.id) ?? null
    return { capture, job, opportunity }
  }) ?? null, [captures, jobs, opportunities])

  return (
    <LifecycleTable
      config={processingTable}
      data={rows}
      state={state}
      onRefresh={onRefresh}
      toolbar={toolbar}
    />
  )
}

const processingTable: LifecycleTableConfig<CaptureProcessingRow> = {
  caption: 'Capture processing',
  rowId: (row) => row.capture.id,
  rowLabel: (row) => row.capture.adapter.id,
  empty: {
    title: 'No Capture processing yet',
    description: 'Capture-to-Job processing details will appear after intake.',
  },
  columns: [
    {
      key: 'capture',
      header: 'Capture',
      render: (row) => row.capture.adapter.id,
    },
    {
      key: 'capture-to-job',
      header: 'Capture → Job',
      render: (row) => {
        if (row.capture.removedAt) return 'Capture removed; processing status unavailable'
        return row.job === null
          ? 'No linked Job; processing status unavailable'
          : `Linked to ${row.job.id}; processing status unavailable`
      },
    },
    {
      key: 'fact-normalization',
      header: 'Job fact normalization',
      render: () => 'Technical status unavailable',
    },
    {
      key: 'admission',
      header: 'Opportunity admission',
      render: (row) => row.job === null
        ? 'No linked Job'
        : row.opportunity === null ? 'Not admitted' : `Admitted as ${row.opportunity.id}`,
    },
    {
      key: 'projection',
      header: 'Opportunity projection',
      render: () => 'Technical status unavailable',
    },
  ],
  actions: [],
}
