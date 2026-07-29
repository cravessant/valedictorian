import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    pnpm?: Record<string, unknown>
    scripts?: Record<string, string>
  }
}

function readLockfile() {
  return fs.readFileSync(path.resolve('pnpm-lock.yaml'), 'utf8')
}

function readWorkspaceConfig() {
  return fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
}

function resolvedVersions(lockfile: string, packageName: string) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const packages = lockfile.match(/\npackages:\n([\s\S]*?)(?:\nsnapshots:\n|$)/)?.[1] ?? ''
  return [...packages.matchAll(new RegExp(`^ {2}'?${escaped}@([^'":(]+)'?[:(]`, 'gm'))]
    .map((match) => match[1])
    .sort()
}

function directDependencyVersion(lockfile: string, packageName: string) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return lockfile
    .match(new RegExp(`^ {6}'?${escaped}'?:\\n {8}specifier: .*\\n {8}version: ([^\\s(]+)`, 'm'))
    ?.[1]
}

describe('packaging dependency contract', () => {
  it('pins the stable Electron packaging stack the app owns directly', () => {
    const packageJson = readPackageJson()

    expect(packageJson.devDependencies?.['@electron/asar']).toBe('4.2.1')
    expect(packageJson.devDependencies?.['electron-builder']).toBe('^26.15.7')
    expect(packageJson.dependencies?.['electron-updater']).toBe('^6.8.9')
  })

  it('resolves no prerelease packaging or updater release', () => {
    const lockfile = readLockfile()
    const prerelease = /-(?:alpha|beta|rc|next|canary)/

    for (const packageName of ['electron-builder', 'app-builder-lib', 'electron-updater']) {
      const versions = resolvedVersions(lockfile, packageName)
      expect(versions.length).toBeGreaterThan(0)
      expect(versions.filter((version) => prerelease.test(version))).toEqual([])
    }
    expect(resolvedVersions(lockfile, 'electron-builder').every((v) => v.startsWith('26.'))).toBe(true)
  })

  it('keeps the only app-owned ASAR path on the 4.x line', () => {
    const lockfile = readLockfile()

    expect(directDependencyVersion(lockfile, '@electron/asar')).toBe('4.2.1')
    // 3.4.1 is allowed only because stable Electron Builder v26 pins it internally.
    expect(resolvedVersions(lockfile, '@electron/asar')).toEqual(['3.4.1', '4.2.1'])
  })

  it('carries no vulnerable brace-expansion or form-data copy that a patch exists for', () => {
    const lockfile = readLockfile()

    expect(resolvedVersions(lockfile, 'form-data').filter((v) => v.startsWith('4.') && v < '4.0.6'))
      .toEqual([])
    expect(resolvedVersions(lockfile, 'brace-expansion')).toEqual(['1.1.16', '2.1.3', '5.0.8'])
  })

  it('gates high-severity advisories through the lint quality entrypoint', () => {
    const packageJson = readPackageJson()

    expect(packageJson.scripts?.['audit:high']).toContain('pnpm audit --audit-level high')
    expect(packageJson.scripts?.lint).toContain('pnpm run audit:high')
  })

  it('admits exactly one advisory ignore and no dependency overrides', () => {
    const packageJson = readPackageJson()
    const workspaceConfig = readWorkspaceConfig()
    const ignored = [...workspaceConfig.matchAll(/^ {4}- (GHSA-[\w-]+)$/gm)].map((m) => m[1])

    expect(ignored).toEqual(['GHSA-mh99-v99m-4gvg'])
    expect(workspaceConfig).not.toContain('ignoreCves')
    expect(workspaceConfig).not.toContain('overrides')
    expect(packageJson.pnpm).toBeUndefined()
  })

  // The ignore above is only defensible because every copy it matches carries
  // the fix — 2.1.3 from upstream, 1.1.16 from the tracked backport — while npm
  // audit keys on the unchanged upstream version numbers.
  it('tracks a patch only for the matched copy with no fixed upstream release', () => {
    const workspaceConfig = readWorkspaceConfig()
    const patched = [...workspaceConfig.matchAll(/^ {2}(\S+): (patches\/\S+\.patch)$/gm)]

    expect(patched.map((m) => m[1])).toEqual(['brace-expansion@1.1.16'])
    for (const [, name, patchPath] of patched) {
      expect(fs.existsSync(path.resolve(patchPath)), patchPath).toBe(true)
      expect(resolvedVersions(readLockfile(), name.split('@')[0]).join()).toContain(
        name.split('@')[1],
      )
    }
    expect(readLockfile()).not.toContain('brace-expansion@2.1.2')
    expect(workspaceConfig).toContain('is NOT risk-accepted')
  })

  // Adopting 2.1.3 inside its 48-hour quarantine needed an exception. It has to
  // stay pinned to that one version, or it would silently waive the quarantine
  // for every future brace-expansion release too.
  it('waives the release-age quarantine for one exact version and nothing more', () => {
    const workspaceConfig = readWorkspaceConfig()
    const excluded = [...workspaceConfig.matchAll(/^ {2}- '([^']+)'$/gm)].map((m) => m[1])

    expect(excluded).toEqual(['@sparxie/*', 'brace-expansion@2.1.3'])
    expect(excluded).not.toContain('brace-expansion')
    expect(workspaceConfig).not.toMatch(/^minimumReleaseAge:/m)
    expect(workspaceConfig).not.toMatch(/^trustLockfile:/m)
    // The exception is temporary, so it has to carry its own removal condition.
    expect(workspaceConfig).toContain('#503')
    expect(workspaceConfig).toContain('2026-07-30T10:16:15Z')
  })
})
