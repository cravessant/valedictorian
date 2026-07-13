interface RuntimeIpcMain {
  removeHandler(channel: string): void
}

export const runtimeIpcChannels = [
  'action-queue:list',
  'applications:list',
  'applications:get',
  'applications:create',
  'applications:update',
  'applications:update-status',
  'applications:archive',
  'applications:workflow:update',
  'applications:notes:append',
  'applications:events:list',
  'applications:links:list',
  'applications:links:create',
  'applications:links:update',
  'applications:attempts:list',
  'connectors:list',
  'connectors:create',
  'connectors:update',
  'connectors:inspect',
  'connectors:runs:list',
  'connectors:runs:trigger',
  'connectors:status:reconnect',
  'connectors:status:skip',
  'policy:config:get',
  'policy:config:update',
  'policy:config:reset',
  'policy:evidence:list',
  'policy:evidence:record',
  'policy:evaluate:application',
  'policy:evaluate:sourcing-candidate',
  'policy:evaluate:run-window',
  'profile:get',
  'profile:update',
  'profile:agent-context:get',
  'profile:sensitive:get',
  'profile:sensitive:update',
  'profile:secrets:list',
  'profile:secrets:upsert',
  'profile:secrets:delete',
  'scores:record',
  'settings:get',
  'settings:update',
  'settings:reset',
  'sourcing:findings:list',
  'sourcing:findings:create',
  'sourcing:findings:update',
  'sourcing:findings:decide',
  'sourcing:findings:promote',
  'valedictorian-http:request',
] as const

export function removeRuntimeIpcHandlers(ipcMain: RuntimeIpcMain): void {
  for (const channel of runtimeIpcChannels) {
    ipcMain.removeHandler(channel)
  }
}
