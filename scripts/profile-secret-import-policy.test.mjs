import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findProfileSecretImportPolicyViolations,
  readWorkingTreePolicyFiles,
} from './profile-secret-import-policy.mjs'
import {
  createStagedPolicyRepository,
  removeStagedPolicyRepository,
} from './staged-policy-repository.fixture.mjs'

describe('profile/secret import policy', () => {
  it('rejects forbidden concrete adapter imports outside composition modules', () => {
    expect(
      findProfileSecretImportPolicyViolations([
        {
          path: 'src/settings/SettingsPage.forbidden.ts',
          source: "import { createFileAppSecretStore } from './app-secret.store'\n",
        },
        {
          path: 'src/modules/connectors/forbidden.ts',
          source: "import { createPgliteSecretStore } from '../secrets/secret.pglite.store'\n",
        },
        {
          path: 'src/ipc/forbidden-dynamic.ts',
          source:
            "const load = () => import('../modules/secrets/secret.pglite.store')\n",
        },
        {
          path: 'electron/preload.forbidden.ts',
          source:
            "export { createPgliteSecretStore } from '../src/modules/secrets/secret.pglite.store'\n",
        },
        {
          path: 'src/server/forbidden-json.ts',
          source: "import { createJsonProfileStore } from '../modules/profile/profile.json.store'\n",
        },
        {
          path: 'src/ipc/forbidden-json-helper.ts',
          source: "import { parseProfileJsonDocument } from '../modules/profile/profile.json.document'\n",
        },
        {
          path: 'electron/main.forbidden-json.ts',
          source:
            "import { createJsonProfileStore } from '../src/modules/profile/profile.json.store'\n",
        },
        {
          path: 'src/ipc/forbidden-json-multiline.ts',
          source: `import {
  parseProfileJsonDocument,
} from '../modules/profile/profile.json.document'
`,
        },
        {
          path: 'src/app/forbidden-json-js-ext.ts',
          source:
            "import { createJsonProfileStore } from '../modules/profile/profile.json.store.js'\n",
        },
        {
          path: 'electron/main.forbidden-json-js-reexport.ts',
          source:
            "export { writeProfileJsonAtomically } from '../src/modules/profile/profile.json.atomic.js'\n",
        },
        {
          path: 'src/server/forbidden-json-js-dynamic.ts',
          source:
            "const load = () => import('../modules/profile/profile.json.lock.js')\n",
        },
      ]),
    ).toEqual([
      'src/settings/SettingsPage.forbidden.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/connectors/forbidden.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/ipc/forbidden-dynamic.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'electron/preload.forbidden.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/server/forbidden-json.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/ipc/forbidden-json-helper.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'electron/main.forbidden-json.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/ipc/forbidden-json-multiline.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/app/forbidden-json-js-ext.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'electron/main.forbidden-json-js-reexport.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/server/forbidden-json-js-dynamic.ts: concrete profile/secret adapters may only be imported from approved composition modules',
    ])
  })

  it('rejects cross-adapter concrete imports and non-subject adapter test imports', () => {
    expect(
      findProfileSecretImportPolicyViolations([
        {
          path: 'src/modules/secrets/secret.pglite.store.ts',
          source: "import { createFileAppSecretStore } from '../../../settings/app-secret.store'\n",
        },
        {
          path: 'src/modules/secrets/secret.pglite.store.test.ts',
          source: "import { createFileAppSecretStore } from '../../../settings/app-secret.store'\n",
        },
        {
          path: 'src/modules/profile/profile.json.document.ts',
          source: "import { createPgliteSecretStore } from '../secrets/secret.pglite.store'\n",
        },
        {
          path: 'src/modules/profile/profile.json.atomic.ts',
          source: "import { createPgliteSecretStore } from '../secrets/secret.pglite.store'\n",
        },
      ]),
    ).toEqual([
      'src/modules/secrets/secret.pglite.store.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/secrets/secret.pglite.store.test.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.json.document.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.json.atomic.ts: concrete profile/secret adapters may only be imported from approved composition modules',
    ])
  })

  it('allows approved composition modules, adapter tests, and unrelated mentions', () => {
    expect(
      findProfileSecretImportPolicyViolations([
        {
          path: 'src/modules/profile/profile.composition.ts',
          source: "import { createJsonProfileStore } from './profile.json.store'\n",
        },
        {
          path: 'src/modules/profile/profile.composition.test.ts',
          source: "import { serializeProfileJsonDocument } from './profile.json.document'\n",
        },
        {
          path: 'src/modules/secrets/secret.composition.ts',
          source: "import { createPgliteSecretStore } from './secret.pglite.store'\n",
        },
        {
          path: 'src/settings/app-secret.composition.ts',
          source: "import { createFileAppSecretStore } from './app-secret.store'\n",
        },
        {
          path: 'src/settings/app-secret.store.test.ts',
          source: "import { createFileAppSecretStore } from './app-secret.store'\n",
        },
        {
          path: 'src/modules/secrets/secret.pglite.store.test.ts',
          source: "import { createPgliteSecretStore } from './secret.pglite.store'\n",
        },
        {
          path: 'src/modules/profile/profile.json.store.ts',
          source:
            "import { parseProfileJsonDocument } from './profile.json.document'\nimport { withProfileJsonLock } from './profile.json.lock'\n",
        },
        {
          path: 'src/modules/profile/profile.json.store.test.ts',
          source:
            "import { createJsonProfileStore } from './profile.json.store'\nimport { serializeProfileJsonDocument } from './profile.json.document'\n",
        },
        {
          path: 'src/modules/profile/profile.json.document.test.ts',
          source: "import { parseProfileJsonDocument } from './profile.json.document'\n",
        },
        {
          path: 'src/app/unrelated.ts',
          source: "export function adapterName() {\n  return 'profile store'\n}\n",
        },
        {
          path: 'electron/main.ts',
          source: "export function note() {\n  return 'compose via profile.composition'\n}\n",
        },
      ]),
    ).toEqual([])
  })

  it('accepts the repository import graph', () => {
    expect(findProfileSecretImportPolicyViolations(readWorkingTreePolicyFiles())).toEqual([])
  })

  it('is wired into package lint and lefthook', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const lefthook = fs.readFileSync('lefthook.yml', 'utf8')

    expect(packageJson.scripts['lint:profile-secret-import-policy']).toBe(
      'node scripts/profile-secret-import-policy.mjs',
    )
    expect(packageJson.scripts.lint).toContain('pnpm run lint:profile-secret-import-policy')
    expect(lefthook).toContain('pnpm run lint:profile-secret-import-policy -- --staged')
    expect(lefthook).toMatch(
      /profile-secret-import-policy:\n\s+glob: "\*\.\{js,jsx,mjs,cjs,ts,tsx,mts,cts\}"/,
    )
  })
})

