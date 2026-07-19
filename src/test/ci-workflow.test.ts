import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = path.resolve('.github/workflows/ci.yml')

describe('CI workflow', () => {
  it('runs quality on drafts and expensive checks only when ready', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('- converted_to_draft')
    expect(workflow).toContain('- ready_for_review')
    expect(workflow).toContain('- main')
    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).toContain('quality:\n    name: Quality')
    expect(workflow).toContain('run: pnpm lint')
    expect(workflow).not.toContain('run: pnpm typecheck')
  })

  it('runs two isolated test shards with bounded worker usage', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8')
    const viteConfig = fs.readFileSync(path.resolve('vite.config.ts'), 'utf8')
    const readyOrMain = "if: github.event_name == 'push' || !github.event.pull_request.draft"

    expect(workflow.match(new RegExp(readyOrMain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(2)
    expect(workflow).toContain('name: Node Tests (${{ matrix.shard }}/2)')
    expect(workflow).toMatch(/shard:\n\s+- 1\n\s+- 2/)
    expect(workflow).toContain('run: pnpm test --shard=${{ matrix.shard }}/2')
    expect(viteConfig).toContain('maxWorkers: 2')
    expect(viteConfig).toContain('minWorkers: process.env.CI ? 2 : undefined')
  })

  it('provides one stable gate for draft and fully verified runs', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('ci:\n    name: CI\n    if: always()')
    expect(workflow).toContain('NODE_TESTS_RESULT: ${{ needs.node-tests.result }}')
    expect(workflow).toContain('PACKAGE_SMOKE_RESULT: ${{ needs.package-smoke.result }}')
    expect(workflow).toContain('QUALITY_RESULT: ${{ needs.quality.result }}')
    expect(workflow).toContain('expected_expensive_result=skipped')
    expect(workflow).toContain('expected_expensive_result=success')
  })
})
