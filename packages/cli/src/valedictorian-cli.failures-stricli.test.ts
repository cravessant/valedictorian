import { describe, expect, it } from 'vitest'

import { parseCliError, runCli } from './valedictorian-cli.test-helpers.js'

describe('Stricli parse/usage failures under --json', () => {
  it('emits structured usage JSON and exit 2 for missing positionals', async () => {
    const result = await runCli([
      'applications',
      'get',
      '--workspace',
      'workspace-1',
      '--json',
    ])

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(parseCliError(result.stderr)).toEqual({
      code: 'usage_error',
      kind: 'validation',
      message: expect.any(String),
    })
    expect(result.stderr.trim().startsWith('{')).toBe(true)
    expect(result.stderr).not.toMatch(/^Expected at least/m)
  })

  it('emits structured usage JSON and exit 2 for unknown flags', async () => {
    const result = await runCli([
      'applications',
      'list',
      '--workspace',
      'workspace-1',
      '--nope',
      '--json',
    ])

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(parseCliError(result.stderr)).toEqual({
      code: 'usage_error',
      kind: 'validation',
      message: expect.any(String),
    })
    expect(result.stderr.trim().startsWith('{')).toBe(true)
    expect(result.stderr).not.toMatch(/^No flag registered/m)
  })

  it('honors leading global --json for missing positionals', async () => {
    const result = await runCli([
      '--json',
      'applications',
      'get',
      '--workspace',
      'workspace-1',
    ])

    expect(result.exitCode).toBe(2)
    expect(parseCliError(result.stderr).code).toBe('usage_error')
    expect(result.stderr.trim().startsWith('{')).toBe(true)
  })

  it('keeps human Stricli usage failures as safe prose without JSON envelope', async () => {
    const result = await runCli([
      'applications',
      'get',
      '--workspace',
      'workspace-1',
    ])

    expect(result.exitCode).toBe(2)
    expect(() => JSON.parse(result.stderr)).toThrow()
    expect(result.stderr.length).toBeGreaterThan(0)
    expect(result.stderr).not.toContain('"error"')
  })
})
