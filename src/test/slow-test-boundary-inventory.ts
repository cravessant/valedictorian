export type SlowTestDuration = {
  path: string
  hostedDurationMs: number
}

// Hosted-CI durations observed for the slowest suites; the sequencer uses them as
// baseline shard weights wherever no current override applies.
export const slowTestBoundaryInventory: readonly SlowTestDuration[] = [
  { path: 'src/server/local-server.workspace-routing.test.ts', hostedDurationMs: 52142 },
  { path: 'src/modules/connectors/adapters/persistence/connector.repository.retry-ledger.test.ts', hostedDurationMs: 50926 },
  { path: 'src/db/pglite.baseline.test.ts', hostedDurationMs: 48707 },
  { path: 'src/server/local-secret-resolution.http.test.ts', hostedDurationMs: 33617 },
  { path: 'src/modules/connectors/adapters/connector.runner.refresh-contract.test.ts', hostedDurationMs: 32529 },
  { path: 'src/server/local-server.connector-capabilities.edge-contracts.test.ts', hostedDurationMs: 29926 },
  { path: 'src/modules/source-execution/source-execution-governor.test.ts', hostedDurationMs: 29367 },
  { path: 'src/modules/action-queue/action-queue.repository.test.ts', hostedDurationMs: 27933 },
  { path: 'src/modules/source-execution/source-session-executor.test.ts', hostedDurationMs: 26330 },
  { path: 'src/test/pglite-template.test.ts', hostedDurationMs: 21289 },
  { path: 'src/server/local-server.connector-schedules.management.test.ts', hostedDurationMs: 20582 },
  { path: 'src/modules/workflow-runs/workflow-run.repository.test.ts', hostedDurationMs: 20122 },
  { path: 'src/modules/profile/profile.composition.test.ts', hostedDurationMs: 18468 },
  { path: 'src/server/local-workspaces.pglite-lifecycle.test.ts', hostedDurationMs: 18443 },
  { path: 'src/modules/connectors/adapters/persistence/connector-schedule.repository.pglite.test.ts', hostedDurationMs: 18441 },
  { path: 'src/modules/connectors/adapters/persistence/connector.repository.test.ts', hostedDurationMs: 18389 },
  { path: 'src/modules/policy/policy.repository.test.ts', hostedDurationMs: 17658 },
  { path: 'src/runtime/local-valedictorian-client.run-guards.test.ts', hostedDurationMs: 17192 },
  { path: 'src/settings/ConnectorProviderFilters.test.tsx', hostedDurationMs: 17093 },
  { path: 'src/server/local-server.connector-schedules.dispatch.test.ts', hostedDurationMs: 16427 },
  { path: 'src/modules/connectors/adapters/persistence/connector.repository.bounded-history.test.ts', hostedDurationMs: 14700 },
  { path: 'src/runtime/local-valedictorian-client.connector-settings-edge.test.ts', hostedDurationMs: 14490 },
  { path: 'src/modules/connectors/adapters/connector.runner.auth-catchup.test.ts', hostedDurationMs: 13803 },
  { path: 'src/server/local-server.connector-schedules.delayed-recovery.test.ts', hostedDurationMs: 12749 },
  { path: 'src/runtime/local-valedictorian-client.connector-runs.test.ts', hostedDurationMs: 11480 },
  { path: 'src/modules/secrets/secret.pglite.store.test.ts', hostedDurationMs: 11376 },
  { path: 'src/server/local-server.connector-schedules.reopen.test.ts', hostedDurationMs: 11212 },
  { path: 'src/modules/connectors/adapters/connector.runner.budgets-validate-auth.test.ts', hostedDurationMs: 11025 },
  { path: 'src/runtime/local-valedictorian-client.connector-retirement.test.ts', hostedDurationMs: 10993 },
  { path: 'src/runtime/local-connector-schedule-source.test.ts', hostedDurationMs: 10047 },
]
