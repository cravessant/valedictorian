import type {
  Capture,
  CaptureListInput,
  CaptureListResult,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import type {
  LifecycleAggregateExtensions,
  LifecycleTableConfig,
} from '../lifecycle-table'

export interface CaptureConfig {
  readonly table: LifecycleTableConfig<Capture>
  readonly list: (
    client: Pick<ValedictorianWorkspaceClient, 'captures'>,
    input?: CaptureListInput,
  ) => Promise<CaptureListResult>
}

const table: LifecycleTableConfig<Capture> = {
  caption: 'Captures',
  rowId: (row) => row.id,
  rowLabel: (row) => row.adapter.id,
  empty: {
    title: 'No captures',
    description: 'Captured records will appear here once a connector or manual intake lands them.',
  },
  columns: [
    {
      key: 'adapter',
      header: 'Adapter',
      render: (row) => row.adapter.id,
    },
    {
      key: 'kind',
      header: 'Kind',
      render: (row) => row.adapter.kind,
    },
    {
      key: 'evidence',
      header: 'Evidence',
      render: (row) => String(row.evidence.length),
    },
    {
      key: 'observedAt',
      header: 'Observed at',
      render: (row) => row.observedAt,
    },
    {
      key: 'revision',
      header: 'Revision',
      render: (row) => String(row.revision),
    },
  ],
  actions: [],
}

async function list(
  client: Pick<ValedictorianWorkspaceClient, 'captures'>,
  input?: CaptureListInput,
): Promise<CaptureListResult> {
  return client.captures.list(input ?? { includeRemoved: false })
}

export function createCaptureConfig(
  extensions: LifecycleAggregateExtensions<Capture> = {},
): CaptureConfig {
  return { table: { ...table, extensions }, list }
}

export const captureConfig = createCaptureConfig()
