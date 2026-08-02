import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient } from '@sparxie/valedictorian-local-runtime/database'
import {
  cloneMigratedPgliteTemplate,
  createMigratedPgliteTemplate,
  prepareConfiguredPgliteDataPath,
} from './pglite-template'

const tempPaths = new Set<string>()

afterEach(() => {
  for (const tempPath of tempPaths) fs.rmSync(tempPath, { force: true, recursive: true })
  tempPaths.clear()
})

function createTempDirectory(prefix: string) {
  const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempPaths.add(tempPath)
  return tempPath
}

describe('migrated PGlite test template', () => {
  it('clones a closed migrated database without sharing mutations between clients', async () => {
    const templatePath = createTempDirectory('valedictorian-pglite-template-')
    const firstClonePath = createTempDirectory('valedictorian-pglite-clone-a-')
    const secondClonePath = createTempDirectory('valedictorian-pglite-clone-b-')

    await createMigratedPgliteTemplate(templatePath)
    cloneMigratedPgliteTemplate(templatePath, firstClonePath)
    cloneMigratedPgliteTemplate(templatePath, secondClonePath)

    const firstClient = await createPgliteClient({ dataDir: firstClonePath })
    const secondClient = await createPgliteClient({ dataDir: secondClonePath })
    try {
      const schema = await firstClient.query<{ relation: string | null }>(
        "SELECT to_regclass('public.applications')::text AS relation",
      )
      expect(schema.rows[0]?.relation).toBe('applications')
      const applicationCount = await firstClient.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM applications',
      )
      expect(applicationCount.rows[0]?.count).toBe(0)

      await firstClient.exec('CREATE TABLE clone_isolation_probe (id integer PRIMARY KEY)')
      const isolated = await secondClient.query<{ relation: string | null }>(
        "SELECT to_regclass('public.clone_isolation_probe')::text AS relation",
      )
      expect(isolated.rows[0]?.relation).toBeNull()
    } finally {
      await Promise.all([firstClient.close(), secondClient.close()])
    }
  })

  it('refuses to clone over a non-empty directory', async () => {
    const templatePath = createTempDirectory('valedictorian-pglite-template-')
    const targetPath = createTempDirectory('valedictorian-pglite-nonempty-')
    const sentinelPath = path.join(targetPath, 'sentinel.txt')
    fs.writeFileSync(path.join(templatePath, 'placeholder'), 'template')
    fs.writeFileSync(sentinelPath, 'preserve me')

    expect(() => cloneMigratedPgliteTemplate(templatePath, targetPath)).toThrow(
      'PGlite template target must be empty',
    )
    expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('preserve me')
  })

  it('prepares absent paths once and preserves existing databases for restart tests', async () => {
    const rootPath = createTempDirectory('valedictorian-pglite-prepare-')
    const targetPath = path.join(rootPath, 'pglite')

    expect(prepareConfiguredPgliteDataPath(targetPath)).toBe(true)
    expect(fs.readdirSync(targetPath).length).toBeGreaterThan(0)
    expect(prepareConfiguredPgliteDataPath(targetPath)).toBe(false)
  })
})
