import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
}

function readLockfile() {
  return fs.readFileSync(path.resolve('pnpm-lock.yaml'), 'utf8')
}

function resolvedViteVersions(lockfile: string) {
  return [...lockfile.matchAll(/^ {2}vite@(\d+\.\d+\.\d+)[:(]/gm)].map((match) => match[1])
}

function isBeforeVite643(version: string) {
  const [major, minor, patch] = version.split('.').map(Number)
  return major < 6 || (major === 6 && (minor < 4 || (minor === 4 && patch < 3)))
}

describe('web toolchain contract', () => {
  it('retains the patched Vite, Vitest, React plugin, and Tailwind lines', () => {
    const packageJson = readPackageJson()

    expect(packageJson.devDependencies?.vite).toBe('^6.4.3')
    expect(packageJson.devDependencies?.vitest).toBe('^3.2.7')
    // plugin-react 5.x is the current stable line and keeps its Vite 6 / Node >=22.12 peer.
    expect(packageJson.devDependencies?.['@vitejs/plugin-react']).toBe('^5.2.0')
    // @tailwindcss/node reaches for module.registerHooks from 4.3.3 onward; earlier
    // 4.3 patches call the DEP0205-deprecated module.register during a Vite build.
    expect(packageJson.dependencies?.tailwindcss).toBe('^4.3.3')
    expect(packageJson.dependencies?.['@tailwindcss/vite']).toBe('^4.3.3')
  })

  it('resolves every Vite copy past the server.fs.deny bypass advisory', () => {
    const versions = resolvedViteVersions(readLockfile())

    expect(versions.length).toBeGreaterThan(0)
    expect(versions.filter(isBeforeVite643)).toEqual([])
  })

  it('runs tests without deprecation suppression', () => {
    const packageJson = readPackageJson()
    const ciWorkflow = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8')

    expect(packageJson.scripts?.test).toBe('vitest run && pnpm run test:cli')
    expect(JSON.stringify(packageJson.scripts)).not.toContain('--disable-warning')
    expect(ciWorkflow).not.toContain('--disable-warning')
  })
})
