import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = path.resolve('.github/workflows/release-mac.yml')

function readReleaseWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8')
}

describe('Mac alpha release workflow', () => {
  it('builds and uploads a Mac DMG from the app-only repository', () => {
    expect(fs.existsSync(workflowPath)).toBe(true)

    const workflow = readReleaseWorkflow()

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*'")
    expect(workflow).toContain('runs-on: macos-latest')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm typecheck')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('pnpm build:mac')
    expect(workflow).toContain('valedictorian-app-mac-dmg')
    expect(workflow).toContain('release/*/*.dmg')
    expect(workflow).toContain('gh release upload')
    expect(workflow).toContain('--clobber')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('Valedictorian $GITHUB_REF_NAME')
  })
})
