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
  '@sparxie/valedictorian-connectors-core': '0.19.1',
  '@sparxie/valedictorian-connectors-test-harness': '0.19.1',
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
    expect(packageJson.dependencies['@sparxie/valedictorian-connectors-core']).toBe(
      'workspace:*',
    )
    expect(
      packageJson.devDependencies['@sparxie/valedictorian-connectors-test-harness'],
    ).toBe('workspace:0.19.1')
  })

  it('links product-owned connector packages and keeps Jobright on public npm', () => {
    const packageJson = readPackageJson()
    const lockfile = readLockfile()

    expect(packageJson.pnpm?.overrides).toBeUndefined()
    expect(packageJson.resolutions).toBeUndefined()
    expect(packageJson).not.toHaveProperty('overrides')
    const workspace = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toContain('- "packages/connector-api"')
    expect(workspace).toContain('- "packages/connector-testkit"')
    expect(workspace).not.toContain('packages/*')
    const overridesBlock = lockfile.match(/^overrides:\n((?: {2}.+\n)+)/m)?.[1] ?? ''
    expect(overridesBlock).not.toContain('@sparxie')
    expect(lockfile).not.toMatch(/^patchedDependencies:/m)

    expect(connectorSpecifier(packageJson, CONNECTOR_PACKAGES[0])).toBe('0.19.0')
    expect(lockfile).toMatch(
      /'@sparxie\/valedictorian-connectors-jobright':\n\s+specifier: 0\.19\.0\n\s+version: 0\.19\.0/,
    )
    expect(lockfile).toMatch(
      /'@sparxie\/valedictorian-connectors-jobright@0\.19\.0':\n\s+resolution: \{integrity: sha512-/,
    )
    for (const [name, workspacePath] of [
      ['@sparxie/valedictorian-connectors-core', 'packages/connector-api'],
      [
        '@sparxie/valedictorian-connectors-test-harness',
        'packages/connector-testkit',
      ],
    ]) {
      const version = CONNECTOR_PACKAGE_VERSIONS[
        name as keyof typeof CONNECTOR_PACKAGE_VERSIONS
      ]
      const specifier = name === '@sparxie/valedictorian-connectors-core'
        ? 'workspace:*'
        : `workspace:${version}`
      expect(connectorSpecifier(
        packageJson,
        name as (typeof CONNECTOR_PACKAGES)[number],
      )).toBe(specifier)
      expect(lockfile).toMatch(
        new RegExp(
          `'${name}':\\n\\s+specifier: ${specifier.replaceAll('.', '\\.').replace('*', '\\*')}\\n`
            + `\\s+version: link:${workspacePath}`,
        ),
      )
    }

    expect(lockfile).toMatch(
      /'@sparxie\/valedictorian-connectors-jobright@0\.19\.0':\n\s+dependencies:\n\s+'@sparxie\/valedictorian-connectors-core': 0\.19\.0/,
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
