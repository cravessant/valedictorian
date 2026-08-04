import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowDirectory = path.resolve('.github/workflows')
const productRepository = 'git+https://github.com/cravessant/valedictorian.git'
const productHomepage = 'https://github.com/cravessant/valedictorian#readme'
const productIssues = 'https://github.com/cravessant/valedictorian/issues'

function readWorkflow(name: string) {
  return fs.readFileSync(path.join(workflowDirectory, name), 'utf8')
}

function readPackage(relativePath: string) {
  return JSON.parse(fs.readFileSync(path.resolve(relativePath, 'package.json'), 'utf8')) as {
    bugs?: { url?: string }
    homepage?: string
    license?: string
    name?: string
    private?: boolean
    publishConfig?: { access?: string; registry?: string }
    repository?: { directory?: string; type?: string; url?: string }
    version?: string
  }
}

describe('product npm publish workflows', () => {
  it('keeps every product family on a disjoint tag namespace', () => {
    const connectors = readWorkflow('publish-connectors.yml')
    const cli = readWorkflow('publish-cli.yml')
    const workspace = readWorkflow('publish-workspace.yml')
    const desktop = readWorkflow('release-mac.yml')

    expect(connectors).toContain("'connectors-migration-v*.*.*'")
    expect(connectors).toContain("'connectors-v*.*.*'")
    expect(cli).toContain("'cli-migration-v*.*.*'")
    expect(cli).toContain("'cli-v*.*.*'")
    expect(workspace).toContain("'workspace-migration-v*.*.*'")
    expect(workspace).toContain("'workspace-v*.*.*'")
    expect(desktop).toContain("'v*.*.*'")
    for (const workflow of [connectors, cli, workspace]) {
      expect(workflow).not.toMatch(/^\s+- 'v\*\.\*\.\*'$/m)
    }
  })

  it('uses the reviewed OIDC and exact-tarball publication contract', () => {
    for (const name of [
      'publish-connectors.yml',
      'publish-cli.yml',
      'publish-workspace.yml',
    ]) {
      const workflow = readWorkflow(name)
      expect(workflow).toContain('contents: read')
      expect(workflow).toContain('id-token: write')
      expect(workflow).toContain('cancel-in-progress: false')
      expect(workflow).toContain('group: ${{ github.workflow }}')
      expect(workflow).toContain('registry-url: https://registry.npmjs.org')
      expect(workflow).toContain('package-manager-cache: false')
      expect(workflow).toContain('pnpm install --frozen-lockfile')
      expect(workflow).toContain('pack --out')
      expect(workflow).toContain('publish-package-tarball.mjs --verify-only')
      expect(workflow).toContain('NPM_DIST_TAG')
      expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7')
      expect(workflow).toContain('receipt.log')
      expect(workflow).toContain(
        'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
      )
      expect(workflow).toContain(
        'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6',
      )
      expect(workflow).toContain(
        'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
      )
    }
  })

  it('publishes dependency families in their required order', () => {
    const connectors = readWorkflow('publish-connectors.yml')
    const workspace = readWorkflow('publish-workspace.yml')

    expect(connectors.indexOf('Publish connector API')).toBeLessThan(
      connectors.indexOf('Publish connector test harness'),
    )
    const order = [
      'Publish workspace server',
      'Publish workspace client',
      'Publish workspace conformance',
      'Publish local runtime',
    ]
    for (let index = 1; index < order.length; index += 1) {
      expect(workspace.indexOf(order[index - 1]!)).toBeLessThan(
        workspace.indexOf(order[index]!),
      )
    }
  })

  it('builds connector dependencies before testing local runtime', () => {
    const workspace = readWorkflow('publish-workspace.yml')

    expect(workspace).toContain('pnpm run build:connector-packages')
    expect(workspace.indexOf('Build connector dependencies')).toBeLessThan(
      workspace.indexOf('Test local runtime'),
    )
  })

  it('makes only the four P25 package boundaries public', () => {
    const packages = [
      ['packages/workspace/server', 'packages/workspace/server'],
      ['packages/workspace/client', 'packages/workspace/client'],
      ['packages/workspace/conformance', 'packages/workspace/conformance'],
      ['packages/local-runtime', 'packages/local-runtime'],
    ] as const

    for (const [packagePath, repositoryDirectory] of packages) {
      const packageJson = readPackage(packagePath)
      expect(packageJson.private).not.toBe(true)
      expect(packageJson.license).toBe('MIT')
      expect(packageJson.homepage).toBe(productHomepage)
      expect(packageJson.bugs?.url).toBe(productIssues)
      expect(packageJson.publishConfig).toEqual({
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      })
      expect(packageJson.repository).toEqual({
        directory: repositoryDirectory,
        type: 'git',
        url: productRepository,
      })
    }
    expect(readPackage('.').private).toBe(true)
  })

  it('keeps migration canaries off default npm channels', () => {
    for (const name of [
      'publish-connectors.yml',
      'publish-cli.yml',
      'publish-workspace.yml',
    ]) {
      const workflow = readWorkflow(name)
      expect(workflow).toContain("'migration'")
      expect(workflow).toMatch(/migration \? 'migration' :/)
    }

    const publisher = fs.readFileSync(
      path.resolve('scripts/publish-package-tarball.mjs'),
      'utf8',
    )
    expect(publisher).toContain("'--provenance'")
    expect(publisher).toContain('already exists with different integrity')
    expect(publisher).toContain('forbiddenDependencySource')
    expect(readWorkflow('publish-connectors.yml')).toContain(
      'Connector 0.19.1 must publish only as a migration canary',
    )
    expect(readWorkflow('publish-cli.yml')).toContain(
      'CLI 0.1.0-alpha.21 must publish only as a migration canary',
    )
    expect(readWorkflow('publish-workspace.yml')).toContain(
      'Workspace 0.1.0 must publish only as a migration canary',
    )
    const workspace = readWorkflow('publish-workspace.yml')
    expect(workspace).toContain('Require connector migration receipt')
    expect(workspace).toContain('@sparxie/valedictorian-connectors-core')
    expect(workspace).toContain("distTag: 'migration'")
  })

  it('runs release tests without the desktop global setup and proves registry consumers', () => {
    const connectors = readWorkflow('publish-connectors.yml')
    const cli = readWorkflow('publish-cli.yml')
    const workspace = readWorkflow('publish-workspace.yml')

    expect(connectors).toContain('--config vitest.publish.config.ts')
    expect(workspace).toContain('--config vitest.publish.config.ts')
    for (const workflow of [connectors, cli, workspace]) {
      expect(workflow).toContain('Verify clean registry consumer')
      expect(workflow).toContain('--registry=https://registry.npmjs.org/')
      expect(workflow).toMatch(
        /- name: Verify clean registry consumer\n        env:\n(?:          .+\n)*          PNPM_CONFIG_MINIMUM_RELEASE_AGE: '0'/,
      )
      expect(workflow).toContain(
        "if: ${{ always() && hashFiles('.release-packs/*-receipt.log') != '' }}",
      )
      expect(workflow).toContain('include-hidden-files: true')
    }
  })
})
