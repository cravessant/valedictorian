import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readWorkflow(name: string) {
  return fs.readFileSync(path.resolve('.github/workflows', name), 'utf8')
}

describe('connector workflow dependencies', () => {
  it.each(['ci.yml', 'release-mac.yml'])(
    'validates connector repo access before checkout in %s',
    (workflowName) => {
      const workflow = readWorkflow(workflowName)
      const validationIndex = workflow.indexOf('Validate connector repo access token')
      const checkoutIndex = workflow.indexOf('Check out connector packages')

      expect(validationIndex).toBeGreaterThan(-1)
      expect(checkoutIndex).toBeGreaterThan(-1)
      expect(validationIndex).toBeLessThan(checkoutIndex)
      expect(workflow).toContain('CONNECTORS_REPO_TOKEN: ${{ secrets.CONNECTORS_REPO_TOKEN }}')
      expect(workflow).toContain('CONNECTORS_REPO_TOKEN is required to check out KennyKeni/valedictorian-connectors')
    },
  )
})
