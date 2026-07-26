import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { profileDocumentSchemaVersion } from '@sparxie/sdk'
import { resolveWorkspaceLayout } from '../../workspace/workspace.paths'
import type { SecretCodec } from '../secrets/secret.codec'
import {
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

  it('observes external edits, fails closed on invalid JSON, restores, restarts, and keeps profile tables absent', async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-composition-integration-'))
    cleanupPaths.push(rootPath)
    const layout = resolveWorkspaceLayout(rootPath)
    fs.mkdirSync(layout.pgliteDataPath, { recursive: true })
    const options = {
      profilePath: layout.profilePath,
      secretCodec: codec,
      pgliteDataPath: layout.pgliteDataPath,
      workspaceId: 'workspace-composition-integration',
    }
    const prepared = await prepareWorkspaceProfileCapabilities(options)

    expect(await prepared.profileService.get()).toMatchObject({ answers: [], education: [] })
    expect(prepared.secretService.scope.workspaceId).toBe('workspace-composition-integration')
    expect(fs.existsSync(layout.profilePath)).toBe(true)

    const profile = await prepared.profileService.update({
      dateOfBirth: '1990-02-03',
      email: 'first@example.test',
      fullName: 'Ada Example',
    })
    await prepared.secretService.upsertTrustedIdentitySsnLast4('5125')

    await expectOperationalDatabaseHasNoProfileTables(prepared.pgliteClient)
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
    await expectOperationalDatabaseHasNoProfileTables(prepared.pgliteClient)
    await prepared.dispose()
    await expect(prepared.profileService.get()).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })

    const restarted = await prepareWorkspaceProfileCapabilities(options)
    await expect(restarted.profileService.get()).resolves.toMatchObject({
      email: 'restart@example.test',
    })
    expect(JSON.stringify(await restarted.profileService.get()).toLowerCase()).not.toContain('ssn')
    await expectOperationalDatabaseHasNoProfileTables(restarted.pgliteClient)
    await restarted.dispose()
  })
})

async function expectOperationalDatabaseHasNoProfileTables(
  pgliteClient: Awaited<ReturnType<typeof prepareWorkspaceProfileCapabilities>>['pgliteClient'],
) {
  const result = await pgliteClient.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  )
  const tables = result.rows.map((row) => row.tablename)
  expect(tables).not.toContain('user_profile')
  expect(tables).not.toContain('profile_education')
  expect(tables).not.toContain('profile_answers')
  expect(tables).not.toContain('profile_sensitive_details')
}