const policyScriptPath = path.resolve('scripts/profile-secret-import-policy.mjs')
const forbiddenSource = "import { createFileAppSecretStore } from './app-secret.store'\n"
const cleanSource = 'export const value = 1\n'
const forbiddenMessage =
  'concrete profile/secret adapters may only be imported from approved composition modules'

describe('profile/secret import policy staged selection', () => {
  /** @type {ReturnType<typeof createStagedPolicyRepository> | undefined} */
  let repository

  afterEach(() => {
    removeStagedPolicyRepository(repository)
    repository = undefined
  })

  it('ignores tracked violations the commit does not touch', () => {
    repository = createStagedPolicyRepository({ 'src/pre-existing.ts': forbiddenSource })
    repository.write('src/added.ts', cleanSource)
    repository.git('add', 'src/added.ts')

    expect(repository.runStagedPolicy(policyScriptPath)).toEqual({ status: 0, stderr: '' })
  })

  it('rejects a violation introduced by the staged change', () => {
    repository = createStagedPolicyRepository({ 'src/kept.ts': cleanSource })
    repository.write('src/added.ts', forbiddenSource)
    repository.git('add', 'src/added.ts')

    const result = repository.runStagedPolicy(policyScriptPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`src/added.ts: ${forbiddenMessage}`)
  })

  it('passes when no staged path matches the policy', () => {
    repository = createStagedPolicyRepository({ 'src/kept.ts': cleanSource })
    repository.write('docs/notes.md', '# notes\n')
    repository.git('add', 'docs/notes.md')

    expect(repository.runStagedPolicy(policyScriptPath)).toEqual({ status: 0, stderr: '' })
  })

  it('reads staged content rather than the partially staged working tree', () => {
    repository = createStagedPolicyRepository({ 'src/kept.ts': cleanSource })
    repository.write('src/partial.ts', cleanSource)
    repository.git('add', 'src/partial.ts')
    repository.write('src/partial.ts', forbiddenSource)

    expect(repository.runStagedPolicy(policyScriptPath)).toEqual({ status: 0, stderr: '' })
  })

  it('inspects paths containing spaces, quotes, and newlines', () => {
    const awkwardPath = 'src/od d "quoted"\nname.ts'
    repository = createStagedPolicyRepository({ 'src/kept.ts': cleanSource })
    repository.write(awkwardPath, forbiddenSource)
    repository.git('add', awkwardPath)

    const result = repository.runStagedPolicy(policyScriptPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`${awkwardPath}: ${forbiddenMessage}`)
  })
})
