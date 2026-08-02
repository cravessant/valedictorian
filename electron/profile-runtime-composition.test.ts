import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultUserProfile, profileDocumentSchemaVersion } from '@sparxie/sdk'
import {
  prepareWorkspaceProfileCapabilities,
} from '@sparxie/valedictorian-local-runtime/testing/modules/profile/profile.composition'
import type { SecretCodec } from '@sparxie/valedictorian-local-runtime/protected-secrets'
import { resolveWorkspaceLayout } from '@sparxie/valedictorian-local-runtime/workspace-files'

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

  it('registers runtime-prepared profile and secret capabilities', () => {
    const source = fs.readFileSync(new URL('./main.ts', import.meta.url), 'utf8')

    expect(source).toContain('if (runtime.profileService && runtime.secretService)')
    expect(source).toContain('registerProfileIpc(runtime.profileService, runtime.secretService, ipcMain)')
  })

  it('creates the PGlite owner for an existing JSON profile without exposing sensitive values', async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-profile-runtime-'))
    cleanupPaths.push(rootPath)
    const layout = resolveWorkspaceLayout(rootPath)
    fs.mkdirSync(layout.dataPath, { recursive: true })

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

    expect(fs.existsSync(layout.pgliteDataPath)).toBe(true)
    expect(fs.readdirSync(layout.pgliteDataPath).length).toBeGreaterThan(0)
    expect(JSON.stringify(await prepared.profileService.get()).toLowerCase()).not.toContain('ssn')
    expect(JSON.stringify(await prepared.profileService.getAgentContext()).toLowerCase())
      .not.toContain('ssn')
    expect(JSON.stringify(await prepared.profileService.get()).toLowerCase()).not.toContain('5125')

    await prepared.dispose()
  })
})
