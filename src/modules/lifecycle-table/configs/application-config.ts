import type {
  Application,
  LifecycleApplicationListInput,
  LifecycleApplicationListResult,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import type {
  LifecycleAggregateExtensions,
  LifecycleTableConfig,
} from '../lifecycle-table'

export interface ApplicationConfig {
  readonly table: LifecycleTableConfig<Application>
  readonly list: (
    client: Pick<ValedictorianWorkspaceClient, 'applications'>,
    input?: LifecycleApplicationListInput,
  ) => Promise<LifecycleApplicationListResult>
}

const table: LifecycleTableConfig<Application> = {
  caption: 'Applications',
  rowId: (row) => row.id,
  rowLabel: (row) => `${row.companyName} — ${row.snapshot.roleTitle}`,
  empty: {
    title: 'No applications',
    description: 'Promote an opportunity to start a pursuit.',
  },
  columns: [
    {
      key: 'company',
      header: 'Company',
      render: (row) => row.companyName,
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => row.snapshot.roleTitle,
    },
    {
      key: 'source',
      header: 'Source',
      render: (row) => row.sourceName,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => row.status,
    },
    {
      key: 'links',
      header: 'Links',
      render: (row) => String(row.links.length),
    },
  ],
  actions: [],
}

async function list(
  client: Pick<ValedictorianWorkspaceClient, 'applications'>,
  input?: LifecycleApplicationListInput,
): Promise<LifecycleApplicationListResult> {
  return client.applications.list(input ?? { includeRemoved: false })
}

export function createApplicationConfig(
  extensions: LifecycleAggregateExtensions<Application> = {},
): ApplicationConfig {
  return { table: { ...table, extensions }, list }
}

export const applicationConfig = createApplicationConfig()
