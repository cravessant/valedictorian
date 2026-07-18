import fs from 'node:fs'
import path from 'node:path'

export const legacyProfileUpgradeFileName = 'valedictorian.sqlite'
export const stagedProfileUpgradeFloor = '0.1.0-alpha.43'
export const stagedProfileUpgradeCeiling = '0.1.0-alpha.46'

const stagedUpgradeMessage =
  `This workspace must be opened with Valedictorian ${stagedProfileUpgradeFloor} through `
  + `${stagedProfileUpgradeCeiling} before upgrading.`

export class ProfileUpgradeRequiredError extends Error {
  readonly code = 'profile_upgrade_required'
  readonly retryable = false

  constructor() {
    super(stagedUpgradeMessage)
    this.name = 'ProfileUpgradeRequiredError'
  }
}

export function assertSupportedProfileUpgrade(options: { profilePath: string }) {
  if (fs.existsSync(options.profilePath)) return
  const legacyPath = path.join(
    path.dirname(options.profilePath),
    legacyProfileUpgradeFileName,
  )
  if (fs.existsSync(legacyPath)) throw new ProfileUpgradeRequiredError()
}
