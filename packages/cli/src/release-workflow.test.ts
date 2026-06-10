import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ciWorkflowPath = path.resolve('.github/workflows/ci.yml')
const releaseWorkflowPath = path.resolve('.github/workflows/release-cli.yml')
const publishWorkflowPath = path.resolve('.github/workflows/publish.yml')

describe('CLI release workflow', () => {
  it('opts JavaScript actions into Node 24 for CI', () => {
    expect(fs.existsSync(ciWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(ciWorkflowPath, 'utf8')

    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('pnpm/action-setup@v6')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('pnpm build')
  })

  it('builds, packs, and uploads the CLI package from the standalone repository', () => {
    expect(fs.existsSync(releaseWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*'")
    expect(workflow).toContain('runs-on: ubuntu-latest')
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('pnpm/action-setup@v6')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('actions/upload-artifact@v7')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('pnpm build')
    expect(workflow).toContain('pnpm pack --pack-destination release')
    expect(workflow).toContain('valedictorian-cli-npm-package')
    expect(workflow).toContain('release/*.tgz')
    expect(workflow).toContain('gh release upload')
    expect(workflow).toContain('--clobber')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('Valedictorian CLI $GITHUB_REF_NAME')
  })

  it('publishes the CLI package to npm with trusted publishing from the private repository', () => {
    expect(fs.existsSync(publishWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(publishWorkflowPath, 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*.*.*'")
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('registry-url: https://registry.npmjs.org')
    expect(workflow).toContain('corepack enable')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('Verify release tag')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm build')
    expect(workflow).toContain('npm pack --dry-run')
    expect(workflow).toContain('npm publish --access public --tag alpha')
    expect(workflow).not.toContain('--provenance')
  })
})
