import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(packageRoot, '../..')
const packedRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-local-runtime-pack-')),
)
const consumerRoot = path.join(packedRoot, 'consumer')
const pnpmStoreRoot = path.join(packedRoot, 'pnpm-store')
const localRuntimeTarball = path.join(packedRoot, 'local-runtime.tgz')
const connectorCoreTarball = path.join(packedRoot, 'connector-core.tgz')
const workspaceServerTarball = path.join(packedRoot, 'workspace-server.tgz')
const installedPackage = '@sparxie/valedictorian-local-runtime'

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function runPnpm(args: string[], cwd: string) {
  try {
    return execFileSync('pnpm', args, {
      cwd,
      encoding: 'utf8',
      env: process.env,
      stdio: 'pipe',
    })
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string }
    throw new Error([
      `pnpm ${args.join(' ')} failed`,
      failure.stdout,
      failure.stderr,
    ].filter(Boolean).join('\n'))
  }
}

beforeAll(() => {
  runPnpm(['pack', '--out', localRuntimeTarball], packageRoot)
  runPnpm(
    ['pack', '--out', connectorCoreTarball],
    path.join(repositoryRoot, 'packages/connector-api'),
  )
  runPnpm(
    ['pack', '--out', workspaceServerTarball],
    path.join(repositoryRoot, 'packages/workspace/server'),
  )

  fs.mkdirSync(consumerRoot, { recursive: true })
  fs.writeFileSync(path.join(consumerRoot, 'package.json'), `${JSON.stringify({
    name: 'local-runtime-packed-proof',
    private: true,
    type: 'module',
    dependencies: {
      '@sparxie/valedictorian-connectors-core': `file:${connectorCoreTarball}`,
      '@sparxie/valedictorian-local-runtime': `file:${localRuntimeTarball}`,
      '@sparxie/valedictorian-workspace-server': `file:${workspaceServerTarball}`,
    },
  }, null, 2)}\n`)
  fs.writeFileSync(path.join(consumerRoot, 'pnpm-workspace.yaml'), `
minimumReleaseAgeExclude:
  - '@sparxie/*'

overrides:
  '@sparxie/valedictorian-connectors-core': 'file:${connectorCoreTarball}'
  '@sparxie/valedictorian-workspace-server': 'file:${workspaceServerTarball}'
`)
  // Registry dependencies may download; the package under proof must still
  // resolve from its file tarball, using a fresh store owned by this fixture.
  runPnpm([
    'install',
    '--prefer-offline',
    '--ignore-scripts',
    '--store-dir',
    pnpmStoreRoot,
  ], consumerRoot)
}, 120_000)

afterAll(() => {
  fs.rmSync(packedRoot, { force: true, recursive: true })
})

describe('packed local runtime', () => {
  it('installs only from a file tarball and executes supported runtime imports', () => {
    const workspaceRoot = path.join(consumerRoot, 'workspace')
    const proofPath = path.join(consumerRoot, 'proof.mjs')
    const consumerManifest = JSON.parse(
      fs.readFileSync(path.join(consumerRoot, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    const installedRuntimeRoot = fs.realpathSync(
      path.join(consumerRoot, 'node_modules', installedPackage),
    )
    const installedManifest = JSON.parse(
      fs.readFileSync(path.join(installedRuntimeRoot, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const lockfile = fs.readFileSync(path.join(consumerRoot, 'pnpm-lock.yaml'), 'utf8')

    expect(consumerManifest.dependencies[installedPackage]).toBe(
      `file:${localRuntimeTarball}`,
    )
    expect(isWithin(packedRoot, installedRuntimeRoot)).toBe(true)
    expect(isWithin(repositoryRoot, installedRuntimeRoot)).toBe(false)
    expect(lockfile).toContain('local-runtime.tgz')
    expect(lockfile).not.toContain('workspace:')
    expect(lockfile).not.toMatch(/\blink:/)
    expect(Object.values(installedManifest.dependencies ?? {}).every(
      dependency => !dependency.startsWith('workspace:'),
    )).toBe(true)

    fs.writeFileSync(proofPath, `
      import fs from 'node:fs'
      import {
        createPgliteClient,
        migratePgliteDatabase,
        resolvePgliteMigrationsFolder,
      } from '${installedPackage}/database'
      import { createValedictorianHttpServer } from '${installedPackage}/http-server'
      import {
        resolveValedictorianRuntimeConfig,
      } from '${installedPackage}/runtime'
      import {
        initializeWorkspace,
      } from '${installedPackage}/workspace-runtime'

      const workspace = initializeWorkspace(${JSON.stringify(workspaceRoot)}, {
        createId: () => 'packed-workspace',
        now: new Date('2026-08-02T00:00:00.000Z'),
      })
      const config = resolveValedictorianRuntimeConfig({
        userDataPath: workspace.dataPath,
        workspaceDataPath: workspace.dataPath,
        workspaceId: workspace.id,
      })
      const migrationsFolder = resolvePgliteMigrationsFolder()
      const client = await createPgliteClient()
      await migratePgliteDatabase(client)
      const rows = await client.query('select id from workspaces')
      await client.close()
      let backendRejected = false
      try {
        await import('${installedPackage}/backend/db/schema')
      } catch (error) {
        backendRejected = error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      }
      process.stdout.write(JSON.stringify({
        backendRejected,
        httpServer: typeof createValedictorianHttpServer,
        migration: fs.existsSync(migrationsFolder + '/0000_pglite_operational_baseline.sql'),
        mode: config.mode,
        rows: rows.rows.length,
        workspaceId: workspace.id,
      }))
    `)

    const output = execFileSync(process.execPath, [proofPath], {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: process.env,
      stdio: 'pipe',
    })

    expect(JSON.parse(output)).toEqual({
      backendRejected: true,
      httpServer: 'function',
      migration: true,
      mode: 'local-desktop',
      rows: 1,
      workspaceId: 'packed-workspace',
    })
  }, 60_000)
})
