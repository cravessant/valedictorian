interface RuntimeIpcMain {
  removeHandler(channel: string): void
}

export const runtimeIpcChannels = [
  'connectors:list',
  'connectors:create',
  'connectors:update',
  'connectors:remove',
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
  'policy:evaluate:opportunity',
  'policy:evaluate:run-window',
  'profile:get',
  'profile:update',
  'profile:agent-context:get',
  'profile:identity:status',
  'profile:identity:set',
  'profile:secrets:list',
  'profile:secrets:upsert',
  'profile:secrets:delete',
  'scores:record',
  'settings:get',
  'settings:update',
  'settings:reset',
  'valedictorian-http:request',
  'valedictorian-http:cancel',
] as const

export function removeRuntimeIpcHandlers(ipcMain: RuntimeIpcMain): void {
  for (const channel of runtimeIpcChannels) {
    ipcMain.removeHandler(channel)
  }
}
