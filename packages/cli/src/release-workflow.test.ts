import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  promoteCaptureToJobInputSchema,
  promoteJobToOpportunityInputSchema,
  promoteOpportunityToApplicationInputSchema,
} from '@sparxie/sdk'

const ciWorkflowPath = path.resolve('.github/workflows/ci.yml')
const releaseWorkflowPath = path.resolve('.github/workflows/release-cli.yml')
const publishWorkflowPath = path.resolve('.github/workflows/publish.yml')
const readmePath = path.resolve('README.md')
const skillPath = path.resolve('skills/valedictorian-cli/SKILL.md')
const lifecycleReferencePath = path.resolve('skills/valedictorian-cli/references/lifecycle.md')
const promotionPayloadsPath = path.resolve('skills/valedictorian-cli/references/promotion-payloads.md')
const commandReferencePath = path.resolve('skills/valedictorian-cli/references/commands.md')
const applicationSkillPath = path.resolve('skills/valedictorian-application-agent/SKILL.md')
const receiptsReferencePath = path.resolve(
  'skills/valedictorian-application-agent/references/receipts-and-audit.md',
)

describe('CLI release workflow', () => {
  it('opts JavaScript actions into Node 24 for CI', () => {
    expect(fs.existsSync(ciWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(ciWorkflowPath, 'utf8')

    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain(
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
    )
    expect(workflow).toContain(
      'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6',
    )
    expect(workflow).toContain(
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
    )
    expect(workflow).toContain('pnpm --filter @sparxie/valedictorian-cli run test')
    expect(workflow).toContain('pnpm --filter @sparxie/valedictorian-cli run lint')
    expect(workflow).toContain('pnpm --filter @sparxie/valedictorian-cli run build')
    expect(workflow).toContain(
      'types: [opened, reopened, synchronize, ready_for_review, converted_to_draft]',
    )
    expect(workflow).toContain("github.event.pull_request.draft == false")
  })

  it('does not create a separate GitHub tarball release workflow', () => {
    expect(fs.existsSync(releaseWorkflowPath)).toBe(false)
  })

  it('prepares the CLI package for npm publication from the product repository', () => {
    expect(fs.existsSync(publishWorkflowPath)).toBe(true)

    const workflow = fs.readFileSync(publishWorkflowPath, 'utf8')

    expect(workflow).not.toContain('workflow_dispatch:')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*.*.*'")
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true')
    expect(workflow).toContain(
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
    )
    expect(workflow).toContain(
      'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6',
    )
    expect(workflow).toContain(
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
    )
    expect(workflow).toContain('registry-url: https://registry.npmjs.org')
    expect(workflow).not.toContain('corepack enable')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('Verify release tag')
    expect(workflow).toContain('pnpm --filter @sparxie/valedictorian-cli run lint')
    expect(workflow).toContain('pnpm --filter @sparxie/valedictorian-cli run test')
    expect(workflow).toContain('pnpm --filter @sparxie/valedictorian-cli run build')
    expect(workflow).toContain('pnpm --dir packages/cli pack --dry-run')
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
    const lifecycleReference = fs.readFileSync(lifecycleReferencePath, 'utf8')
    const commandReference = fs.readFileSync(commandReferencePath, 'utf8')
    const applicationSkill = fs.readFileSync(applicationSkillPath, 'utf8')
    const receiptsReference = fs.readFileSync(receiptsReferencePath, 'utf8')

    expect(readme).toContain(
      'pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g @sparxie/valedictorian-cli@alpha',
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
      'pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g @sparxie/valedictorian-cli@alpha',
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
      'pnpm --registry=https://registry.npmjs.org/ --config.minimumReleaseAge=0 add -g @sparxie/valedictorian-cli@alpha',
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
    expect(readme).toContain('captures create \\')
    expect(readme).toContain('`correct-facts`')
    expect(readme).toContain('npx --yes skills add cravessant/valedictorian')
    expect(skill).toContain('## Lifecycle Model')
    expect(skill).toContain('captures promote-to-job')
    expect(skill).toContain('jobs promote-to-opportunity')
    expect(skill).toContain('opportunities promote-to-application')
    expect(lifecycleReference).toContain('## Promotion Protocol')
    expect(lifecycleReference).toContain('deterministic_duplicate')
    expect(lifecycleReference).toContain('After Opportunity → Application')
    expect(applicationSkill).toContain('attempts list')
    expect(applicationSkill).toContain('events list')
    expect(applicationSkill).toContain('runs start|step|complete')
    expect(applicationSkill).toContain('applications update-status')
    expect(receiptsReference).toContain('runs step <run-id>')
    expect(receiptsReference).toContain('applications update-status <application-id>')
    expect(`${applicationSkill}\n${receiptsReference}`).not.toMatch(
      /applications attempts (?:start|step|complete)/,
    )
    expect(commandReference).toContain('--workspace "$VALEDICTORIAN_WORKSPACE"')
  })

  it('keeps documented promotion payloads aligned with the client contract', () => {
    const reference = fs.readFileSync(promotionPayloadsPath, 'utf8')
    const payloads = [...reference.matchAll(/```json\n([\s\S]*?)\n```/g)]
      .map((match) => JSON.parse(match[1] ?? ''))
    const jobId = '018f0f2e-7b16-7a01-8c8c-20c6a9d52301'

    expect(payloads).toHaveLength(3)
    expect(() => promoteCaptureToJobInputSchema.parse({
      ...payloads[0],
      captureId: 'capture-1',
    })).not.toThrow()
    expect(() => promoteJobToOpportunityInputSchema.parse({
      ...payloads[1],
      jobId,
    })).not.toThrow()
    expect(() => promoteOpportunityToApplicationInputSchema.parse({
      ...payloads[2],
      opportunityId: 'opportunity-1',
    })).not.toThrow()
  })
})
