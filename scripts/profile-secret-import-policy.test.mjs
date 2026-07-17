import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  findProfileSecretImportPolicyViolations,
  readWorkingTreePolicyFiles,
} from './profile-secret-import-policy.mjs'

describe('profile/secret import policy', () => {
  it('rejects forbidden concrete adapter imports outside composition modules', () => {
    expect(
      findProfileSecretImportPolicyViolations([
        {
          path: 'src/ipc/forbidden.ts',
          source: "import { createSqliteProfileStore } from '../modules/profile/profile.sqlite.store'\n",
        },
        {
          path: 'src/modules/connectors/forbidden.ts',
          source: "import { createSqliteSecretStore } from '../secrets/secret.sqlite.store'\n",
        },
        {
          path: 'src/app/forbidden.tsx',
          source:
            "import { createSqliteSensitiveProfileStore } from '../modules/profile/profile.sqlite.sensitive-store'\n",
        },
        {
          path: 'src/ipc/forbidden-reexport.ts',
          source:
            "export { createSqliteProfileStore } from '../modules/profile/profile.sqlite.store'\n",
        },
        {
          path: 'src/ipc/forbidden-star-export.ts',
          source: "export * from '../modules/profile/profile.sqlite.store'\n",
        },
        {
          path: 'src/ipc/forbidden-dynamic.ts',
          source:
            "const load = () => import('../modules/secrets/secret.sqlite.store')\n",
        },
        {
          path: 'electron/main.forbidden.ts',
          source:
            "import { createSqliteProfileStore } from '../src/modules/profile/profile.sqlite.store'\n",
        },
        {
          path: 'electron/preload.forbidden.ts',
          source:
            "export { createSqliteSecretStore } from '../src/modules/secrets/secret.sqlite.store'\n",
        },
        {
          path: 'electron/main.forbidden-dynamic.ts',
          source:
            "const load = () => import('../src/modules/profile/profile.sqlite.sensitive-store')\n",
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
      'src/ipc/forbidden.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/connectors/forbidden.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/app/forbidden.tsx: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/ipc/forbidden-reexport.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/ipc/forbidden-star-export.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/ipc/forbidden-dynamic.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'electron/main.forbidden.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'electron/preload.forbidden.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'electron/main.forbidden-dynamic.ts: concrete profile/secret adapters may only be imported from approved composition modules',
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
          path: 'src/modules/profile/profile.sqlite.store.ts',
          source:
            "import { createSqliteSensitiveProfileStore } from './profile.sqlite.sensitive-store'\n",
        },
        {
          path: 'src/modules/profile/profile.sqlite.sensitive-store.ts',
          source: "import { createSqliteProfileStore } from './profile.sqlite.store'\n",
        },
        {
          path: 'src/modules/secrets/secret.sqlite.store.ts',
          source: "import { createSqliteProfileStore } from '../profile/profile.sqlite.store'\n",
        },
        {
          path: 'src/modules/profile/profile.sqlite.store.test.ts',
          source:
            "import { createSqliteSensitiveProfileStore } from './profile.sqlite.sensitive-store'\n",
        },
        {
          path: 'src/modules/profile/profile.sqlite.sensitive-store.test.ts',
          source: "import { createSqliteProfileStore } from './profile.sqlite.store'\n",
        },
        {
          path: 'src/modules/secrets/secret.sqlite.store.test.ts',
          source: "import { createSqliteProfileStore } from '../profile/profile.sqlite.store'\n",
        },
        {
          path: 'src/modules/profile/profile.sqlite.store.test.ts',
          source: "import { createJsonProfileStore } from './profile.json.store'\n",
        },
        {
          path: 'src/modules/profile/profile.json.document.ts',
          source: "import { createSqliteProfileStore } from './profile.sqlite.store'\n",
        },
        {
          path: 'src/modules/profile/profile.json.atomic.ts',
          source: "import { createSqliteSecretStore } from '../secrets/secret.sqlite.store'\n",
        },
      ]),
    ).toEqual([
      'src/modules/profile/profile.sqlite.store.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.sqlite.sensitive-store.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/secrets/secret.sqlite.store.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.sqlite.store.test.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.sqlite.sensitive-store.test.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/secrets/secret.sqlite.store.test.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.sqlite.store.test.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.json.document.ts: concrete profile/secret adapters may only be imported from approved composition modules',
      'src/modules/profile/profile.json.atomic.ts: concrete profile/secret adapters may only be imported from approved composition modules',
    ])
  })

  it('allows approved composition modules, adapter tests, and unrelated mentions', () => {
    expect(
      findProfileSecretImportPolicyViolations([
        {
          path: 'src/modules/profile/profile.composition.ts',
          source:
            "import { createSqliteProfileStore } from './profile.sqlite.store'\nimport { createJsonProfileStore } from './profile.json.store'\n",
        },
        {
          path: 'src/modules/secrets/secret.composition.ts',
          source: "import { createSqliteSecretStore } from './secret.sqlite.store'\n",
        },
        {
          path: 'src/modules/profile/profile.sqlite.store.test.ts',
          source: "import { createSqliteProfileStore } from './profile.sqlite.store'\n",
        },
        {
          path: 'src/modules/profile/profile.sqlite.sensitive-store.test.ts',
          source:
            "import { createSqliteSensitiveProfileStore } from './profile.sqlite.sensitive-store'\n",
        },
        {
          path: 'src/modules/secrets/secret.sqlite.store.test.ts',
          source: "import { createSqliteSecretStore } from './secret.sqlite.store'\n",
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
          path: 'src/modules/profile/docs.ts',
          source:
            "export function describeAdapter() {\n  return 'use profile.sqlite.store via composition'\n}\n",
        },
        {
          path: 'src/app/unrelated.ts',
          source:
            "export function createSqliteProfileStoreName() {\n  return 'createSqliteProfileStore'\n}\n",
        },
        {
          path: 'electron/main.ts',
          source:
            "export function note() {\n  return 'compose via profile.composition, not profile.sqlite.store'\n}\n",
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
  })
})
