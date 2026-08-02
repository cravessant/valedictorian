import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const typescriptPath = path.join(repositoryRoot, 'node_modules/typescript/bin/tsc')

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(`${error.message}\n${String(error.stdout ?? '')}\n${String(error.stderr ?? '')}`)
  }
}

describe('workspace client package contract', () => {
  it('packs only declared runtime files and installs in a disposable consumer', { timeout: 120_000 }, () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-client-consumer-'))
    try {
      const packageRoots = {
        server: path.join(repositoryRoot, 'packages/workspace/server'),
        client: path.join(repositoryRoot, 'packages/workspace/client'),
        conformance: path.join(repositoryRoot, 'packages/workspace/conformance'),
      }
      const tarballs = Object.fromEntries(Object.entries(packageRoots).map(([name, packageRoot]) => {
        run('pnpm', ['pack', '--pack-destination', temporaryRoot], packageRoot)
        const tarball = fs.readdirSync(temporaryRoot)
          .filter((entry) => entry.endsWith('.tgz'))
          .map((entry) => path.join(temporaryRoot, entry))
          .find((entry) => path.basename(entry).includes(`workspace-${name}`))
        assert.ok(tarball, `pnpm pack did not produce the ${name} artifact`)
        return [name, tarball]
      }))
      for (const [name, tarball] of Object.entries(tarballs)) {
        const entries = run('tar', ['-tzf', tarball], repositoryRoot)
          .split('\n')
          .filter(Boolean)
          .sort()
        assert.ok(entries.length > 1)
        assert.ok(entries.every((entry) => (
          entry.startsWith('package/dist/')
          || entry === 'package/package.json'
          || entry === 'package/LICENSE'
        )))
        assert.ok(entries.some((entry) => entry === `package/dist/${name === 'client' ? 'generated.js' : 'index.js'}`))
        assert.ok(!entries.some((entry) => entry.includes('/src/')))
      }

      fs.writeFileSync(path.join(temporaryRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
        },
        include: ['consumer.ts'],
      }, null, 2) + '\n')
      fs.writeFileSync(path.join(temporaryRoot, 'consumer.ts'), [
        "import { createWorkspaceClient } from '@sparxie/valedictorian-workspace-client'",
        "import { workspaceRouteRegistry } from '@sparxie/valedictorian-workspace-server'",
        "import { assertWorkspaceContract } from '@sparxie/valedictorian-workspace-conformance'",
        "const client = createWorkspaceClient({ baseUrl: 'https://workspace.invalid' })",
        "if (workspaceRouteRegistry.length < 100 || assertWorkspaceContract().operationCount < 100) throw new Error('workspace package surface is incomplete')",
        "await client.operations['health.get']()",
        '',
      ].join('\n'))
      fs.writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify({
        name: 'workspace-client-disposable-consumer',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(Object.entries(tarballs).map(([name, tarball]) => [
          `@sparxie/valedictorian-workspace-${name}`,
          `file:${path.basename(tarball)}`,
        ])),
      }, null, 2) + '\n')
      run('pnpm', ['install', '--offline', '--ignore-scripts', '--no-lockfile'], temporaryRoot)
      run(process.execPath, [typescriptPath, '-p', path.join(temporaryRoot, 'tsconfig.json')], temporaryRoot)
      fs.writeFileSync(path.join(temporaryRoot, 'consumer.mjs'), [
        "import { createWorkspaceClient } from '@sparxie/valedictorian-workspace-client'",
        "import { workspaceRouteRegistry } from '@sparxie/valedictorian-workspace-server'",
        "import { assertWorkspaceContract } from '@sparxie/valedictorian-workspace-conformance'",
        "let called = false",
        "const client = createWorkspaceClient({ baseUrl: 'https://workspace.invalid/', fetch: async (url) => { called = String(url) === 'https://workspace.invalid/v1/health'; return new Response('{\"ok\":true}', { headers: { 'content-type': 'application/json' } }) } })",
        "await client.operations['health.get']()",
        "if (!called || workspaceRouteRegistry.length !== assertWorkspaceContract().routeCount) throw new Error('runtime package surfaces are incomplete')",
        '',
      ].join('\n'))
      run(process.execPath, ['consumer.mjs'], temporaryRoot)
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
