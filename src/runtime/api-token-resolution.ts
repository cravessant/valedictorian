export type ResolveStartupApiTokenOptions = {
  env?: NodeJS.Dict<string | undefined>
  resolveSavedApiToken: () => Promise<string | null>
}

/**
 * Resolve the privileged API token for Electron/main startup.
 * A nonempty process environment token bypasses saved secure-storage access entirely.
 */
export async function resolveStartupApiToken({
  env = process.env,
  resolveSavedApiToken,
}: ResolveStartupApiTokenOptions): Promise<string | undefined> {
  const environmentToken = readNonEmptyEnvironmentApiToken(env)
  if (environmentToken !== undefined) {
    return environmentToken
  }

  const savedApiToken = await resolveSavedApiToken()
  return savedApiToken ?? undefined
}

export function readNonEmptyEnvironmentApiToken(
  env: NodeJS.Dict<string | undefined> = process.env,
): string | undefined {
  const raw = env.VALEDICTORIAN_API_TOKEN
  if (typeof raw !== 'string') {
    return undefined
  }
  // Empty / whitespace-only is absent; otherwise preserve exact bytes (including inner spaces).
  if (raw.trim().length === 0) {
    return undefined
  }
  return raw
}
