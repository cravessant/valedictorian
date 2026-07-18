import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSupportedProfileUpgrade,
  legacyProfileUpgradeFileName,
  ProfileUpgradeRequiredError,
} from './profile.upgrade-policy'

describe('profile upgrade policy', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      fs.rmSync(cleanupPath, { force: true, recursive: true })
    }
  })

  it('requires a staged upgrade when only the pre-JSON workspace database exists', () => {
    const rootPath = createRoot()
    const profilePath = path.join(rootPath, 'profile.json')
    const legacyPath = path.join(rootPath, legacyProfileUpgradeFileName)
    const evidence = Buffer.from('immutable legacy profile evidence')
    fs.writeFileSync(legacyPath, evidence)

    expect(() => assertSupportedProfileUpgrade({ profilePath })).toThrow(
      ProfileUpgradeRequiredError,
    )
    expect(() => assertSupportedProfileUpgrade({ profilePath })).toThrow(
      'Valedictorian 0.1.0-alpha.43 through 0.1.0-alpha.46',
    )
    expect(fs.readFileSync(legacyPath)).toEqual(evidence)
    expect(fs.existsSync(profilePath)).toBe(false)
  })

  it('preserves legacy evidence after a staged release created the JSON profile', () => {
    const rootPath = createRoot()
    const profilePath = path.join(rootPath, 'profile.json')
    const legacyPath = path.join(rootPath, legacyProfileUpgradeFileName)
    const legacyEvidence = Buffer.from('legacy migration source')
    const profileEvidence = '{"schemaVersion":1}\n'
    fs.writeFileSync(legacyPath, legacyEvidence)
    fs.writeFileSync(profilePath, profileEvidence)

    expect(() => assertSupportedProfileUpgrade({ profilePath })).not.toThrow()
    expect(fs.readFileSync(legacyPath)).toEqual(legacyEvidence)
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(profileEvidence)
  })

  it('allows a new workspace with neither legacy evidence nor a JSON profile', () => {
    const rootPath = createRoot()

    expect(() => assertSupportedProfileUpgrade({
      profilePath: path.join(rootPath, 'profile.json'),
    })).not.toThrow()
  })

  it('documents the supported staged-upgrade floor and immutable evidence policy', () => {
    const guide = fs.readFileSync(path.resolve('UPGRADING.md'), 'utf8')
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8')

    expect(guide).toContain('0.1.0-alpha.43')
    expect(guide).toContain('0.1.0-alpha.46')
    expect(guide).toContain('profile.json')
    expect(guide).toContain('never reads, moves, converts, or deletes')
    expect(readme).toContain('See `UPGRADING.md`')
    expect(readme).toContain('PGlite-only runtime never reads or migrates the legacy SQLite file')
    expect(readme).not.toContain('On first startup after upgrading, Valedictorian validates the legacy SQLite profile')
    expect(readme).not.toContain('A valid existing JSON document that conflicts with legacy data')
  })

  function createRoot() {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-upgrade-policy-'))
    cleanupPaths.push(rootPath)
    return rootPath
  }
})
