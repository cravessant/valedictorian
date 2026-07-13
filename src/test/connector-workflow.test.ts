import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
}

function readWorkflow(name: string) {
  return fs.readFileSync(path.resolve('.github/workflows', name), 'utf8')
}

describe('connector workflow dependencies', () => {
  it('adopts the released progress and destination-projection contracts exactly', () => {
    const packageJson = readPackageJson()

    expect(packageJson.dependencies['@sparxie/valedictorian-connectors-jobright']).toBe('0.11.0')
    expect(packageJson.devDependencies['@sparxie/valedictorian-connectors-core']).toBe('0.11.0')
    expect(packageJson.dependencies.sparxie).toBe('0.21.0')
  })

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
