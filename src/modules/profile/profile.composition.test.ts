import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { profileDocumentSchemaVersion } from 'sparxie'
import { resolveWorkspaceLayout } from '../../workspace/workspace.paths'
import type { SecretCodec } from '../secrets/secret.codec'
import {
  createJsonProfileService,
  prepareWorkspaceProfileCapabilities,
} from './profile.composition'
import { serializeProfileJsonDocument } from './profile.json.document'
import { computeProfileRevision } from './profile.revision'

const codec: SecretCodec = {
  decrypt: (value) => value,
  encrypt: (value) => value,
  isAvailable: () => true,
}

describe('profile composition', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { force: true, recursive: true })
    }
  })

  it('prepares one JSON profile and scoped secret capability before use and disposes it', async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-composition-'))
    cleanupPaths.push(rootPath)
    const layout = resolveWorkspaceLayout(rootPath)
    fs.mkdirSync(layout.dataPath, { recursive: true })

    const prepared = await prepareWorkspaceProfileCapabilities({
      profilePath: layout.profilePath,
      secretCodec: codec,
      sqlitePath: layout.sqlitePath,
      workspaceId: 'workspace-composition',
    })

    expect(createJsonProfileService).toEqual(expect.any(Function))
    expect(await prepared.profileService.get()).toMatchObject({ answers: [], education: [] })
    expect(prepared.secretService.scope.workspaceId).toBe('workspace-composition')
    expect(fs.existsSync(layout.profilePath)).toBe(true)

    prepared.dispose()
    await expect(prepared.profileService.get()).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })
  })

  it('observes external edits, fails closed on invalid JSON, restores, restarts, and keeps profile tables absent', async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-composition-integration-'))
    cleanupPaths.push(rootPath)
    const layout = resolveWorkspaceLayout(rootPath)
    fs.mkdirSync(layout.dataPath, { recursive: true })
    const options = {
      profilePath: layout.profilePath,
      secretCodec: codec,
      sqlitePath: layout.sqlitePath,
      workspaceId: 'workspace-composition-integration',
    }
    const prepared = await prepareWorkspaceProfileCapabilities(options)
    const profile = await prepared.profileService.update({
      dateOfBirth: '1990-02-03',
      email: 'first@example.test',
      fullName: 'Ada Example',
    })
    await prepared.secretService.upsertTrustedIdentitySsnLast4('5125')

    expectOperationalDatabaseHasNoProfileTables(layout.sqlitePath)
    expect(JSON.stringify(profile).toLowerCase()).not.toContain('ssn')
    expect(JSON.stringify(await prepared.profileService.getAgentContext()).toLowerCase()).not.toContain('ssn')

    const externalProfile = { ...profile, email: 'external@example.test' }
    fs.writeFileSync(layout.profilePath, serializeProfileJsonDocument({
      profile: externalProfile,
      revision: computeProfileRevision(externalProfile),
      schemaVersion: profileDocumentSchemaVersion,
    }))
    await expect(prepared.profileService.get()).resolves.toMatchObject({
      email: 'external@example.test',
    })

    fs.writeFileSync(layout.profilePath, '{ invalid', 'utf8')
    await expect(prepared.profileService.get()).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    await expect(prepared.profileService.getAgentContext()).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })

    await expect(
      prepared.profileService.restoreDocument({ expectedRevision: null }),
    ).resolves.toMatchObject({ profile: { email: null } })
    await prepared.profileService.update({ email: 'restart@example.test' })
    expectOperationalDatabaseHasNoProfileTables(layout.sqlitePath)
    prepared.dispose()

    const restarted = await prepareWorkspaceProfileCapabilities(options)
    await expect(restarted.profileService.get()).resolves.toMatchObject({
      email: 'restart@example.test',
    })
    expect(JSON.stringify(await restarted.profileService.get()).toLowerCase()).not.toContain('ssn')
    expectOperationalDatabaseHasNoProfileTables(layout.sqlitePath)
    restarted.dispose()
  })
})

function expectOperationalDatabaseHasNoProfileTables(sqlitePath: string) {
  const database = new Database(sqlitePath, { readonly: true })
  try {
    const tables = database.prepare(
      "select name from sqlite_master where type = 'table'",
    ).all().map((row) => (row as { name: string }).name)
    expect(tables).not.toContain('user_profile')
    expect(tables).not.toContain('profile_education')
    expect(tables).not.toContain('profile_answers')
    expect(tables).not.toContain('profile_sensitive_details')
  } finally {
    database.close()
  }
}
