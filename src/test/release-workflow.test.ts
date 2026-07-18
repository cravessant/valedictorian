import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = path.resolve('.github/workflows/release-mac.yml')

function readReleaseWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8')
}

function sectionBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Mac release workflow', () => {
  it('builds and uploads a Mac DMG from the app-only repository', () => {
    expect(fs.existsSync(workflowPath)).toBe(true)

    const workflow = readReleaseWorkflow()

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*.*.*'")
    expect(workflow).toContain('name: Verify Release')
    expect(workflow).toContain('runs-on: ubuntu-latest')
    expect(workflow).toContain('name: Build Mac DMG')
    expect(workflow).toContain('needs: verify')
    expect(workflow).toContain('runs-on: macos-latest')
    expect(workflow).toContain('retention-days: 1')
    expect(workflow).not.toContain('retention-days: 7')
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('pnpm/action-setup@v6')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('actions/upload-artifact@v7')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('Verify release tag')
    expect(workflow).toContain('Release tag ${actualTag} does not match package version ${expectedTag}')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm lint')
    expect(workflow.indexOf('pnpm test')).toBeLessThan(workflow.indexOf('build-mac:'))
    expect(workflow.indexOf('pnpm lint')).toBeLessThan(workflow.indexOf('build-mac:'))
    expect(workflow.slice(workflow.indexOf('build-mac:'))).not.toContain('pnpm test')
    expect(workflow.slice(workflow.indexOf('build-mac:'))).not.toContain('pnpm lint')
    expect(workflow).toContain('Validate macOS signing secrets')
    expect(workflow).toContain('Validate update feed publishing secrets')
    expect(workflow).toContain('MAC_CSC_LINK')
    expect(workflow).toContain('MAC_CSC_KEY_PASSWORD')
    expect(workflow).toContain('APPLE_API_KEY')
    expect(workflow).toContain('APPLE_API_KEY_ID')
    expect(workflow).toContain('APPLE_API_ISSUER')
    expect(workflow).toContain('APPLE_TEAM_ID')
    expect(workflow).toContain('UPDATE_FEED_URL')
    expect(workflow).toContain('UPDATE_FEED_ENDPOINT')
    expect(workflow).toContain('UPDATE_FEED_BUCKET')
    expect(workflow).toContain('UPDATE_FEED_ACCESS_KEY_ID')
    expect(workflow).toContain('UPDATE_FEED_SECRET_ACCESS_KEY')
    expect(workflow).toContain('UPDATE_FEED_PREFIX')
    expect(workflow).toContain('CSC_LINK: ${{ secrets.MAC_CSC_LINK }}')
    expect(workflow).toContain('CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}')
    expect(workflow).toContain('Decode App Store Connect API key')
    expect(workflow).toContain('base64 --decode > "${{ runner.temp }}/app-store-connect-api-key.p8"')
    expect(workflow).toContain('APPLE_API_KEY: ${{ runner.temp }}/app-store-connect-api-key.p8')
    expect(workflow).toContain('pnpm build:mac')
    expect(workflow).toContain('Generate update metadata')
    expect(workflow).toContain('pnpm exec tsx scripts/generate-mac-update-metadata.ts')
    expect(workflow).not.toContain('--publish always')
    expect(workflow).toContain('valedictorian-app-mac-dmg')
    expect(workflow).toContain('release/*/*.dmg')
    expect(workflow).toContain('release/*/*.zip')
    expect(workflow).toContain('release/*/*.blockmap')
    expect(workflow).toContain('release/*/latest-mac.yml')
    expect(workflow).toContain('Publish update feed')
    expect(workflow).toContain('aws s3 cp "$release_dir/latest-mac.yml"')
    expect(workflow).toContain('cache-control "no-cache"')
    expect(workflow).toContain('aws s3 sync "$release_dir"')
    expect(workflow).toContain('cache-control "public, max-age=31536000, immutable"')
    expect(workflow).toContain('gh release upload')
    expect(workflow).toContain('--clobber')
    expect(workflow).toContain('release create "$GITHUB_REF_NAME"')
    expect(workflow).toContain('release_args+=(--prerelease)')
    expect(workflow).toContain('Valedictorian $GITHUB_REF_NAME')
  })

  it('serializes every alpha release across tag and manual refs', () => {
    const workflow = readReleaseWorkflow()
    const concurrency = sectionBetween(workflow, 'concurrency:', 'env:')

    expect(concurrency).toContain('group: release-mac-alpha')
    expect(concurrency).toContain('cancel-in-progress: false')
    expect(concurrency).not.toContain('github.ref')
  })

  it('keeps manual runs dry by default and restricts explicit publishing to main', () => {
    const workflow = readReleaseWorkflow()
    const verifyJob = sectionBetween(workflow, 'verify:', 'build-mac:')
    const buildMacJob = workflow.slice(workflow.indexOf('build-mac:'))

    expect(workflow).toContain('publish_update_feed:')
    expect(workflow).toContain('default: false')
    expect(workflow).toContain('type: boolean')
    expect(verifyJob).toContain('name: Resolve release mode')
    expect(verifyJob).toContain('REQUESTED_PUBLISH: ${{ inputs.publish_update_feed }}')
    expect(verifyJob).toContain('[[ "${GITHUB_REF}" == refs/tags/* ]]')
    expect(verifyJob).toContain('[ "${REQUESTED_PUBLISH}" = "true" ]')
    expect(verifyJob).toContain('[ "${GITHUB_REF}" != "refs/heads/main" ]')
    expect(verifyJob).toContain('Manual update-feed publishing is restricted to the main branch')
    expect(verifyJob).toContain('publish_update_feed=${publish_update_feed}')
    expect(buildMacJob).toMatch(
      /- name: Publish update feed\n\s+if: needs\.verify\.outputs\.publish_update_feed == 'true'/,
    )
  })

  it('validates release configuration on Linux before allocating macOS', () => {
    const workflow = readReleaseWorkflow()
    const verifyJob = sectionBetween(workflow, 'verify:', 'build-mac:')
    const buildMacJob = workflow.slice(workflow.indexOf('build-mac:'))

    expect(verifyJob).toContain('name: Validate macOS signing secrets')
    expect(verifyJob).toContain('name: Validate update feed publishing secrets')
    expect(verifyJob).toMatch(
      /- name: Validate update feed publishing secrets\n\s+if: steps\.release-mode\.outputs\.publish_update_feed == 'true'/,
    )
    expect(verifyJob.indexOf('Validate macOS signing secrets')).toBeLessThan(
      verifyJob.indexOf('Set up pnpm'),
    )
    expect(verifyJob.indexOf('Validate update feed publishing secrets')).toBeLessThan(
      verifyJob.indexOf('Set up pnpm'),
    )
    expect(buildMacJob).not.toContain('name: Validate macOS signing secrets')
    expect(buildMacJob).not.toContain('name: Validate update feed publishing secrets')
  })

  it('reuses an exact-SHA successful CI run on tags and fails safe into full verification', () => {
    const workflow = readReleaseWorkflow()
    const verifyJob = sectionBetween(workflow, 'verify:', 'build-mac:')

    expect(verifyJob).toContain('actions: read')
    expect(verifyJob).toContain('id: prior-ci')
    expect(verifyJob).toContain('Reuse prior successful CI when safe')
    expect(verifyJob).toContain('actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}')
    expect(verifyJob).toContain(
      'select(.head_sha == \\"${GITHUB_SHA}\\" and .conclusion == \\"success\\" and .event == \\"push\\" and .head_branch == \\"main\\")',
    )
    expect(verifyJob).toContain('workflow_dispatch always runs full verification')
    expect(verifyJob).toContain('falling back to full verification')
    expect(verifyJob).toContain('No eligible successful main push CI')
    expect(verifyJob).toContain('run_full_verification=${run_full_verification}')
    expect(verifyJob.indexOf('Verify release tag')).toBeLessThan(
      verifyJob.indexOf('Reuse prior successful CI when safe'),
    )
    expect(verifyJob.indexOf('Verify release tag')).toBeLessThan(verifyJob.indexOf('Set up pnpm'))

    for (const stepName of [
      'Set up pnpm',
      'Set up Node.js',
      'Install dependencies',
      'Run tests',
      'Lint and typecheck',
    ]) {
      expect(verifyJob).toMatch(
        new RegExp(
          `- name: ${stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\s+if: steps\\.prior-ci\\.outputs\\.run_full_verification == 'true'`,
        ),
      )
    }

    expect(verifyJob).toContain('cache: pnpm')
    expect(verifyJob).toContain('cache-dependency-path: valedictorian-app/pnpm-lock.yaml')
  })

  it('rejects pull_request, workflow_dispatch, and non-main CI runs for release reuse', () => {
    const workflow = readReleaseWorkflow()
    const verifyJob = sectionBetween(workflow, 'verify:', 'build-mac:')
    const eligibilitySelect =
      'select(.head_sha == \\"${GITHUB_SHA}\\" and .conclusion == \\"success\\" and .event == \\"push\\" and .head_branch == \\"main\\")'

    expect(verifyJob).toContain(eligibilitySelect)
    expect(verifyJob).toContain('.event == \\"push\\"')
    expect(verifyJob).toContain('.head_branch == \\"main\\"')
    expect(verifyJob).not.toContain('.event == \\"pull_request\\"')
    expect(verifyJob).toContain('workflow_dispatch always runs full verification')
    expect(verifyJob).toMatch(
      /if \[ "\$\{GITHUB_EVENT_NAME\}" = "workflow_dispatch" \]; then\n\s+echo "workflow_dispatch always runs full verification"/,
    )
    expect(eligibilitySelect).toContain('.event == \\"push\\"')
    expect(eligibilitySelect).toContain('.head_branch == \\"main\\"')
    expect(eligibilitySelect).not.toMatch(/pull_request/)
  })

  it('disables setup-node pnpm caching on macOS while keeping Linux verify caching', () => {
    const workflow = readReleaseWorkflow()
    const verifyJob = sectionBetween(workflow, 'verify:', 'build-mac:')
    const buildMacJob = workflow.slice(workflow.indexOf('build-mac:'))

    expect(verifyJob).toContain('cache: pnpm')
    expect(buildMacJob).toContain('actions/setup-node@v6')
    expect(buildMacJob).not.toContain('cache: pnpm')
    expect(buildMacJob).not.toContain('cache-dependency-path:')
  })
})
