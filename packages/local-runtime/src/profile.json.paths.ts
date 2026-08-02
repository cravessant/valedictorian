import path from 'node:path'

/** Sidecar naming for recoverable local profile documents. */
export function profileLockPath(profilePath: string): string {
  return `${profilePath}.lock`
}

export function profileBackupPath(profilePath: string): string {
  return `${profilePath}.bak`
}

export function profileTempPath(profilePath: string, pid = process.pid, nonce = randomNonce()): string {
  return `${profilePath}.${pid}.${nonce}.tmp`
}

export function parseProfileTempPath(
  profilePath: string,
  candidatePath: string,
): { pid: number; nonce: string } | null {
  const base = path.basename(profilePath)
  const name = path.basename(candidatePath)
  const match = name.match(
    new RegExp(`^${escapeRegExp(base)}\\.(\\d+)\\.([A-Za-z0-9]+)\\.tmp$`),
  )
  if (!match) return null
  return {
    pid: Number(match[1]),
    nonce: match[2] ?? '',
  }
}

export function isProfileTempPath(profilePath: string, candidatePath: string): boolean {
  return parseProfileTempPath(profilePath, candidatePath) !== null
}

export function isProfileSidecarPath(profilePath: string, candidatePath: string): boolean {
  const resolved = path.resolve(candidatePath)
  return (
    resolved === path.resolve(profileLockPath(profilePath)) ||
    resolved === path.resolve(profileBackupPath(profilePath)) ||
    isProfileTempPath(profilePath, candidatePath)
  )
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2, 10)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
