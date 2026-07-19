import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = path.resolve('.github/workflows/ci.yml')

function sectionBetween(workflow: string, startMarker: string, endMarker: string) {
  const start = workflow.indexOf(startMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = workflow.indexOf(endMarker, start + startMarker.length)
  expect(end).toBeGreaterThan(start)
  return workflow.slice(start, end)
}

describe('CI workflow', () => {
  it('checks ready refs with matrix shards on separate Linux runners', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8')
    const runTestsStep = sectionBetween(workflow, '- name: Run tests', 'env:')
    const beforeRunTests = workflow.slice(0, workflow.indexOf('- name: Run tests'))
    const packageSmoke = workflow.slice(workflow.indexOf('package-smoke:'))
    const topLevelEnv = sectionBetween(workflow, '\nenv:\n', '\njobs:')
    const testJobHeader = sectionBetween(workflow, '\n  test:\n', '\n    steps:')
    const installStep = sectionBetween(
      workflow,
      '- name: Install dependencies\n        working-directory: valedictorian-app\n        run: |',
      '- name: Run tests',
    )

    expect(workflow).toContain('- converted_to_draft')
    expect(workflow).toContain('- ready_for_review')
    expect(workflow).toContain('- main')
    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).toMatch(/test:\n[\s\S]*?timeout-minutes: 7/)
    expect(workflow).toContain('name: Test App (shard ${{ matrix.shard }}/2)')
    expect(workflow).toMatch(/test:\n[\s\S]*?strategy:\n\s+fail-fast: false\n\s+matrix:\n\s+shard: \[1, 2\]/)
    expect(workflow).toContain('--shard=${{ matrix.shard }}/2')
    expect(workflow.match(/--minWorkers=2 --maxWorkers=2/g)).toHaveLength(1)
    expect(workflow).not.toContain('--minWorkers=1 --maxWorkers=1')
    expect(workflow).not.toContain('shard_one_pid')
    expect(workflow).not.toContain('shard_two_pid')
    expect(workflow).not.toContain('wait "$shard_one_pid"')
    expect(workflow).not.toContain('wait "$shard_two_pid"')

    expect(workflow).toContain('- name: Restore Vitest transform and V8 compile caches')
    expect(workflow).toContain('valedictorian-app/node_modules/.vite')
    expect(workflow).toContain(
      'NODE_COMPILE_CACHE: ${{ github.workspace }}/valedictorian-app/.node-compile-cache',
    )
    expect(workflow).toMatch(
      /key: vitest-cache-\$\{\{ runner\.os \}\}-shard\$\{\{ matrix\.shard \}\}-\$\{\{ hashFiles\('valedictorian-app\/pnpm-lock\.yaml'\) \}\}-\$\{\{ github\.sha \}\}/,
    )

    expect(workflow).not.toContain('eval ')
    expect(workflow).not.toContain('--print-env')
    expect(runTestsStep).toContain('scripts/allocate-test-temp.mjs --print-root')
    expect(runTestsStep).toContain('TEST_TEMP_ROOT="$(node scripts/allocate-test-temp.mjs --print-root)"')
    expect(runTestsStep).toContain('[ -n "$TEST_TEMP_ROOT" ] || exit 1')
    expect(runTestsStep).toContain('local status=$?')
    expect(runTestsStep).toContain('trap - EXIT INT TERM')
    expect(runTestsStep).toMatch(
      /if node scripts\/allocate-test-temp\.mjs --cleanup "\$TEST_TEMP_ROOT"; then/,
    )
    expect(runTestsStep).toContain('local cleanup_status=$?')
    expect(runTestsStep).toContain('if [ "$status" -eq 0 ]; then')
    expect(runTestsStep).toContain('status=$cleanup_status')
    expect(runTestsStep).toContain('exit "$status"')
    expect(runTestsStep).not.toMatch(
      /node scripts\/allocate-test-temp\.mjs --cleanup "\$TEST_TEMP_ROOT"\n\s+local cleanup_status=\$\?/,
    )
    expect(runTestsStep).toContain('on_int() { exit 130; }')
    expect(runTestsStep).toContain('on_term() { exit 143; }')
    expect(runTestsStep).toContain('trap cleanup_test_temp EXIT')
    expect(runTestsStep).toContain('trap on_int INT')
    expect(runTestsStep).toContain('trap on_term TERM')
    expect(runTestsStep).toMatch(/TMPDIR="\$TEST_TEMP_ROOT" pnpm exec vitest run/)

    expect(workflow.match(/TMPDIR/g)).toEqual(['TMPDIR'])
    expect(beforeRunTests).not.toContain('TMPDIR')
    expect(topLevelEnv).not.toContain('TMPDIR')
    expect(testJobHeader).not.toContain('TMPDIR')
    expect(installStep).not.toContain('TMPDIR')
    expect(packageSmoke).not.toContain('TMPDIR')
    expect(packageSmoke).not.toContain('pnpm exec vitest')
    expect(packageSmoke).not.toContain('allocate-test-temp')

    expect(workflow).toMatch(/package-smoke:[\s\S]*?timeout-minutes: 5/)
    expect(workflow).toContain('name: Run macOS package checks')
    expect(workflow).toMatch(
      /- name: Build Windows application bundles\n\s+if: runner\.os == 'Windows'/,
    )
    expect(workflow).not.toContain('run: pnpm typecheck')
  })

  it('runs lint alone for drafts without spending package or test runner minutes', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8')
    const draftOnly = "if: github.event_name == 'pull_request' && github.event.pull_request.draft"
    const readyOrMain = "if: github.event_name == 'push' || !github.event.pull_request.draft"

    expect(workflow).toMatch(/quality:\n[\s\S]*?name: Draft Quality/)
    expect(workflow).toContain(draftOnly)
    expect(workflow.match(new RegExp(readyOrMain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(2)
  })

  it('provides one stable aggregate gate for draft and fully verified runs', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('ci:\n    name: CI\n    if: always()')
    expect(workflow).toContain('PACKAGE_SMOKE_RESULT: ${{ needs.package-smoke.result }}')
    expect(workflow).toContain('QUALITY_RESULT: ${{ needs.quality.result }}')
    expect(workflow).toContain('TEST_RESULT: ${{ needs.test.result }}')
    expect(workflow).toContain('[ "$IS_DRAFT" = "true" ]')
    expect(workflow).toContain('[ "$QUALITY_RESULT" != "skipped" ]')
  })
})
