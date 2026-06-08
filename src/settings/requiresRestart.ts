import type { AppSettingsPatch } from './app-settings'

export function requiresRestart(patch: AppSettingsPatch) {
  return (
    'apiToken' in patch ||
    'localApiHost' in patch ||
    'localApiPort' in patch ||
    'remoteApiUrl' in patch ||
    'runtimeMode' in patch
  )
}
