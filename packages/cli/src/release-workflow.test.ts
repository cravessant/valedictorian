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

  it('does not create a separate GitHub tarball release workflow', () => {
    expect(fs.existsSync(releaseWorkflowPath)).toBe(false)
  })

  it('publishes the CLI package to npm with trusted publishing from the private repository', () => {
    expect(fs.existsSync(publishWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(publishWorkflowPath, 'utf8')

    expect(workflow).not.toContain('workflow_dispatch:')
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
    expect(workflow).toContain('Resolve npm dist-tag')
    expect(workflow).toContain('packageJson.version.match(/-(alpha|beta|rc)\\./)')
    expect(workflow).toContain('NPM_DIST_TAG')
    expect(workflow).toContain('publish_args=(publish --access public --provenance)')
    expect(workflow).toContain('publish_args+=(--tag "$NPM_DIST_TAG")')
  })
})
