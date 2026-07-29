import fs from 'node:fs'
import { load as loadYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const configPath = '.github/dependabot.yml'
const expectedEcosystems = ['npm', 'github-actions']

type DependabotGroup = {
  patterns?: unknown
  'update-types'?: unknown
  'dependency-type'?: unknown
}

type DependabotUpdate = {
  'package-ecosystem'?: unknown
  directory?: unknown
  directories?: unknown
  schedule?: { interval?: unknown }
  'open-pull-requests-limit'?: unknown
  'target-branch'?: unknown
  groups?: Record<string, DependabotGroup>
  ignore?: unknown
  allow?: unknown
}

type DependabotConfig = {
  version?: unknown
  updates?: DependabotUpdate[]
}

function readConfig(): DependabotConfig {
  return loadYaml(fs.readFileSync(configPath, 'utf8')) as DependabotConfig
}

describe('Dependabot configuration contract', () => {
  it('declares schema version 2 with exactly the npm and github-actions ecosystems at the root', () => {
    const config = readConfig()
    const ecosystems = (config.updates ?? []).map((update) => update['package-ecosystem'])

    expect(config.version).toBe(2)
    expect(ecosystems).toStrictEqual(expectedEcosystems)
    expect(new Set(ecosystems).size).toBe(expectedEcosystems.length)
    // GitHub covers pnpm through the `npm` token; a literal `pnpm` token is rejected.
    expect(ecosystems).not.toContain('pnpm')

    for (const update of config.updates ?? []) {
      expect(update.directory).toBe('/')
      expect(update.directories).toBeUndefined()
    }
  })

  it('checks weekly, caps open version-update pull requests at three, and follows the default branch', () => {
    const config = readConfig()

    for (const update of config.updates ?? []) {
      expect(update.schedule?.interval).toBe('weekly')
      expect(update['open-pull-requests-limit']).toBe(3)
      // Omitting `target-branch` keeps Dependabot on the repository default branch
      // and keeps these options applying to security updates.
      expect(update).not.toHaveProperty('target-branch')
    }
  })

  it('groups only minor and patch updates behind one wildcard group per ecosystem', () => {
    const config = readConfig()

    for (const update of config.updates ?? []) {
      const groups = Object.entries(update.groups ?? {})

      expect(groups).toHaveLength(1)

      const [, group] = groups[0]

      expect(group.patterns).toStrictEqual(['*'])
      expect(group['update-types']).toStrictEqual(['minor', 'patch'])
      // `version-update:semver-*` is the ignore/allow spelling; groups reject it.
      for (const updateType of group['update-types'] as string[]) {
        expect(updateType).not.toContain('version-update:')
      }
    }
  })

  it('leaves major updates unsuppressed and unmerged', () => {
    const config = readConfig()

    for (const update of config.updates ?? []) {
      // Majors are unmatched by the wildcard group, so they must arrive as
      // individual pull requests rather than being filtered away.
      expect(update).not.toHaveProperty('ignore')
      expect(update).not.toHaveProperty('allow')
    }

    const workflows = fs
      .readdirSync('.github/workflows')
      .map((entry) => fs.readFileSync(`.github/workflows/${entry}`, 'utf8'))
      .join('\n')

    expect(workflows).not.toMatch(/dependabot/i)
    expect(workflows).not.toMatch(/(?:pr merge|enable-auto-merge|auto-?merge)/i)
  })
})
