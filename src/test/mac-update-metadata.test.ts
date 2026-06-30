import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateMacUpdateMetadata } from '../../scripts/generate-mac-update-metadata'

function sha512Base64(value: string) {
  return crypto.createHash('sha512').update(value).digest('base64')
}

describe('Mac update metadata generator', () => {
  it('writes latest-mac.yml with the zip as the primary update artifact', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'valedictorian-updates-'))

    try {
      const releaseDir = path.join(projectDir, 'release', '0.1.0-alpha.13')
      const zipFile = 'Valedictorian-Mac-0.1.0-alpha.13-Installer.zip'
      const dmgFile = 'Valedictorian-Mac-0.1.0-alpha.13-Installer.dmg'

      await fs.mkdir(releaseDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"version":"0.1.0-alpha.13"}')
      await fs.writeFile(path.join(releaseDir, zipFile), 'zip bytes')
      await fs.writeFile(path.join(releaseDir, dmgFile), 'dmg bytes')
      await fs.writeFile(path.join(releaseDir, `${zipFile}.blockmap`), 'zip blockmap')
      await fs.writeFile(path.join(releaseDir, `${dmgFile}.blockmap`), 'dmg blockmap')

      const result = await generateMacUpdateMetadata({
        now: new Date('2026-06-30T00:00:00.000Z'),
        projectDir,
      })

      const yaml = await fs.readFile(path.join(releaseDir, 'latest-mac.yml'), 'utf8')
      const zipHash = sha512Base64('zip bytes')
      const dmgHash = sha512Base64('dmg bytes')

      expect(result.filePath).toBe(path.join(releaseDir, 'latest-mac.yml'))
      expect(result.files.map((file) => file.url)).toEqual([zipFile, dmgFile])
      expect(yaml).toBe(result.yaml)
      expect(yaml).toContain('version: "0.1.0-alpha.13"')
      expect(yaml.indexOf(zipFile)).toBeLessThan(yaml.indexOf(dmgFile))
      expect(yaml).toContain(`path: "${zipFile}"`)
      expect(yaml).toContain(`sha512: "${zipHash}"`)
      expect(yaml).toContain(`sha512: "${dmgHash}"`)
      expect(yaml).toContain('releaseDate: "2026-06-30T00:00:00.000Z"')
      expect(yaml).not.toContain('blockmap')
    } finally {
      await fs.rm(projectDir, { force: true, recursive: true })
    }
  })
})
