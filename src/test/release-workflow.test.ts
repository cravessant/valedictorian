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
    expect(workflow).toContain('runs-on: blacksmith-2vcpu-ubuntu-2404')
    expect(workflow).toContain('name: Build Mac DMG')
    expect(workflow).toContain('needs: verify')
    expect(workflow).toContain('runs-on: blacksmith-6vcpu-macos-latest')
    expect(workflow).toContain('retention-days: 1')
    expect(workflow).not.toContain('retention-days: 7')
    expect(workflow).toContain(
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
    )
    expect(workflow).toContain(
      'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6',
    )
    expect(workflow).toContain(
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
    )
    expect(workflow).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7',
    )
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

  it('always verifies the release on Linux before allocating macOS', () => {
    const workflow = readReleaseWorkflow()
    const verifyJob = sectionBetween(workflow, 'verify:', 'build-mac:')

    expect(verifyJob).not.toContain('actions: read')
    expect(verifyJob).not.toContain('GH_TOKEN')
    expect(verifyJob).not.toContain('prior-ci')
    expect(verifyJob).not.toContain('gh api')
    expect(verifyJob).not.toContain('run_full_verification')
    expect(verifyJob.indexOf('Verify release tag')).toBeLessThan(verifyJob.indexOf('Set up pnpm'))

    for (const stepName of [
      'Set up pnpm',
      'Set up Node.js',
      'Install dependencies',
      'Run tests',
      'Lint and typecheck',
    ]) {
      expect(verifyJob).toContain(`- name: ${stepName}`)
    }

    expect(verifyJob).toContain('cache: pnpm')
    expect(verifyJob).toContain('cache-dependency-path: valedictorian-app/pnpm-lock.yaml')
    expect(workflow.indexOf('Run tests')).toBeLessThan(workflow.indexOf('build-mac:'))
    expect(workflow.indexOf('Lint and typecheck')).toBeLessThan(workflow.indexOf('build-mac:'))
  })

  it('disables setup-node pnpm caching on macOS while keeping Linux verify caching', () => {
    const workflow = readReleaseWorkflow()
    const verifyJob = sectionBetween(workflow, 'verify:', 'build-mac:')
    const buildMacJob = workflow.slice(workflow.indexOf('build-mac:'))

    expect(verifyJob).toContain('cache: pnpm')
    expect(buildMacJob).toContain(
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
    )
    expect(buildMacJob).not.toContain('cache: pnpm')
    expect(buildMacJob).not.toContain('cache-dependency-path:')
  })
})
