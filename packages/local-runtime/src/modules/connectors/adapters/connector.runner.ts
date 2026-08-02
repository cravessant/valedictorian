import type { createSourceExecutionGovernor } from '../../source-execution/public.js'
import { createSourceSessionExecutor } from '../../source-execution/public.js'
import { createConnectorRunnerCore, type CreateConnectorRunnerCoreOptions } from '../core/connector.runner.js'
import type { ConnectorRunner } from '../ports/connector.runner-contracts.js'

export type CreateConnectorRunnerOptions =
  Omit<CreateConnectorRunnerCoreOptions, 'sessionExecutor' | 'sourceExecutionGovernor'>
  & { sourceExecutionGovernor?: ReturnType<typeof createSourceExecutionGovernor> }

export function createConnectorRunner(
  options: CreateConnectorRunnerOptions,
): ConnectorRunner {
  const now = options.now ?? (() => new Date())
  return createConnectorRunnerCore({
    ...options,
    now,
    sessionExecutor: options.sourceExecutionGovernor
      ? createSourceSessionExecutor({ governor: options.sourceExecutionGovernor, now })
      : null,
  })
}
