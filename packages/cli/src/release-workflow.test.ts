import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ciWorkflowPath = path.resolve('.github/workflows/ci.yml')
const releaseWorkflowPath = path.resolve('.github/workflows/release-cli.yml')
const publishWorkflowPath = path.resolve('.github/workflows/publish.yml')
const readmePath = path.resolve('README.md')
const skillPath = path.resolve('skills/valedictorian-cli/SKILL.md')
const commandReferencePath = path.resolve('skills/valedictorian-cli/references/commands.md')

describe('CLI release workflow', () => {
  it('opts JavaScript actions into Node 24 for CI', () => {
    expect(fs.existsSync(ciWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(ciWorkflowPath, 'utf8')

    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('pnpm/action-setup@v6')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('pnpm build')
  })

  it('does not create a separate GitHub tarball release workflow', () => {
    expect(fs.existsSync(releaseWorkflowPath)).toBe(false)
  })

  it('publishes the CLI package to npm from the private repository', () => {
    expect(fs.existsSync(publishWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(publishWorkflowPath, 'utf8')

    expect(workflow).not.toContain('workflow_dispatch:')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*.*.*'")
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain('actions/checkout@v6')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('registry-url: https://registry.npmjs.org')
    expect(workflow).toContain('corepack enable')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('Verify release tag')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm build')
    expect(workflow).toContain('npm pack --dry-run')
    expect(workflow).toContain('Resolve npm dist-tag')
    expect(workflow).toContain('packageJson.version.match(/-(alpha|beta|rc)\\./)')
    expect(workflow).toContain('NPM_DIST_TAG')
    expect(workflow).toContain('publish_args=(publish --access public)')
    expect(workflow).not.toContain('--provenance')
    expect(workflow).toContain('publish_args+=(--tag "$NPM_DIST_TAG")')
  })

  it('documents the alpha install tag and explicit workspace commands', () => {
    const readme = fs.readFileSync(readmePath, 'utf8')
    const skill = fs.readFileSync(skillPath, 'utf8')
    const commandReference = fs.readFileSync(commandReferencePath, 'utf8')

    expect(readme).toContain(
      'pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g valedictorian-cli@alpha',
    )
    expect(readme).toContain('valedictorian-cli --json workspaces list')
    expect(readme).toContain('applications list --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(readme).toContain('profile get --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(readme).toContain('profile validate --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(readme).toContain('profile format --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(readme).toContain('profile restore --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(readme).not.toContain('profile sensitive')
    expect(readme).toContain('## Project config discovery')
    expect(readme).toContain('valedictorian.config.json')
    expect(readme).toContain('Do not store API tokens, OAuth tokens, passwords, or client secrets in project config.')
    expect(skill).toContain(
      'pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g valedictorian-cli@alpha',
    )
    expect(skill).toContain('Workspace-scoped commands require `--workspace <id-or-name>`')
    expect(skill).toMatch(/(?:^|[^/])secrets upsert <key>/m)
    expect(skill).toContain('secrets run')
    expect(skill).toContain('profile validate')
    expect(skill).toContain('profile format')
    expect(skill).toContain('profile restore')
    expect(skill).not.toContain('profile sensitive')
    expect(skill).not.toContain('profile secrets')
    expect(commandReference).toContain(
      'pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g valedictorian-cli@alpha',
    )
    expect(commandReference).toContain('export VALEDICTORIAN_WORKSPACE=workspace-id-or-name')
    expect(commandReference).toContain('## Profile And Secrets')
    expect(commandReference).toContain('profile validate --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(commandReference).toContain('profile format --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(commandReference).toContain('profile restore --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(commandReference).not.toContain('profile sensitive')
    expect(commandReference).not.toContain('profile secrets')
    expect(commandReference).toContain('secrets list --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(commandReference).toContain('secrets run --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(commandReference).toContain('secret://')
    expect(commandReference).toContain('reduces accidental disclosure')
    expect(commandReference).toContain('SSN and credential values stay on the secret path, not the ordinary document')
    expect(readme).toContain('secrets list --workspace "$VALEDICTORIAN_WORKSPACE"')
    expect(readme).not.toContain('profile secrets')
    expect(readme).toContain('secrets run')
    expect(commandReference).toContain('sourcing ingest \\')
    expect(commandReference).not.toContain('sourcing findings create')
    expect(commandReference).toContain('--workspace "$VALEDICTORIAN_WORKSPACE"')
  })
})
