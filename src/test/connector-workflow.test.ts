import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CONNECTOR_PACKAGES = [
  '@sparxie/valedictorian-connectors-jobright',
  '@sparxie/valedictorian-connectors-core',
  '@sparxie/valedictorian-connectors-test-harness',
] as const

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    pnpm?: { overrides?: unknown }
    resolutions?: Record<string, unknown>
  }
}

function readWorkflow(name: string) {
  return fs.readFileSync(path.resolve('.github/workflows', name), 'utf8')
}

function readLockfile() {
  return fs.readFileSync(path.resolve('pnpm-lock.yaml'), 'utf8')
}

function connectorSpecifier(
  packageJson: ReturnType<typeof readPackageJson>,
  name: (typeof CONNECTOR_PACKAGES)[number],
): string {
  return packageJson.dependencies[name] ?? packageJson.devDependencies[name]
}

describe('connector workflow dependencies', () => {
  it('adopts the released progress and destination-projection contracts exactly', () => {
    const packageJson = readPackageJson()

    expect(packageJson.dependencies['@sparxie/valedictorian-connectors-jobright']).toBe('0.18.0')
    expect(packageJson.devDependencies['@sparxie/valedictorian-connectors-core']).toBe('0.18.0')
    expect(packageJson.devDependencies['@sparxie/valedictorian-connectors-test-harness']).toBe('0.18.0')
    expect(packageJson.dependencies.sparxie).toBe('0.28.0')
  })

  it('resolves connector packages from the public npm registry without alternate sources', () => {
    const packageJson = readPackageJson()
    const lockfile = readLockfile()

    expect(packageJson.pnpm?.overrides).toBeUndefined()
    expect(packageJson.resolutions).toBeUndefined()
    expect(packageJson).not.toHaveProperty('overrides')
    expect(fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')).not.toMatch(
      /^packages:/m,
    )
    expect(lockfile).not.toMatch(/^overrides:/m)
    expect(lockfile).not.toMatch(/^patchedDependencies:/m)

    for (const name of CONNECTOR_PACKAGES) {
      const specifier = connectorSpecifier(packageJson, name)
      expect(specifier).toBe('0.18.0')
      expect(specifier).not.toMatch(/^(workspace:|file:|link:|github:|git\+|https?:)/)

      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(lockfile).toMatch(
        new RegExp(
          `'${escapedName}':\\n\\s+specifier: 0\\.18\\.0\\n\\s+version: 0\\.18\\.0`,
        ),
      )
      expect(lockfile).toContain(`'${name}@0.18.0':`)
      expect(lockfile).toMatch(
        new RegExp(
          `'${escapedName}@0\\.18\\.0':\\n\\s+resolution: \\{integrity: sha512-[A-Za-z0-9+/=]+\\}`,
        ),
      )
      expect(lockfile).not.toMatch(
        new RegExp(
          `'${escapedName}@0\\.18\\.0':\\n(?: {2}.*\\n)*? {4}(tarball:|type: (directory|git)|repo:|path:)`,
        ),
      )
    }

    expect(lockfile).toMatch(
      /'@sparxie\/valedictorian-connectors-jobright@0\.18\.0':\n\s+dependencies:\n\s+'@sparxie\/valedictorian-connectors-core': 0\.18\.0/,
    )
    expect(lockfile).toMatch(
      /'@sparxie\/valedictorian-connectors-test-harness@0\.18\.0':\n\s+dependencies:\n\s+'@sparxie\/valedictorian-connectors-core': 0\.18\.0/,
    )
  })

  it.each(['ci.yml', 'release-mac.yml'])(
    'installs published connector packages without a private repo checkout in %s',
    (workflowName) => {
      const workflow = readWorkflow(workflowName)

      expect(workflow).toContain('pnpm install --frozen-lockfile')
      expect(workflow).not.toContain('CONNECTORS_REPO_TOKEN')
      expect(workflow).not.toContain('KennyKeni/valedictorian-connectors')
      expect(workflow).not.toContain('Check out connector packages')
    },
  )
})
