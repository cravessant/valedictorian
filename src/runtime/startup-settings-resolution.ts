import type { AppSettings } from '../settings/app-settings'
import { readNonEmptyEnvironmentApiToken } from './api-token-resolution'

export type ResolveStartupSettingsAndApiTokenOptions = {
  env?: NodeJS.Dict<string | undefined>
  /**
   * Read ordinary non-secret app settings from app.json without constructing
   * or consulting a saved AppSecretStore.
   */
  readPublicSettings: () => Promise<AppSettings>
  /**
   * Secret-backed startup path: public settings plus privileged saved token.
   * May migrate/read/check saved secrets.
   */
  readSecretBackedSettingsAndToken: () => Promise<{
    settings: AppSettings
    apiToken: string | null
  }>
}

/**
 * Compose public startup settings with the process API token.
 * A nonempty VALEDICTORIAN_API_TOKEN bypasses all saved-secret access.
 */
export async function resolveStartupSettingsAndApiToken({
  env = process.env,
  readPublicSettings,
  readSecretBackedSettingsAndToken,
}: ResolveStartupSettingsAndApiTokenOptions): Promise<{
  settings: AppSettings
  apiToken: string | undefined
}> {
  const environmentToken = readNonEmptyEnvironmentApiToken(env)
  if (environmentToken !== undefined) {
    const settings = await readPublicSettings()
    return {
      settings,
      apiToken: environmentToken,
    }
  }

  const { settings, apiToken } = await readSecretBackedSettingsAndToken()
  return {
    settings,
    apiToken: apiToken ?? undefined,
  }
}
