import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findLineLimitPolicyViolations,
  findRepositoryLineLimitPolicyViolations,
  readWorkingTreePolicyFiles,
} from './line-limit-policy.mjs'
import {
  createStagedPolicyRepository,
  removeStagedPolicyRepository,
} from './staged-policy-repository.fixture.mjs'

describe('line-limit policy', () => {
  it('rejects a max-lines disable in maintained source', () => {
    const directive = ['eslint', 'disable max-lines'].join('-')

    expect(
      findLineLimitPolicyViolations([
        {
          path: 'src/oversized.ts',
          source: `/* ${directive} */\nexport const value = 1\n`,
        },
      ]),
    ).toEqual([
      'src/oversized.ts: max-lines disable directives are forbidden in maintained code',
    ])
  })

  it('rejects per-file max-lines configuration overrides', () => {
    const config = {
      rules: {
        'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }],
      },
      overrides: [{ files: ['src/legacy.ts'], rules: { 'max-lines': 'off' } }],
    }

    expect(
      findLineLimitPolicyViolations([
        { path: '.oxlintrc.json', source: JSON.stringify(config) },
      ]),
    ).toEqual([
      '.oxlintrc.json: max-lines must be one global 1,000-line rule without overrides',
    ])
  })

  it('rejects max-lines rules in nested lint configuration', () => {
    expect(
      findLineLimitPolicyViolations([
        {
          path: 'src/legacy/.oxlintrc.json',
          source: JSON.stringify({ rules: { 'max-lines': 'off' } }),
        },
      ]),
    ).toEqual([
      'src/legacy/.oxlintrc.json: nested max-lines configuration is forbidden',
    ])
  })

  it('requires the global line-limit configuration', () => {
    expect(findRepositoryLineLimitPolicyViolations([])).toEqual([
      '.oxlintrc.json: required global line-limit configuration is missing',
    ])
  })

  it('keeps generated-code exemptions exact', () => {
    const directive = ['oxlint', 'disable max-lines'].join('-')

    expect(
      findLineLimitPolicyViolations(
        [
          { path: 'generated/client.ts', source: `/* ${directive} */` },
          { path: 'generated/client-helper.ts', source: `/* ${directive} */` },
        ],
        new Set(['generated/client.ts']),
      ),
    ).toEqual([
      'generated/client-helper.ts: max-lines disable directives are forbidden in maintained code',
    ])
  })

  it('accepts the repository line-limit policy', () => {
    expect(findRepositoryLineLimitPolicyViolations(readWorkingTreePolicyFiles())).toEqual([])
  })

  it('guards full lint, CI, and the staged pre-commit index', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const lefthook = fs.readFileSync('lefthook.yml', 'utf8')
    const ciWorkflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8')

    expect(packageJson.scripts['lint:line-limit-policy']).toBe(
      'node scripts/line-limit-policy.mjs',
    )
    expect(packageJson.scripts.lint).toContain('pnpm run lint:line-limit-policy')
    expect(lefthook).toContain('pnpm run lint:line-limit-policy -- --staged')
    expect(lefthook).toContain('*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}')
    expect(ciWorkflow).toContain('run: pnpm lint')
  })
})

const policyScriptPath = path.resolve('scripts/line-limit-policy.mjs')
const validRootConfig = JSON.stringify({
  rules: { 'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }] },
})
const disableDirective = ['oxlint', 'disable max-lines'].join('-')
const violatingSource = `/* ${disableDirective} */\nexport const value = 1\n`
const cleanSource = 'export const value = 1\n'

describe('line-limit policy staged selection', () => {
  /** @type {ReturnType<typeof createStagedPolicyRepository> | undefined} */
  let repository

  afterEach(() => {
    removeStagedPolicyRepository(repository)
    repository = undefined
  })

  it('ignores tracked violations the commit does not touch', () => {
    repository = createStagedPolicyRepository({
      '.oxlintrc.json': validRootConfig,
      'src/pre-existing.ts': violatingSource,
    })
    repository.write('src/added.ts', cleanSource)
    repository.git('add', 'src/added.ts')

    expect(repository.runStagedPolicy(policyScriptPath)).toEqual({ status: 0, stderr: '' })
  })

  it('rejects a violation introduced by the staged change', () => {
    repository = createStagedPolicyRepository({ '.oxlintrc.json': validRootConfig })
    repository.write('src/added.ts', violatingSource)
    repository.git('add', 'src/added.ts')

    const result = repository.runStagedPolicy(policyScriptPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'src/added.ts: max-lines disable directives are forbidden in maintained code',
    )
  })

  it('passes when no staged path matches the policy', () => {
    repository = createStagedPolicyRepository({ '.oxlintrc.json': validRootConfig })
    repository.write('docs/notes.md', '# notes\n')
    repository.git('add', 'docs/notes.md')

    expect(repository.runStagedPolicy(policyScriptPath)).toEqual({ status: 0, stderr: '' })
  })

  it('reads staged content rather than the partially staged working tree', () => {
    repository = createStagedPolicyRepository({ '.oxlintrc.json': validRootConfig })
    repository.write('src/partial.ts', cleanSource)
    repository.git('add', 'src/partial.ts')
    repository.write('src/partial.ts', violatingSource)

    expect(repository.runStagedPolicy(policyScriptPath)).toEqual({ status: 0, stderr: '' })
  })

  it('inspects paths containing spaces, quotes, and newlines', () => {
    const awkwardPath = 'src/od d "quoted"\nname.ts'
    repository = createStagedPolicyRepository({ '.oxlintrc.json': validRootConfig })
    repository.write(awkwardPath, violatingSource)
    repository.git('add', awkwardPath)

    const result = repository.runStagedPolicy(policyScriptPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `${awkwardPath}: max-lines disable directives are forbidden in maintained code`,
    )
  })

  it('checks a renamed file under its new path', () => {
    repository = createStagedPolicyRepository({
      '.oxlintrc.json': validRootConfig,
      'src/original.ts': violatingSource,
    })
    repository.git('mv', 'src/original.ts', 'src/renamed.ts')

    const result = repository.runStagedPolicy(policyScriptPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'src/renamed.ts: max-lines disable directives are forbidden in maintained code',
    )
  })

  it('still requires the root configuration when the commit deletes it', () => {
    repository = createStagedPolicyRepository({ '.oxlintrc.json': validRootConfig })
    repository.git('rm', '--quiet', '.oxlintrc.json')

    const result = repository.runStagedPolicy(policyScriptPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '.oxlintrc.json: required global line-limit configuration is missing',
    )
  })

  it('reads the root configuration from the index, not the working tree', () => {
    repository = createStagedPolicyRepository({ '.oxlintrc.json': validRootConfig })
    repository.write('.oxlintrc.json', JSON.stringify({ rules: { 'max-lines': 'off' } }))

    expect(repository.runStagedPolicy(policyScriptPath)).toEqual({ status: 0, stderr: '' })

    repository.git('add', '.oxlintrc.json')
    const result = repository.runStagedPolicy(policyScriptPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '.oxlintrc.json: max-lines must be one global 1,000-line rule without overrides',
    )
  })
})
