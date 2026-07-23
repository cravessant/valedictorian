import type {
  Job,
  JobListInput,
  JobListResult,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import type {
  LifecycleAggregateExtensions,
  LifecycleTableConfig,
} from '../lifecycle-table'

export interface JobConfig {
  readonly table: LifecycleTableConfig<Job>
  readonly list: (
    client: Pick<ValedictorianWorkspaceClient, 'jobs'>,
    input?: JobListInput,
  ) => Promise<JobListResult>
}

const table: LifecycleTableConfig<Job> = {
  caption: 'Jobs',
  rowId: (row) => row.id,
  rowLabel: (row) => `${row.facts.companyName} — ${row.facts.roleTitle}`,
  empty: {
    title: 'No jobs',
    description: 'Promote a capture or import a job to start the lifecycle chain.',
  },
  columns: [
    {
      key: 'company',
      header: 'Company',
      render: (row) => row.facts.companyName,
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => row.facts.roleTitle,
    },
    {
      key: 'source',
      header: 'Source',
      render: (row) => row.facts.sourceName,
    },
    {
      key: 'availability',
      header: 'Availability',
      render: (row) => row.availability.state,
    },
    {
      key: 'identities',
      header: 'Identities',
      render: (row) => String(row.externalIdentities.length),
    },
  ],
  actions: [],
}

async function list(
  client: Pick<ValedictorianWorkspaceClient, 'jobs'>,
  input?: JobListInput,
): Promise<JobListResult> {
  return client.jobs.list(input ?? { includeRemoved: false })
}

export function createJobConfig(
  extensions: LifecycleAggregateExtensions<Job> = {},
): JobConfig {
  return { table: { ...table, extensions }, list }
}

export const jobConfig = createJobConfig()
