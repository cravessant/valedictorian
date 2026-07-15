import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  findLineLimitPolicyViolations,
  findRepositoryLineLimitPolicyViolations,
  readWorkingTreePolicyFiles,
} from './line-limit-policy'

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
      overrides: [
        {
          files: ['src/legacy.ts'],
          rules: { 'max-lines': 'off' },
        },
      ],
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

  it('guards normal lint and the staged pre-commit index', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    const lefthook = fs.readFileSync('lefthook.yml', 'utf8')

    expect(packageJson.scripts['lint:line-limit-policy']).toBe(
      'tsx scripts/line-limit-policy.ts',
    )
    expect(packageJson.scripts.lint).toContain('pnpm run lint:line-limit-policy')
    expect(lefthook).toContain('pnpm run lint:line-limit-policy -- --staged')
  })
})
