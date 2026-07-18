import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultUserProfile, profileDocumentSchemaVersion } from 'sparxie'
import {
  prepareWorkspaceProfileCapabilities,
} from '../src/modules/profile/profile.composition'
import { legacyProfileUpgradeFileName } from '../src/modules/profile/profile.upgrade-policy'
import type { SecretCodec } from '../src/modules/secrets/secret.codec'
import { resolveWorkspaceLayout } from '../src/workspace/workspace.paths'

const codec: SecretCodec = {
  decrypt: (value) => value,
  encrypt: (value) => value,
  isAvailable: () => true,
}

describe('Electron profile runtime composition', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { force: true, recursive: true })
    }
  })

  it('reuses runtime-prepared profile and secret capabilities instead of opening a second database', () => {
    const source = fs.readFileSync(new URL('./main.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('createSqliteProfileService')
    expect(source).not.toContain('createFileDatabase(config.pgliteDataPath)')
    expect(source).not.toContain("from '../src/db/sqlite'")
    expect(source).toContain('if (runtime.profileService && runtime.secretService)')
    expect(source).toContain('registerProfileIpc(runtime.profileService, runtime.secretService, ipcMain)')
  })

  it('keeps legacy operational sqlite byte-for-byte untouched while creating independent PGlite capabilities', async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-profile-runtime-'))
    cleanupPaths.push(rootPath)
    const layout = resolveWorkspaceLayout(rootPath)
    fs.mkdirSync(layout.dataPath, { recursive: true })

    const legacyPath = path.join(layout.dataPath, legacyProfileUpgradeFileName)
    const evidence = Buffer.from('legacy .valedictorian/valedictorian.sqlite must stay immutable\x00\xff')
    fs.writeFileSync(legacyPath, evidence)
    fs.writeFileSync(
      layout.profilePath,
      `${JSON.stringify({
        schemaVersion: profileDocumentSchemaVersion,
        profile: { ...defaultUserProfile, answers: [], education: [] },
      }, null, 2)}\n`,
    )

    expect(fs.existsSync(layout.pgliteDataPath)).toBe(false)

    const prepared = await prepareWorkspaceProfileCapabilities({
      profilePath: layout.profilePath,
      secretCodec: codec,
      pgliteDataPath: layout.pgliteDataPath,
      workspaceId: 'workspace-electron-runtime',
    })

    await prepared.secretService.upsertTrustedIdentitySsnLast4('5125')
    await prepared.profileService.update({ email: 'runtime@example.test' })

    expect(fs.readFileSync(legacyPath)).toEqual(evidence)
    expect(fs.existsSync(layout.pgliteDataPath)).toBe(true)
    expect(fs.readdirSync(layout.pgliteDataPath).length).toBeGreaterThan(0)
    expect(JSON.stringify(await prepared.profileService.get()).toLowerCase()).not.toContain('ssn')
    expect(JSON.stringify(await prepared.profileService.getAgentContext()).toLowerCase())
      .not.toContain('ssn')
    expect(JSON.stringify(await prepared.profileService.get()).toLowerCase()).not.toContain('5125')

    await prepared.dispose()
    expect(fs.readFileSync(legacyPath)).toEqual(evidence)
  })
})
