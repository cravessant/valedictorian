import { describe, expect, it } from 'vitest'
import { runCli } from './valedictorian-cli.test-helpers'

describe('lifecycle command help', () => {
  it.each(['captures', 'jobs', 'opportunities', 'applications'])(
    'publishes the %s command group',
    async (group) => {
      const result = await runCli([group, '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('COMMANDS')
    },
  )

  it('contains only the canonical lifecycle vocabulary', async () => {
    const result = await runCli(['--help'])

    expect(result.stdout).toContain('captures')
    expect(result.stdout).toContain('jobs')
    expect(result.stdout).toContain('opportunities')
    expect(result.stdout).toContain('applications')
    for (const removedName of [
      ['raw', 'record'].join('-'),
      ['canonical', 'candidate'].join('-'),
      ['sourcing', 'finding'].join('-'),
      ['sour', 'cing'].join(''),
    ]) {
      expect(result.stdout).not.toContain(removedName)
    }
  })
})
