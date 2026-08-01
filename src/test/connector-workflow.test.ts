import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CONNECTOR_PACKAGES = [
  '@sparxie/valedictorian-connectors-jobright',
  '@sparxie/valedictorian-connectors-core',
  '@sparxie/valedictorian-connectors-test-harness',
] as const

const CONNECTOR_PACKAGE_VERSIONS = {
  '@sparxie/valedictorian-connectors-jobright': '0.19.0',
  '@sparxie/valedictorian-connectors-core': '0.19.0',
  '@sparxie/valedictorian-connectors-test-harness': '0.19.0',
} as const satisfies Record<(typeof CONNECTOR_PACKAGES)[number], string>

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

    expect(packageJson.dependencies['@sparxie/valedictorian-connectors-jobright']).toBe('0.19.0')
    expect(packageJson.devDependencies['@sparxie/valedictorian-connectors-core']).toBe('0.19.0')
    expect(packageJson.devDependencies['@sparxie/valedictorian-connectors-test-harness']).toBe('0.19.0')
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
    // Patches are allowed only as security backports into transitive packaging
    // dependencies; no connector or @sparxie package may be altered locally.
    const patchedBlock = lockfile.match(/^patchedDependencies:\n((?: {2}\S+: \S+\n)+)/m)?.[1] ?? ''
    const patched = [...patchedBlock.matchAll(/^ {2}(\S+):/gm)].map((match) => match[1])
    expect(patched).toEqual(['brace-expansion@1.1.16'])

    for (const name of CONNECTOR_PACKAGES) {
      const specifier = connectorSpecifier(packageJson, name)
      const expectedVersion = CONNECTOR_PACKAGE_VERSIONS[name]
      expect(specifier).toBe(expectedVersion)
      expect(specifier).not.toMatch(/^(workspace:|file:|link:|github:|git\+|https?:)/)

      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const escapedVersion = expectedVersion.replaceAll('.', '\\.')
      expect(lockfile).toMatch(
        new RegExp(
          `'${escapedName}':\\n\\s+specifier: ${escapedVersion}\\n\\s+version: ${escapedVersion}`,
        ),
      )
      expect(lockfile).toContain(`'${name}@${expectedVersion}':`)
      expect(lockfile).toMatch(
        new RegExp(
          `'${escapedName}@${escapedVersion}':\\n\\s+resolution: \\{integrity: sha512-[A-Za-z0-9+/=]+\\}`,
        ),
      )
      expect(lockfile).not.toMatch(
        new RegExp(
          `'${escapedName}@${escapedVersion}':\\n(?: {2}.*\\n)*? {4}(tarball:|type: (directory|git)|repo:|path:)`,
        ),
      )
    }

    expect(lockfile).toMatch(
      /'@sparxie\/valedictorian-connectors-jobright@0\.19\.0':\n\s+dependencies:\n\s+'@sparxie\/valedictorian-connectors-core': 0\.19\.0/,
    )
    expect(lockfile).toMatch(
      /'@sparxie\/valedictorian-connectors-test-harness@0\.19\.0':\n\s+dependencies:\n\s+'@sparxie\/valedictorian-connectors-core': 0\.19\.0/,
    )
    expect(lockfile).not.toContain("'@sparxie/sdk@0.29.0'")
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
