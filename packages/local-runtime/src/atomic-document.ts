import fs from 'node:fs'
import path from 'node:path'

/** Durable same-directory replacement for local-runtime JSON documents. */
/**
 * Narrow injectable filesystem seam for durable same-directory document replacement.
 * Shared by app-settings and app-secret document writers.
 */
export interface AtomicDocumentFileOperations {
  chmodSync(path: string, mode: number): void
  closeSync(fd: number): void
  fsyncDirectory(directoryPath: string): void
  fsyncSync(fd: number): void
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  openSync(path: string, flags: string, mode?: number): number
  renameSync(from: string, to: string): void
  unlinkSync(path: string): void
  writeSync(fd: number, data: string | Buffer, offset?: number, length?: number): number
}

/**
 * POSIX requires open/fsync/close on the containing directory after rename.
 * Windows does not support directory handles the same way, so the default
 * adapter skips directory fsync there. Callers that inject fsyncDirectory
 * still see every failure — writeAtomicDocument never swallows them.
 */
export function createDefaultAtomicDocumentFileOperations(
  platform: NodeJS.Platform = process.platform,
): AtomicDocumentFileOperations {
  return {
    chmodSync: (filePath, mode) => fs.chmodSync(filePath, mode),
    closeSync: (fd) => fs.closeSync(fd),
    fsyncDirectory(directoryPath) {
      if (platform === 'win32') {
        return
      }
      const fd = fs.openSync(directoryPath, 'r')
      try {
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    },
    fsyncSync: (fd) => fs.fsyncSync(fd),
    mkdirSync: (directoryPath, options) => {
      fs.mkdirSync(directoryPath, options)
    },
    openSync: (filePath, flags, mode) => fs.openSync(filePath, flags, mode),
    renameSync: (from, to) => fs.renameSync(from, to),
    unlinkSync: (filePath) => fs.unlinkSync(filePath),
    writeSync: (fd, data, offset, length) => {
      if (typeof data === 'string') {
        return fs.writeSync(fd, data)
      }
      return fs.writeSync(fd, data, offset, length)
    },
  }
}

export const defaultAtomicDocumentFileOperations: AtomicDocumentFileOperations =
  createDefaultAtomicDocumentFileOperations()

/**
 * Atomically replace a JSON/document file with durable ordering:
 * wx temp @ 0o600 → write-all → fsync+close temp → rename → fsync containing directory.
 */
export function writeAtomicDocument(
  destinationPath: string,
  contents: string | Buffer,
  fileOps: AtomicDocumentFileOperations = defaultAtomicDocumentFileOperations,
): void {
  const directoryPath = path.dirname(destinationPath)
  fileOps.mkdirSync(directoryPath, { recursive: true })

  let temporaryPath: string | null = null
  let fd: number | null = null
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = path.join(
        directoryPath,
        `.${path.basename(destinationPath)}.${process.pid}.${Date.now().toString(36)}.${attempt}.tmp`,
      )
      try {
        fd = fileOps.openSync(candidate, 'wx', 0o600)
        temporaryPath = candidate
        break
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined
        if (code !== 'EEXIST') {
          throw error
        }
      }
    }

    if (fd == null || temporaryPath == null) {
      throw new Error('Unable to create a temporary document')
    }

    const buffer = typeof contents === 'string' ? Buffer.from(contents, 'utf8') : contents
    let offset = 0
    while (offset < buffer.length) {
      const remaining = buffer.length - offset
      const written = fileOps.writeSync(fd, buffer, offset, remaining)
      if (!Number.isInteger(written) || written <= 0) {
        throw new Error('Short write made no progress while persisting document')
      }
      if (written > remaining) {
        throw new Error('Write exceeded remaining requested length while persisting document')
      }
      offset += written
    }
    fileOps.fsyncSync(fd)
    fileOps.closeSync(fd)
    fd = null
    fileOps.renameSync(temporaryPath, destinationPath)
    temporaryPath = null
    try {
      fileOps.chmodSync(destinationPath, 0o600)
    } catch {
      // Best-effort restrictive mode after rename.
    }
    fileOps.fsyncDirectory(directoryPath)
  } catch (error) {
    if (fd != null) {
      try {
        fileOps.closeSync(fd)
      } catch {
        // ignore close failures during unwind
      }
      fd = null
    }
    if (temporaryPath != null) {
      try {
        fileOps.unlinkSync(temporaryPath)
      } catch {
        // Best-effort temp cleanup without hiding the original failure.
      }
    }
    throw error
  }
}
