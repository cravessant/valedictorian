import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDefaultAtomicDocumentFileOperations,
  defaultAtomicDocumentFileOperations,
  writeAtomicDocument,
  type AtomicDocumentFileOperations,
} from './atomic-document.js'

const TOKEN_CANARY = 'canary-atomic-doc-token-9f3c'

function createTempDocumentPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-atomic-doc-')), 'document.json')
}

function createRecordingFileOps(
  events: string[],
  overrides: Partial<AtomicDocumentFileOperations> = {},
): AtomicDocumentFileOperations {
  return {
    chmodSync(filePath, mode) {
      events.push(`chmod:${path.basename(filePath)}`)
      if (overrides.chmodSync) {
        overrides.chmodSync(filePath, mode)
        return
      }
      defaultAtomicDocumentFileOperations.chmodSync(filePath, mode)
    },
    closeSync(fd) {
      events.push(`close:${fd}`)
      if (overrides.closeSync) {
        overrides.closeSync(fd)
        return
      }
      defaultAtomicDocumentFileOperations.closeSync(fd)
    },
    fsyncDirectory(directoryPath) {
      events.push(`fsyncDirectory:${path.basename(directoryPath)}`)
      if (overrides.fsyncDirectory) {
        overrides.fsyncDirectory(directoryPath)
        return
      }
      defaultAtomicDocumentFileOperations.fsyncDirectory(directoryPath)
    },
    fsyncSync(fd) {
      events.push(`fsync:${fd}`)
      if (overrides.fsyncSync) {
        overrides.fsyncSync(fd)
        return
      }
      defaultAtomicDocumentFileOperations.fsyncSync(fd)
    },
    mkdirSync(directoryPath, options) {
      events.push('mkdir')
      if (overrides.mkdirSync) {
        overrides.mkdirSync(directoryPath, options)
        return
      }
      defaultAtomicDocumentFileOperations.mkdirSync(directoryPath, options)
    },
    openSync(filePath, flags, mode) {
      events.push(`open:${flags}:${path.basename(filePath)}`)
      if (overrides.openSync) {
        return overrides.openSync(filePath, flags, mode)
      }
      return defaultAtomicDocumentFileOperations.openSync(filePath, flags, mode)
    },
    renameSync(from, to) {
      events.push(`rename:${path.basename(from)}->${path.basename(to)}`)
      if (overrides.renameSync) {
        overrides.renameSync(from, to)
        return
      }
      defaultAtomicDocumentFileOperations.renameSync(from, to)
    },
    unlinkSync(filePath) {
      events.push(`unlink:${path.basename(filePath)}`)
      if (overrides.unlinkSync) {
        overrides.unlinkSync(filePath)
        return
      }
      defaultAtomicDocumentFileOperations.unlinkSync(filePath)
    },
    writeSync(fd, data, offset, length) {
      events.push('write')
      if (overrides.writeSync) {
        return overrides.writeSync(fd, data, offset, length)
      }
      return defaultAtomicDocumentFileOperations.writeSync(fd, data, offset, length)
    },
  }
}

