import type {
  Opportunity,
  OpportunityListInput,
  OpportunityListResult,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import type {
  LifecycleAggregateExtensions,
  LifecycleTableConfig,
} from '../lifecycle-table'

export interface OpportunityConfig {
  readonly table: LifecycleTableConfig<Opportunity>
  readonly list: (
    client: Pick<ValedictorianWorkspaceClient, 'opportunities'>,
    input?: OpportunityListInput,
  ) => Promise<OpportunityListResult>
}

const table: LifecycleTableConfig<Opportunity> = {
  caption: 'Opportunities',
  rowId: (row) => row.id,
  rowLabel: (row) => row.id,
  empty: {
    title: 'No opportunities',
    description: 'Promote a job to an opportunity to begin evaluation.',
  },
  columns: [
    {
      key: 'fit',
      header: 'Fit',
      render: (row) => row.fit,
    },
    {
      key: 'rank',
      header: 'Rank',
      render: (row) => (row.rank === null ? '—' : String(row.rank)),
    },
    {
      key: 'cutoff',
      header: 'Cutoff',
      render: (row) => row.cutoff,
    },
    {
      key: 'disposition',
      header: 'Disposition',
      render: (row) => row.disposition,
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
  client: Pick<ValedictorianWorkspaceClient, 'opportunities'>,
  input?: OpportunityListInput,
): Promise<OpportunityListResult> {
  return client.opportunities.list(input ?? { includeRemoved: false })
}

export function createOpportunityConfig(
  extensions: LifecycleAggregateExtensions<Opportunity> = {},
): OpportunityConfig {
  return { table: { ...table, extensions }, list }
}

export const opportunityConfig = createOpportunityConfig()
