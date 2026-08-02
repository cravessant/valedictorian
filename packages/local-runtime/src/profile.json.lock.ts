import type { ProfileJsonFileOperations } from './profile.json.atomic.js'
import {
  defaultProfileJsonFileOperations,
  profileLockPath,
  removeIfExists,
  writeAllSync,
} from './profile.json.atomic.js'
import { profileDocumentError } from './profile.errors.js'

export interface ProfileJsonLockOptions {
  fileOps?: ProfileJsonFileOperations
  isProcessAlive?: (pid: number) => boolean
  lockRetryIntervalMs?: number
  lockTimeoutMs?: number
  malformedLockGraceMs?: number
  maxLockAgeMs?: number
  now?: () => number
  ownershipToken?: string
  pid?: number
  sleep?: (ms: number) => Promise<void>
}

export interface AcquiredProfileJsonLock {
  ownershipToken: string
  release(): void
}

interface LockPayload {
  acquiredAt: number
  pid: number
  token: string
}

export async function withProfileJsonLock<T>(
  profilePath: string,
  options: ProfileJsonLockOptions,
  work: () => Promise<T> | T,
): Promise<T> {
  const lock = await acquireProfileJsonLock(profilePath, options)
  try {
    return await work()
  } finally {
    lock.release()
  }
}

export async function acquireProfileJsonLock(
  profilePath: string,
  options: ProfileJsonLockOptions = {},
): Promise<AcquiredProfileJsonLock> {
  const fileOps = options.fileOps ?? defaultProfileJsonFileOperations
  const lockPath = profileLockPath(profilePath)
  const retryIntervalMs = options.lockRetryIntervalMs ?? 25
  const lockTimeoutMs = options.lockTimeoutMs ?? 2_000
  const malformedLockGraceMs = options.malformedLockGraceMs ?? 250
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  const pid = options.pid ?? process.pid
  const deadline = now() + lockTimeoutMs

  while (now() <= deadline) {
    const token = options.ownershipToken ?? randomOwnershipToken()
    try {
      const payload: LockPayload = { pid, acquiredAt: now(), token }
      const encoded = `${JSON.stringify(payload)}\n`
      const fd = fileOps.openSync(lockPath, 'wx', 0o600)
      try {
        writeAllSync(fileOps, fd, encoded, profilePath)
      } catch (error) {
        try {
          fileOps.closeSync(fd)
        } catch {
          // ignore close failures during unwind
        }
        removeIfExists(lockPath, fileOps)
        throw error
      }
      fileOps.closeSync(fd)
      return {
        ownershipToken: token,
        release() {
          releaseOwnedLock(lockPath, token, fileOps)
        },
      }
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : undefined
      if (code !== 'EEXIST') throw error
    }

    maybeRecoverStaleLock(lockPath, {
      fileOps,
      isProcessAlive,
      malformedLockGraceMs,
      now,
    })
    if (now() > deadline) break
    await sleep(retryIntervalMs)
  }

  throw profileDocumentError('profile_document_unavailable', { filePath: profilePath })
}

function releaseOwnedLock(
  lockPath: string,
  ownershipToken: string,
  fileOps: ProfileJsonFileOperations,
): void {
  if (!fileOps.existsSync(lockPath)) return
  const payload = readLockPayload(lockPath, fileOps)
  if (!payload || payload.token !== ownershipToken) return
  removeIfExists(lockPath, fileOps)
}

function maybeRecoverStaleLock(
  lockPath: string,
  options: {
    fileOps: ProfileJsonFileOperations
    isProcessAlive: (pid: number) => boolean
    malformedLockGraceMs: number
    now: () => number
  },
): void {
  if (!options.fileOps.existsSync(lockPath)) return

  const payload = readLockPayload(lockPath, options.fileOps)
  if (!payload) {
    const ageMs = lockFileAgeMs(lockPath, options.fileOps, options.now)
    if (ageMs != null && ageMs > options.malformedLockGraceMs) {
      removeIfExists(lockPath, options.fileOps)
    }
    return
  }

  // Valid payload: recover only when the owner PID is dead. Age must never
  // override positive liveness (a long-running holder can exceed maxLockAgeMs).
  if (!options.isProcessAlive(payload.pid)) {
    removeIfExists(lockPath, options.fileOps)
  }
}

function readLockPayload(
  lockPath: string,
  fileOps: ProfileJsonFileOperations,
): LockPayload | null {
  try {
    const text = fileOps.readFileSync(lockPath, 'utf8')
    const parsed = JSON.parse(text) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as LockPayload).pid === 'number' &&
      typeof (parsed as LockPayload).acquiredAt === 'number' &&
      typeof (parsed as LockPayload).token === 'string' &&
      (parsed as LockPayload).token.length > 0
    ) {
      return parsed as LockPayload
    }
  } catch {
    // Malformed or unreadable lock payload.
  }
  return null
}

function lockFileAgeMs(
  lockPath: string,
  fileOps: ProfileJsonFileOperations,
  now: () => number,
): number | null {
  try {
    return now() - fileOps.statSync(lockPath).mtimeMs
  } catch {
    return null
  }
}

function randomOwnershipToken(): string {
  return `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined
    return code === 'EPERM'
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
