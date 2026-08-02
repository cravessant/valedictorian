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
      'packages/connector-api/**/*.test.{ts,tsx}',
      'packages/connector-testkit/**/*.test.{ts,tsx}',
      'packages/local-runtime/**/*.test.{ts,tsx}',
      'packages/workspace/**/*.test.{ts,tsx}',
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

  it('keeps the standalone CLI package outside app test ownership', () => {
    expect(maintainedTestIncludes).toEqual(
      expect.not.arrayContaining(['packages/**/*.test.{ts,tsx}']),
    )
    expect(maintainedTestIncludes.some((pattern) => pattern.includes('packages/cli'))).toBe(false)

    const testsProjectSource = fs.readFileSync(path.resolve('tsconfig.tests.json'), 'utf8')
    expect(testsProjectSource).toContain('packages/connector-api')
    expect(testsProjectSource).toContain('packages/connector-testkit')
    expect(testsProjectSource).toContain('packages/local-runtime')
    expect(testsProjectSource).toContain('packages/workspace')
    expect(testsProjectSource).not.toContain('"packages",')
    expect(testsProjectSource).not.toContain('packages/cli')

    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const lintScript = packageJson.scripts?.lint ?? ''
    expect(lintScript).toContain(
      'oxlint electron packages/connector-api packages/connector-testkit packages/local-runtime packages/workspace/server packages/workspace/client packages/workspace/conformance scripts src vite.config.ts',
    )
    expect(lintScript).not.toContain('oxlint .')
    expect(lintScript).not.toContain('packages/cli')
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

  it('builds package dependency declarations before every test entrypoint', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const localRuntimePackage = JSON.parse(
      fs.readFileSync(path.resolve('packages/local-runtime/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const workspaceServerPackage = JSON.parse(
      fs.readFileSync(path.resolve('packages/workspace/server/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const workflow = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8')

    expect(packageJson.scripts?.['build:connector-packages']).toContain(
      '@sparxie/valedictorian-connectors-core',
    )
    expect(packageJson.scripts?.['build:connector-packages']).toContain(
      '@sparxie/valedictorian-connectors-test-harness',
    )
    const dependencyBuild = packageJson.scripts?.['build:dependency-packages'] ?? ''
    expect(packageJson.scripts?.pretest).toBe('pnpm run build:dependency-packages')
    expect(packageJson.scripts?.['pretest:watch']).toBe('pnpm run build:dependency-packages')
    expect(packageJson.scripts?.['pretypecheck:tests']).toBe(
      'pnpm run build:dependency-packages',
    )
    expect(dependencyBuild).toBe(
      'pnpm run build:connector-packages && pnpm run build:workspace-server-package && pnpm --filter @sparxie/valedictorian-local-runtime run build:package && pnpm run build:workspace-dependent-packages',
    )
    expect(packageJson.scripts?.pretypecheck).toBe('pnpm run build:local-runtime-package')
    expect(localRuntimePackage.scripts?.build).toBe(
      'pnpm --filter @sparxie/valedictorian-workspace-server run build && pnpm run build:package',
    )
    expect(workspaceServerPackage.scripts?.build).not.toContain(
      '@sparxie/valedictorian-local-runtime',
    )
    expect(workflow.indexOf('pnpm run build:dependency-packages')).toBeGreaterThan(-1)
    expect(workflow.indexOf('pnpm exec vitest run --shard')).toBeGreaterThan(
      workflow.indexOf('pnpm run build:dependency-packages'),
    )
  })
})
