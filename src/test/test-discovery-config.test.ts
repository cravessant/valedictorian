import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import config, { maintainedTestIncludes } from '../../vite.config'

describe('test discovery configuration', () => {
  it('limits discovery to maintained test roots', () => {
    expect(config.test?.include).toEqual(maintainedTestIncludes)
    expect(maintainedTestIncludes).toEqual([
      'electron/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,mjs}',
      'src/**/*.test.{ts,tsx}',
    ])
  })

  it('keeps real-window tests opt-in locally and enabled explicitly in CI', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const commandTest = fs.readFileSync(
      path.resolve('scripts/isolated-validation.command.test.ts'),
      'utf8',
    )
    const workflow = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8')

    expect(packageJson.scripts?.['test:window']).toContain('VALEDICTORIAN_WINDOW_TESTS=1')
    expect(commandTest).toContain("process.env.VALEDICTORIAN_WINDOW_TESTS !== '1'")
    expect(workflow).toContain('VALEDICTORIAN_WINDOW_TESTS: "1"')
  })
})
