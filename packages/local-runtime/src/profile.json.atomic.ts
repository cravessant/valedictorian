import fs from 'node:fs'
import {
  profileBackupPath,
  profileLockPath,
  profileTempPath,
  parseProfileTempPath,
} from './profile.json.paths.js'
import { profileDocumentError } from './profile.errors.js'

export interface ProfileJsonFileOperations {
  fsyncSync(fd: number): void
  fsyncDirectory?(directoryPath: string): void
  openSync(path: string, flags: string, mode?: number): number
  closeSync(fd: number): void
  writeSync(fd: number, data: string | Buffer, offset?: number, length?: number): number
  writeFileSync(path: string, data: string, options?: fs.WriteFileOptions): void
  readFileSync(path: string, encoding: BufferEncoding): string
  renameSync(from: string, to: string): void
  unlinkSync(path: string): void
  existsSync(path: string): boolean
  readdirSync(path: string): string[]
  mkdirSync(path: string, options?: fs.MakeDirectoryOptions): void
  statSync(path: string): fs.Stats
}

export const defaultProfileJsonFileOperations: ProfileJsonFileOperations = {
  fsyncSync: (fd) => fs.fsyncSync(fd),
  fsyncDirectory(directoryPath) {
    const fd = fs.openSync(directoryPath, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  },
  openSync: (filePath, flags, mode) => fs.openSync(filePath, flags, mode),
  closeSync: (fd) => fs.closeSync(fd),
  writeSync: (fd, data, offset, length) => {
    if (typeof data === 'string') {
      return fs.writeSync(fd, data)
    }
    return fs.writeSync(fd, data, offset, length)
  },
  writeFileSync: (filePath, data, options) => fs.writeFileSync(filePath, data, options),
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  renameSync: (from, to) => fs.renameSync(from, to),
  unlinkSync: (filePath) => fs.unlinkSync(filePath),
  existsSync: (filePath) => fs.existsSync(filePath),
  readdirSync: (directoryPath) => fs.readdirSync(directoryPath),
  mkdirSync: (directoryPath, options) => {
    fs.mkdirSync(directoryPath, options)
  },
  statSync: (filePath) => fs.statSync(filePath),
}

const unsupportedDirectorySyncCodes = new Set(['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP'])

export function writeProfileJsonAtomically(options: {
  profilePath: string
  contents: string
  fileOps?: ProfileJsonFileOperations
  pid?: number
  nonce?: string
}): void {
  const fileOps = options.fileOps ?? defaultProfileJsonFileOperations
  const directoryPath = pathDirname(options.profilePath)
  fileOps.mkdirSync(directoryPath, { recursive: true })

  let temporaryPath: string | null = null
  let fd: number | null = null
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = profileTempPath(options.profilePath, options.pid, options.nonce)
      try {
        fd = fileOps.openSync(candidate, 'wx', 0o600)
        temporaryPath = candidate
        break
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined
        if (code !== 'EEXIST' || options.nonce != null) throw error
      }
    }
    if (fd == null || temporaryPath == null) {
      throw unavailableProfileDocument(options.profilePath)
    }

    writeAllSync(fileOps, fd, options.contents, options.profilePath)
    fileOps.fsyncSync(fd)
    fileOps.closeSync(fd)
    fd = null
    fileOps.renameSync(temporaryPath, options.profilePath)
    temporaryPath = null
    bestEffortDirectorySync(directoryPath, fileOps)
  } finally {
    if (fd != null) {
      try {
        fileOps.closeSync(fd)
      } catch {
        // ignore close failures during unwind
      }
    }
  }
}

export function cleanOrphanProfileTemps(
  profilePath: string,
  options: {
    fileOps?: ProfileJsonFileOperations
    isProcessAlive?: (pid: number) => boolean
    ownPid?: number
  } = {},
): void {
  const fileOps = options.fileOps ?? defaultProfileJsonFileOperations
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  const ownPid = options.ownPid ?? process.pid
  const directoryPath = pathDirname(profilePath)
  if (!fileOps.existsSync(directoryPath)) return

  const roots = [profilePath, profileBackupPath(profilePath)]
  for (const entry of fileOps.readdirSync(directoryPath)) {
    const candidate = `${directoryPath}/${entry}`
    const parsed = roots
      .map((root) => parseProfileTempPath(root, candidate))
      .find((value) => value != null)
    if (!parsed) continue
    // Never delete another live writer's temp. Own-pid leftovers and dead pids are orphans.
    if (parsed.pid !== ownPid && isProcessAlive(parsed.pid)) continue
    try {
      fileOps.unlinkSync(candidate)
    } catch {
      // Best-effort orphan cleanup under lock.
    }
  }
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

/**
 * Returns text when present, null when missing.
 * Permission/I/O failures map to profile_document_unavailable (never treated as missing).
 */
export function readOptionalText(
  filePath: string,
  fileOps: ProfileJsonFileOperations = defaultProfileJsonFileOperations,
): string | null {
  try {
    return fileOps.readFileSync(filePath, 'utf8')
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined
    if (code === 'ENOENT') return null
    throw unavailableProfileDocument(filePath)
  }
}

export function removeIfExists(
  filePath: string,
  fileOps: ProfileJsonFileOperations = defaultProfileJsonFileOperations,
): void {
  if (!fileOps.existsSync(filePath)) return
  try {
    fileOps.unlinkSync(filePath)
  } catch {
    // ignore
  }
}

export { profileBackupPath, profileLockPath, profileTempPath }

function bestEffortDirectorySync(directoryPath: string, fileOps: ProfileJsonFileOperations): void {
  if (!fileOps.fsyncDirectory) return
  try {
    fileOps.fsyncDirectory(directoryPath)
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined
    if (code && unsupportedDirectorySyncCodes.has(code)) return
    throw error
  }
}

function pathDirname(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index === -1 ? '.' : filePath.slice(0, index)
}

export function unavailableProfileDocument(filePath: string) {
  return profileDocumentError('profile_document_unavailable', { filePath })
}

export function writeAllSync(
  fileOps: ProfileJsonFileOperations,
  fd: number,
  contents: string,
  filePath: string,
): void {
  const buffer = Buffer.from(contents, 'utf8')
  let offset = 0
  while (offset < buffer.length) {
    const written = fileOps.writeSync(fd, buffer, offset, buffer.length - offset)
    if (!Number.isInteger(written) || written <= 0) {
      throw unavailableProfileDocument(filePath)
    }
    offset += written
  }
}
