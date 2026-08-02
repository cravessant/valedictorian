import path from 'node:path'

export interface ElectronPgliteMigrationsOptions {
  appPath: string
  isPackaged: boolean
  resourcesPath: string
}

/**
 * Packaged builds copy migrations beside app.asar. Development bundles keep
 * them at their package-owned source location, independent of cwd and the
 * flattened dist-electron module directory.
 */
export function resolveElectronPgliteMigrationsFolder({
  appPath,
  isPackaged,
  resourcesPath,
}: ElectronPgliteMigrationsOptions) {
  return isPackaged
    ? path.join(resourcesPath, 'drizzle')
    : path.join(appPath, 'packages/local-runtime/drizzle')
}
