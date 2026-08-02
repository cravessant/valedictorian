import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findCliCompositionViolations,
  findCliDependencyViolations,
  readCliCompositionState,
} from './cli-workspace-composition-policy.mjs'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { force: true, recursive: true })
})

describe('CLI workspace composition policy', () => {
  it('uses only the imported workspace source and exact approved MIT metadata', () => {
    expect(findCliCompositionViolations(readCliCompositionState())).toEqual([])
  })

  it('rejects direct desktop, persistence, and escaping source imports', () => {
    const attacks = [
      "import 'electron'\n",
      "import '@sparxie/valedictorian-local-runtime/workspace-runtime'\n",
      "import '@electric-sql/pglite'\n",
      "import 'drizzle-orm'\n",
      "import '../../../../electron/main.js'\n",
      "import '@/db/schema'\n",
    ]
    for (const source of attacks) {
      const fixture = dependencyFixture(source)
      expect(findCliDependencyViolations(fixture.root, fixture.packageJson)).not.toEqual([])
    }
  })

  it('rejects a vendored copy, external lock resolution, and wrong installed source', () => {
    const state = readCliCompositionState()
    const wrongPath = path.join(state.root, 'packages', 'local-runtime')
    const lockAttack = structuredClone(state)
    const lockfile = lockAttack.lockfile as {
      importers: Record<string, {
        devDependencies: Record<string, { specifier: string; version: string }>
      }>
    }
    lockfile.importers['.'].devDependencies['@sparxie/valedictorian-cli'] = {
      specifier: 'file:vendor/valedictorian-cli',
      version: 'file:vendor/valedictorian-cli',
    }
    expect(findCliCompositionViolations({ ...state, installedCliPath: wrongPath })).not.toEqual([])
    expect(findCliCompositionViolations(lockAttack)).not.toEqual([])
  })
})

function dependencyFixture(source: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-dependency-policy-'))
  temporaryRoots.push(root)
  const sourceRoot = path.join(root, 'packages', 'cli', 'src')
  fs.mkdirSync(sourceRoot, { recursive: true })
  fs.writeFileSync(path.join(sourceRoot, 'attack.ts'), source)
  return {
    packageJson: { dependencies: {}, devDependencies: {} },
    root,
  }
}
