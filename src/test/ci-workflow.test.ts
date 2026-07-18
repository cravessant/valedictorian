import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = path.resolve('.github/workflows/ci.yml')

describe('CI workflow', () => {
  it('checks each ref once with bounded execution and no duplicate typecheck', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('pull_request:')
    expect(workflow).toContain('- main')
    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).toMatch(/test:\n[\s\S]*?timeout-minutes: 20/)
    expect(workflow).toContain('run: pnpm test')
    expect(workflow).toContain('run: pnpm lint')
    expect(workflow).not.toContain('run: pnpm typecheck')
  })
})
