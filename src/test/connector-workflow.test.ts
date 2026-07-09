import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readWorkflow(name: string) {
  return fs.readFileSync(path.resolve('.github/workflows', name), 'utf8')
}

describe('connector workflow dependencies', () => {
  it.each(['ci.yml', 'release-mac.yml'])(
    'installs published connector packages without a private repo checkout in %s',
    (workflowName) => {
      const workflow = readWorkflow(workflowName)

      expect(workflow).toContain('pnpm install --frozen-lockfile')
      expect(workflow).not.toContain('CONNECTORS_REPO_TOKEN')
      expect(workflow).not.toContain('KennyKeni/valedictorian-connectors')
      expect(workflow).not.toContain('Check out connector packages')
    },
  )
})
