import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CLI/UI development proof workflow contract', () => {
  it('runs the combined proof on supported Linux and gates the aggregate CI job', () => {
    const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
    const proofJob = workflow.match(
      /  dev-proof:\n(?<job>[\s\S]*?)\n  package-smoke:/,
    )?.groups?.job
    const aggregate = workflow.match(
      /  ci:\n(?<job>[\s\S]*)$/,
    )?.groups?.job

    expect(proofJob).toContain('runs-on: blacksmith-2vcpu-ubuntu-2404')
    expect(proofJob).toContain('run: command -v xvfb-run')
    expect(proofJob).toContain('run: pnpm install --frozen-lockfile')
    expect(proofJob).toContain('run: pnpm run proof:dev')
    expect(aggregate).toContain('- dev-proof')
    expect(aggregate).toContain('DEV_PROOF_RESULT: ${{ needs.dev-proof.result }}')
    expect(aggregate).toContain('[ "$DEV_PROOF_RESULT" != "success" ]')
    expect(aggregate).toContain('[ "$DEV_PROOF_RESULT" != "skipped" ]')
  })
})
