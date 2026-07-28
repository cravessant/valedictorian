import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import config, {
  jsdomTestIncludes,
  maintainedTestExcludes,
  maintainedTestIncludes,
} from '../../vite.config'

type ProjectTestConfig = {
  environment?: string
  exclude?: string[]
  include?: string[]
  name?: string
}

function projectConfig(name: string) {
  const projects = (config.test?.projects ?? []) as Array<{ test?: ProjectTestConfig }>
  return projects.map((project) => project.test).find((test) => test?.name === name)
}

describe('test discovery configuration', () => {
  it('limits discovery to maintained test roots', () => {
    expect(maintainedTestIncludes).toEqual([
      'electron/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,mjs}',
      'src/**/*.test.{ts,tsx}',
    ])
    expect(projectConfig('node')?.include).toEqual(maintainedTestIncludes)
    expect(projectConfig('jsdom')?.include).toEqual(jsdomTestIncludes)
    expect(projectConfig('node')?.exclude).toEqual([
      ...maintainedTestExcludes,
      ...jsdomTestIncludes,
    ])
    expect(projectConfig('jsdom')?.exclude).toEqual(maintainedTestExcludes)
  })

  it('owns every maintained test through exactly one environment project', () => {
    const viteConfigSource = fs.readFileSync(path.resolve('vite.config.ts'), 'utf8')

    expect(viteConfigSource).not.toContain('environmentMatchGlobs')
    expect(config.test).not.toHaveProperty('environmentMatchGlobs')
    expect(projectConfig('node')?.environment).toBe('node')
    expect(projectConfig('jsdom')?.environment).toBe('jsdom')
    expect(jsdomTestIncludes).toEqual([
      'electron/**/*.test.tsx',
      'src/**/*.test.tsx',
      'src/app/loaders*.test.ts',
      'src/theme/theme-applier.test.ts',
    ])
    // Subtracting the jsdom set from the node project is what keeps discovery
    // exhaustive without running any maintained test twice.
    for (const pattern of jsdomTestIncludes) {
      expect(projectConfig('node')?.exclude).toContain(pattern)
    }
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