describe('writeAtomicDocument durability', () => {
  it('does not resolve until write-all, file fsync, close, rename, and directory fsync complete', () => {
    const destinationPath = createTempDocumentPath()
    const events: string[] = []
    const fileOps = createRecordingFileOps(events)
    const contents = `${JSON.stringify({ tokenRef: 'app-secret:api-token', note: 'Café' }, null, 2)}\n`

    writeAtomicDocument(destinationPath, contents, fileOps)

    const openIdx = events.findIndex((event) => event.startsWith('open:wx:'))
    const writeIdx = events.indexOf('write')
    const fsyncIdx = events.findIndex((event) => event.startsWith('fsync:'))
    const closeIdx = events.findIndex((event) => event.startsWith('close:'))
    const renameIdx = events.findIndex((event) => event.startsWith('rename:'))
    const dirSyncIdx = events.findIndex((event) => event.startsWith('fsyncDirectory:'))

    expect(openIdx).toBeGreaterThanOrEqual(0)
    expect(writeIdx).toBeGreaterThan(openIdx)
    expect(fsyncIdx).toBeGreaterThan(writeIdx)
    expect(closeIdx).toBeGreaterThan(fsyncIdx)
    expect(renameIdx).toBeGreaterThan(closeIdx)
    expect(dirSyncIdx).toBeGreaterThan(renameIdx)
    expect(fs.readFileSync(destinationPath, 'utf8')).toBe(contents)
    expect(fs.statSync(destinationPath).mode & 0o777).toBe(0o600)
  })

  it('leaves the original intact and closes descriptors when file fsync fails', () => {
    const destinationPath = createTempDocumentPath()
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
    const original = `${JSON.stringify({ apiToken: TOKEN_CANARY }, null, 2)}\n`
    fs.writeFileSync(destinationPath, original, 'utf8')

    const closed: number[] = []
    const opened: number[] = []
    const fileOps = createRecordingFileOps([], {
      closeSync(fd) {
        closed.push(fd)
        defaultAtomicDocumentFileOperations.closeSync(fd)
      },
      fsyncSync() {
        throw Object.assign(new Error('fsync failed'), { code: 'EIO' })
      },
      openSync(filePath, flags, mode) {
        const fd = defaultAtomicDocumentFileOperations.openSync(filePath, flags, mode)
        opened.push(fd)
        return fd
      },
    })

    expect(() => writeAtomicDocument(
      destinationPath,
      `${JSON.stringify({ ok: true }, null, 2)}\n`,
      fileOps,
    )).toThrow(/fsync failed/i)

    expect(fs.readFileSync(destinationPath, 'utf8')).toBe(original)
    expect(opened.length).toBeGreaterThan(0)
    expect(closed).toEqual(expect.arrayContaining(opened))
    expect(fs.readdirSync(path.dirname(destinationPath)).filter((entry) => entry.includes('.tmp'))).toEqual([])
  })

  it('propagates POSIX directory-fsync failures after rename and still closes the directory descriptor', () => {
    const destinationPath = createTempDocumentPath()
    const directoryFds: number[] = []
    const closed: number[] = []
    let directoryOpen = false

    const fileOps: AtomicDocumentFileOperations = {
      ...defaultAtomicDocumentFileOperations,
      closeSync(fd) {
        closed.push(fd)
        defaultAtomicDocumentFileOperations.closeSync(fd)
      },
      fsyncDirectory(directoryPath) {
        const fd = defaultAtomicDocumentFileOperations.openSync(directoryPath, 'r')
        directoryFds.push(fd)
        directoryOpen = true
        try {
          throw Object.assign(new Error('directory fsync failed'), { code: 'EIO' })
        } finally {
          defaultAtomicDocumentFileOperations.closeSync(fd)
          closed.push(fd)
          directoryOpen = false
        }
      },
    }

    expect(() => writeAtomicDocument(
      destinationPath,
      `${JSON.stringify({ ok: true }, null, 2)}\n`,
      fileOps,
    )).toThrow(/directory fsync failed/i)

    expect(directoryFds.length).toBe(1)
    expect(closed).toEqual(expect.arrayContaining(directoryFds))
    expect(directoryOpen).toBe(false)
    expect(String(Object.assign(new Error('directory fsync failed'), { code: 'EIO' }))).not.toContain(TOKEN_CANARY)
  })

  it.each(['EINVAL', 'EPERM'] as const)(
    'propagates injected directory-fsync %s failures on POSIX after rename',
    (code) => {
      expect(process.platform).not.toBe('win32')

      const destinationPath = createTempDocumentPath()
      const fileOps: AtomicDocumentFileOperations = {
        ...defaultAtomicDocumentFileOperations,
        fsyncDirectory() {
          throw Object.assign(new Error(`directory fsync ${code}`), { code })
        },
      }

      expect(() => writeAtomicDocument(
        destinationPath,
        `${JSON.stringify({ ok: true }, null, 2)}\n`,
        fileOps,
      )).toThrow(new RegExp(`directory fsync ${code}`))
      expect(JSON.parse(fs.readFileSync(destinationPath, 'utf8'))).toEqual({ ok: true })
    },
  )

  it('skips directory open/fsync only in the Windows default adapter', () => {
    const windowsOps = createDefaultAtomicDocumentFileOperations('win32')
    expect(() => windowsOps.fsyncDirectory('/nonexistent/win32-dir-fsync-skip')).not.toThrow()

    const posixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-atomic-posix-dir-'))
    expect(() => defaultAtomicDocumentFileOperations.fsyncDirectory(posixDir)).not.toThrow()
    expect(() => createDefaultAtomicDocumentFileOperations('darwin').fsyncDirectory(
      '/nonexistent/posix-dir-fsync-must-open',
    )).toThrow()
  })

  it('rejects write counts that exceed the remaining requested length', () => {
    const destinationPath = createTempDocumentPath()
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
    const original = `${JSON.stringify({ apiToken: TOKEN_CANARY }, null, 2)}\n`
    fs.writeFileSync(destinationPath, original, 'utf8')

    const fileOps = createRecordingFileOps([], {
      writeSync(_fd, _data, _offset, length) {
        return (length ?? 0) + 1
      },
    })

    expect(() => writeAtomicDocument(
      destinationPath,
      `${JSON.stringify({ next: true }, null, 2)}\n`,
      fileOps,
    )).toThrow(/write.*exceed|oversize|remaining/i)
    expect(fs.readFileSync(destinationPath, 'utf8')).toBe(original)
  })

  it('preserves the original on zero-progress writes and rename failures without canaries in diagnostics', () => {
    const destinationPath = createTempDocumentPath()
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
    const original = `${JSON.stringify({ apiToken: TOKEN_CANARY }, null, 2)}\n`
    fs.writeFileSync(destinationPath, original, 'utf8')

    const zeroOps = createRecordingFileOps([], {
      writeSync() {
        return 0
      },
    })
    let zeroError: unknown
    try {
      writeAtomicDocument(destinationPath, `${JSON.stringify({ next: true }, null, 2)}\n`, zeroOps)
    } catch (error) {
      zeroError = error
    }
    expect(zeroError).toBeTruthy()
    expect(String(zeroError)).not.toContain(TOKEN_CANARY)
    expect(fs.readFileSync(destinationPath, 'utf8')).toBe(original)

    const renameOps = createRecordingFileOps([], {
      renameSync() {
        throw Object.assign(new Error('rename failed'), { code: 'EPERM' })
      },
    })
    let renameError: unknown
    try {
      writeAtomicDocument(destinationPath, `${JSON.stringify({ next: true }, null, 2)}\n`, renameOps)
    } catch (error) {
      renameError = error
    }
    expect(renameError).toBeTruthy()
    expect(String(renameError)).not.toContain(TOKEN_CANARY)
    expect(JSON.stringify(renameError, Object.getOwnPropertyNames(renameError as object))).not.toContain(TOKEN_CANARY)
    expect(fs.readFileSync(destinationPath, 'utf8')).toBe(original)
    expect(fs.readdirSync(path.dirname(destinationPath)).filter((entry) => entry.includes('.tmp'))).toEqual([])
  })
})
