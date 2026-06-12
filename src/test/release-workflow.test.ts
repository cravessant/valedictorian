import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = path.resolve('.github/workflows/release-mac.yml')

function readReleaseWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8')
}

describe('Mac release workflow', () => {
  it('builds and uploads a Mac DMG from the app-only repository', () => {
    expect(fs.existsSync(workflowPath)).toBe(true)

    const workflow = readReleaseWorkflow()

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*.*.*'")
    expect(workflow).toContain('runs-on: macos-latest')
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('pnpm/action-setup@v6')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('actions/upload-artifact@v7')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('Verify release tag')
    expect(workflow).toContain('Release tag ${actualTag} does not match package version ${expectedTag}')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm typecheck')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('Validate macOS signing secrets')
    expect(workflow).toContain('MAC_CSC_LINK')
    expect(workflow).toContain('MAC_CSC_KEY_PASSWORD')
    expect(workflow).toContain('APPLE_API_KEY')
    expect(workflow).toContain('APPLE_API_KEY_ID')
    expect(workflow).toContain('APPLE_API_ISSUER')
    expect(workflow).toContain('APPLE_TEAM_ID')
    expect(workflow).toContain('CSC_LINK: ${{ secrets.MAC_CSC_LINK }}')
    expect(workflow).toContain('CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}')
    expect(workflow).toContain('Decode App Store Connect API key')
    expect(workflow).toContain('base64 --decode > "${{ runner.temp }}/app-store-connect-api-key.p8"')
    expect(workflow).toContain('APPLE_API_KEY: ${{ runner.temp }}/app-store-connect-api-key.p8')
    expect(workflow).toContain('pnpm build:mac')
    expect(workflow).toContain('valedictorian-app-mac-dmg')
    expect(workflow).toContain('release/*/*.dmg')
    expect(workflow).toContain('gh release upload')
    expect(workflow).toContain('--clobber')
    expect(workflow).toContain('release create "$GITHUB_REF_NAME"')
    expect(workflow).toContain('release_args+=(--prerelease)')
    expect(workflow).toContain('Valedictorian $GITHUB_REF_NAME')
  })
})
