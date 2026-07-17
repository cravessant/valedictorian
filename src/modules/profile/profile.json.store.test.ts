import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineProfileStoreContract } from './profile.store.contract'
import { createJsonProfileStore } from './profile.json.store'
import { createJsonProfileService } from './profile.composition'
import { emptyProfileDocument } from './profile.revision'
import { serializeProfileJsonDocument } from './profile.json.document'
import {
  defaultProfileJsonFileOperations,
  writeProfileJsonAtomically,
  type ProfileJsonFileOperations,
} from './profile.json.atomic'
import { acquireProfileJsonLock } from './profile.json.lock'
import { profileBackupPath, profileLockPath, profileTempPath } from './profile.json.paths'
import { ProfileCapabilityError } from './profile.errors'
import { createMemoryProfileStores } from './profile.memory.store'
import { createProfileService } from './profile.service'

function tempProfilePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-profile-json-'))
  return path.join(directory, 'profile.json')
}

defineProfileStoreContract(() => ({
  store: createJsonProfileStore(tempProfilePath()),
}))

describe('JSON profile adapter', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.()
    }
  })

  it('initializes a pretty profile.json with only schemaVersion and profile', async () => {
    const profilePath = tempProfilePath()
    const store = createJsonProfileStore(profilePath)
    const document = await store.get()
    expect(document.schemaVersion).toBe(1)
    expect(document.revision).toEqual(expect.any(String))

    const onDisk = JSON.parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(onDisk).sort()).toEqual(['profile', 'schemaVersion'])
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(serializeProfileJsonDocument(document))
    expect(store.getLastKnownGoodPreview()).toBeNull()
  })

  it('serializes concurrent fresh get() initialization under the lock', async () => {
    const profilePath = tempProfilePath()
    const left = createJsonProfileStore(profilePath)
    const right = createJsonProfileStore(profilePath)
    const [a, b] = await Promise.all([left.get(), right.get()])
    expect(a).toEqual(b)
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(serializeProfileJsonDocument(a))
  })

  it('derives revisions from content and rejects stale concurrent writers', async () => {
    const profilePath = tempProfilePath()
    const left = createJsonProfileStore(profilePath)
    const right = createJsonProfileStore(profilePath)
    const initial = await left.get()

    const first = await left.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'one@example.com' },
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const conflict = await right.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'two@example.com' },
    })
    expect(conflict).toEqual({
      ok: false,
      code: 'profile_revision_conflict',
      document: expect.objectContaining({
        profile: expect.objectContaining({ email: 'one@example.com' }),
      }),
    })
    expect(JSON.parse(fs.readFileSync(profilePath, 'utf8')).profile.email).toBe('one@example.com')
  })

  it('recovers dead locks and only recovers malformed locks after grace', async () => {
    const profilePath = tempProfilePath()
    let currentTime = 1_000
    const store = createJsonProfileStore(profilePath, {
      isProcessAlive: (pid) => pid === 42,
      lockRetryIntervalMs: 1,
      lockTimeoutMs: 50,
      malformedLockGraceMs: 50,
      maxLockAgeMs: 10,
      now: () => currentTime,
      sleep: async () => {
        currentTime += 1
      },
    })
    const seeded = await store.get()

    const lockPath = profileLockPath(profilePath)
    fs.writeFileSync(lockPath, '{not-json', 'utf8')
    const freshMtime = new Date(currentTime)
    fs.utimesSync(lockPath, freshMtime, freshMtime)
    await expect(
      store.update({
        expectedRevision: seeded.revision,
        profile: { ...seeded.profile, email: 'blocked@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'profile_document_unavailable' })
    expect(fs.existsSync(lockPath)).toBe(true)

    currentTime = 1_200
    const agedMtime = new Date(currentTime - 100)
    fs.utimesSync(lockPath, agedMtime, agedMtime)
    const afterMalformed = await store.update({
      expectedRevision: seeded.revision,
      profile: { ...seeded.profile, email: 'after-malformed@example.com' },
    })
    expect(afterMalformed.ok).toBe(true)
    if (!afterMalformed.ok) return

    currentTime = 2_000
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: 999_999, acquiredAt: 1, token: 'dead' })}\n`,
      'utf8',
    )
    const activeTemp = profileTempPath(profilePath, 42, 'active')
    fs.writeFileSync(activeTemp, 'partial', 'utf8')
    const afterDead = await store.update({
      expectedRevision: afterMalformed.document.revision,
      profile: { ...afterMalformed.document.profile, email: 'after-dead@example.com' },
    })
    expect(afterDead.ok).toBe(true)
    expect(fs.existsSync(activeTemp)).toBe(true)
  })

  it('never steals an aged lock whose owner PID is still alive', async () => {
    const profilePath = tempProfilePath()
    let currentTime = 1_000
    const store = createJsonProfileStore(profilePath, {
      isProcessAlive: (pid) => pid === 77,
      lockRetryIntervalMs: 1,
      lockTimeoutMs: 40,
      maxLockAgeMs: 10,
      now: () => currentTime,
      sleep: async () => {
        currentTime += 1
      },
    })
    const seeded = await store.get()
    const before = fs.readFileSync(profilePath, 'utf8')
    const lockPath = profileLockPath(profilePath)
    const liveAgedPayload = { pid: 77, acquiredAt: 1, token: 'live-aged' }
    fs.writeFileSync(lockPath, `${JSON.stringify(liveAgedPayload)}\n`, 'utf8')
    currentTime = 2_000

    await expect(
      store.update({
        expectedRevision: seeded.revision,
        profile: { ...seeded.profile, email: 'stolen@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'profile_document_unavailable' })

    expect(fs.existsSync(lockPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toEqual(liveAgedPayload)
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(before)
  })

  it('releases only the owned lock token so a late first owner cannot unlink the second', async () => {
    const profilePath = tempProfilePath()
    let currentTime = 1_000
    const lockOptions = {
      lockRetryIntervalMs: 1,
      lockTimeoutMs: 1_000,
      maxLockAgeMs: 10,
      now: () => currentTime,
      sleep: async () => {
        currentTime += 1
      },
      // First owner is dead (stale), not merely aged while still alive.
      isProcessAlive: (pid: number) => pid !== 11,
    }
    const first = await acquireProfileJsonLock(profilePath, {
      ...lockOptions,
      ownershipToken: 'owner-one',
      pid: 11,
    })
    currentTime = 2_000
    const second = await acquireProfileJsonLock(profilePath, {
      ...lockOptions,
      ownershipToken: 'owner-two',
      pid: 22,
    })
    expect(JSON.parse(fs.readFileSync(profileLockPath(profilePath), 'utf8'))).toMatchObject({
      token: 'owner-two',
      pid: 22,
    })
    first.release()
    expect(JSON.parse(fs.readFileSync(profileLockPath(profilePath), 'utf8'))).toMatchObject({
      token: 'owner-two',
      pid: 22,
    })
    second.release()
    expect(fs.existsSync(profileLockPath(profilePath))).toBe(false)
  })
  it('writes through exclusive wx+fsync+rename and preserves current on injected failures', async () => {
    const profilePath = tempProfilePath()
    const initialStore = createJsonProfileStore(profilePath)
    const initial = await initialStore.get()
    const validBytes = fs.readFileSync(profilePath, 'utf8')

    const beforeRenameOps = createRecordingFileOps([])
    let failBeforeRename = true
    const failingFsyncOps: ProfileJsonFileOperations = {
      ...beforeRenameOps,
      fsyncSync(fd) {
        if (failBeforeRename) {
          failBeforeRename = false
          throw Object.assign(new Error('fsync failed'), { code: 'EIO' })
        }
        beforeRenameOps.fsyncSync(fd)
      },
    }
    await expect(
      createJsonProfileStore(profilePath, { fileOps: failingFsyncOps }).update({
        expectedRevision: initial.revision,
        profile: { ...initial.profile, email: 'fsync-fail@example.com' },
      }),
    ).rejects.toBeTruthy()
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(validBytes)

    const renameFailOps: ProfileJsonFileOperations = {
      ...createRecordingFileOps([]),
      renameSync() {
        throw Object.assign(new Error('rename failed'), { code: 'EPERM' })
      },
    }
    await expect(
      createJsonProfileStore(profilePath, { fileOps: renameFailOps }).update({
        expectedRevision: initial.revision,
        profile: { ...initial.profile, email: 'rename-fail@example.com' },
      }),
    ).rejects.toBeTruthy()
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(validBytes)
    const orphans = fs
      .readdirSync(path.dirname(profilePath))
      .filter((entry) => entry.endsWith('.tmp'))
    expect(orphans.length).toBeGreaterThan(0)

    const recovered = await createJsonProfileStore(profilePath).update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'recovered@example.com' },
    })
    expect(recovered.ok).toBe(true)
    expect(fs.readdirSync(path.dirname(profilePath)).some((entry) => entry.endsWith('.tmp'))).toBe(
      false,
    )

    const unknownDirSync: ProfileJsonFileOperations = {
      ...defaultProfileJsonFileOperations,
      fsyncDirectory() {
        throw Object.assign(new Error('unexpected'), { code: 'EIO' })
      },
    }
    await expect(
      createJsonProfileStore(profilePath, { fileOps: unknownDirSync }).update({
        expectedRevision: (await createJsonProfileStore(profilePath).get()).revision,
        profile: { ...initial.profile, email: 'dirsync@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'EIO' })
    expect(JSON.parse(fs.readFileSync(profilePath, 'utf8')).profile.email).toBe(
      'recovered@example.com',
    )

    const ignoredDirSync: ProfileJsonFileOperations = {
      ...defaultProfileJsonFileOperations,
      fsyncDirectory() {
        throw Object.assign(new Error('unsupported'), { code: 'EINVAL' })
      },
    }
    const ignored = await createJsonProfileStore(profilePath, { fileOps: ignoredDirSync }).update({
      expectedRevision: (await createJsonProfileStore(profilePath).get()).revision,
      profile: { ...initial.profile, email: 'ignored-dirsync@example.com' },
    })
    expect(ignored.ok).toBe(true)
  })

  it('maps permission read failures to unavailable without initializing', async () => {
    const profilePath = tempProfilePath()
    const hostileOps: ProfileJsonFileOperations = {
      ...defaultProfileJsonFileOperations,
      readFileSync(target, encoding) {
        if (target === profilePath) {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        }
        return defaultProfileJsonFileOperations.readFileSync(target, encoding)
      },
      existsSync(target) {
        if (target === profilePath) return true
        return defaultProfileJsonFileOperations.existsSync(target)
      },
    }
    await expect(createJsonProfileStore(profilePath, { fileOps: hostileOps }).get()).rejects.toMatchObject(
      {
        code: 'profile_document_unavailable',
      },
    )
    expect(fs.existsSync(profilePath)).toBe(false)
  })

  it('refuses null-revision restore when current exists but is unreadable', async () => {
    const profilePath = tempProfilePath()
    const seed = createJsonProfileStore(profilePath)
    const initial = await seed.get()
    await seed.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'backup@example.com' },
    })
    seed.dispose()

    const currentBytes = fs.readFileSync(profilePath, 'utf8')
    const backupBytes = fs.readFileSync(profileBackupPath(profilePath), 'utf8')
    const ops = createRecordingFileOps([])
    const documentWrites: string[] = []
    const documentRenames: Array<[string, string]> = []
    const hostileOps: ProfileJsonFileOperations = {
      ...ops,
      readFileSync(target, encoding) {
        if (target === profilePath) {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        }
        return ops.readFileSync(target, encoding)
      },
      writeSync(fd, data, offset, length) {
        return ops.writeSync(fd, data, offset, length)
      },
      writeFileSync(target, data, options) {
        if (target === profilePath || target === profileBackupPath(profilePath)) {
          documentWrites.push(typeof data === 'string' ? data : String(data))
        }
        ops.writeFileSync(target, data, options)
      },
      renameSync(from, to) {
        if (
          to === profilePath ||
          to === profileBackupPath(profilePath) ||
          from === profilePath ||
          from === profileBackupPath(profilePath)
        ) {
          documentRenames.push([from, to])
        }
        ops.renameSync(from, to)
      },
    }

    await expect(
      createJsonProfileStore(profilePath, { fileOps: hostileOps }).restore({
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ code: 'profile_document_unavailable' })

    expect(fs.readFileSync(profilePath, 'utf8')).toBe(currentBytes)
    expect(fs.readFileSync(profileBackupPath(profilePath), 'utf8')).toBe(backupBytes)
    expect(documentWrites).toEqual([])
    expect(documentRenames).toEqual([])
  })

  it('never overwrites an existing temp name when creating atomic writers', () => {
    const profilePath = tempProfilePath()
    fs.mkdirSync(path.dirname(profilePath), { recursive: true })
    const existing = profileTempPath(profilePath, 7, 'fixed')
    fs.writeFileSync(existing, 'keep-me', 'utf8')
    expect(() =>
      writeProfileJsonAtomically({
        profilePath,
        contents: '{"ok":true}\n',
        pid: 7,
        nonce: 'fixed',
      }),
    ).toThrow()
    expect(fs.readFileSync(existing, 'utf8')).toBe('keep-me')
  })

  it('writes through temp+fsync+rename, keeps one backup, and restores explicitly', async () => {
    const profilePath = tempProfilePath()
    const fsynced: string[] = []
    const store = createJsonProfileStore(profilePath, {
      fileOps: createRecordingFileOps(fsynced),
    })
    const initial = await store.get()
    const updated = await store.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'kenny@example.com' },
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(fs.existsSync(profileBackupPath(profilePath))).toBe(true)
    expect(fsynced.length).toBeGreaterThan(0)

    const restored = await store.restore({ expectedRevision: updated.document.revision })
    expect(restored.profile.email).toBeNull()
    expect(JSON.parse(fs.readFileSync(profilePath, 'utf8')).profile.email).toBeNull()

    fs.writeFileSync(profilePath, '{bad', 'utf8')
    const recovered = await store.restore({ expectedRevision: null })
    expect(recovered.revision).toEqual(expect.any(String))
    expect(JSON.parse(fs.readFileSync(profilePath, 'utf8'))).toMatchObject({ schemaVersion: 1 })
  })

  it('enforces format/restore/backup edge contracts without mutating invalid bytes', async () => {
    const profilePath = tempProfilePath()
    const store = createJsonProfileStore(profilePath)
    const initial = await store.get()
    const first = await store.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'one@example.com' },
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await store.update({
      expectedRevision: first.document.revision,
      profile: { ...first.document.profile, email: 'two@example.com' },
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(JSON.parse(fs.readFileSync(profileBackupPath(profilePath), 'utf8')).profile.email).toBe(
      'one@example.com',
    )

    const beforeFormat = fs.readFileSync(profilePath, 'utf8')
    const formatted = await store.format({ expectedRevision: second.document.revision })
    expect(formatted.revision).toBe(second.document.revision)
    expect(JSON.parse(fs.readFileSync(profileBackupPath(profilePath), 'utf8')).profile.email).toBe(
      'one@example.com',
    )
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(
      beforeFormat === serializeProfileJsonDocument(second.document)
        ? beforeFormat
        : serializeProfileJsonDocument(second.document),
    )

    await expect(store.restore({ expectedRevision: null })).rejects.toMatchObject({
      code: 'profile_revision_conflict',
    })

    fs.writeFileSync(profilePath, '{bad', 'utf8')
    await expect(store.format({ expectedRevision: second.document.revision })).rejects.toMatchObject({
      code: 'invalid_profile_document',
    })
    expect(fs.readFileSync(profilePath, 'utf8')).toBe('{bad')

    fs.writeFileSync(profileBackupPath(profilePath), '{bad-backup', 'utf8')
    await expect(store.restore({ expectedRevision: null })).rejects.toMatchObject({
      code: 'profile_backup_unavailable',
    })
    expect(fs.readFileSync(profilePath, 'utf8')).toBe('{bad')
  })

  it('blocks mutations while current is invalid and exposes stale read-only LKG only then', async () => {
    const profilePath = tempProfilePath()
    const store = createJsonProfileStore(profilePath)
    const initial = await store.get()
    await store.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'kenny@example.com' },
    })
    expect(store.getLastKnownGoodPreview()).toBeNull()
    fs.writeFileSync(profilePath, '{bad', 'utf8')

    await expect(store.get()).rejects.toMatchObject({ code: 'invalid_profile_document' })
    await expect(
      store.update({
        expectedRevision: initial.revision,
        profile: { ...initial.profile, email: 'other@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_profile_document' })

    const preview = store.getLastKnownGoodPreview()
    expect(preview).toEqual({
      document: expect.objectContaining({
        profile: expect.objectContaining({ email: 'kenny@example.com' }),
      }),
      stale: true,
      readOnly: true,
    })
    expect(fs.readFileSync(profilePath, 'utf8')).toBe('{bad')
  })

  it('loads valid on-disk backup as stale LKG for a fresh adapter with invalid current', async () => {
    const profilePath = tempProfilePath()
    const first = createJsonProfileStore(profilePath)
    const initial = await first.get()
    await first.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'kenny@example.com' },
    })
    first.dispose()
    fs.writeFileSync(profilePath, '{bad', 'utf8')

    const second = createJsonProfileStore(profilePath)
    await expect(second.get()).rejects.toMatchObject({ code: 'invalid_profile_document' })
    expect(second.getLastKnownGoodPreview()).toEqual({
      document: expect.objectContaining({
        profile: expect.objectContaining({ email: null }),
      }),
      stale: true,
      readOnly: true,
    })

    fs.writeFileSync(profileBackupPath(profilePath), '{bad-backup', 'utf8')
    const third = createJsonProfileStore(profilePath)
    await expect(third.get()).rejects.toMatchObject({ code: 'invalid_profile_document' })
    expect(third.getLastKnownGoodPreview()).toBeNull()
  })

  it('emits debounced valid/invalid external changes, suppresses self-writes, and stops on dispose', async () => {
    vi.useFakeTimers()
    const profilePath = tempProfilePath()
    let watchCallback: ((eventType: string, filename: string | Buffer | null) => void) | null =
      null
    let watchStarts = 0
    const store = createJsonProfileStore(profilePath, {
      debounceMs: 20,
      now: () => Date.now(),
      setTimeoutFn: (callback, ms) => setTimeout(callback, ms),
      clearTimeoutFn: (handle) => clearTimeout(handle),
      watchFn: ((_directory, _options, listener) => {
        watchStarts += 1
        watchCallback = listener as (eventType: string, filename: string | Buffer | null) => void
        return {
          close() {
            watchCallback = null
          },
        } as fs.FSWatcher
      }) as typeof fs.watch,
    })
    cleanups.push(() => {
      store.dispose()
      vi.useRealTimers()
    })
    const events: Array<{ kind: string }> = []
    const unsubscribe = store.subscribe((event) => {
      events.push({ kind: event.kind })
    })
    expect(watchCallback).toEqual(expect.any(Function))
    expect(watchStarts).toBe(1)

    const initial = await store.get()
    await store.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'self@example.com' },
    })
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toEqual([])

    const validExternal = serializeProfileJsonDocument({
      ...emptyProfileDocument(),
      profile: { ...emptyProfileDocument().profile, email: 'external@example.com' },
      revision: 'ignored',
    })
    fs.writeFileSync(profilePath, validExternal, 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events.at(-1)).toEqual({ kind: 'valid' })

    fs.writeFileSync(profilePath, '{bad', 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events.at(-1)).toEqual({ kind: 'invalid' })

    unsubscribe()
    expect(watchCallback).toBeNull()
    events.length = 0
    fs.writeFileSync(profilePath, serializeProfileJsonDocument(emptyProfileDocument()), 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toEqual([])

    const again = store.subscribe((event) => events.push({ kind: event.kind }))
    expect(watchStarts).toBe(2)
    expect(watchCallback).toEqual(expect.any(Function))
    fs.writeFileSync(profilePath, validExternal, 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events.at(-1)).toEqual({ kind: 'valid' })

    store.dispose()
    store.dispose()
    events.length = 0
    fs.writeFileSync(profilePath, '{bad-again', 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toEqual([])
    again()
  })

  it('maps missing current with backup evidence to unavailable and never promotes temps', async () => {
    const profilePath = tempProfilePath()
    const store = createJsonProfileStore(profilePath)
    const initial = await store.get()
    await store.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'kenny@example.com' },
    })
    fs.unlinkSync(profilePath)
    expect(fs.existsSync(profileBackupPath(profilePath))).toBe(true)
    await expect(store.get()).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })

    const orphan = profileTempPath(profilePath, process.pid, 'orphan')
    fs.writeFileSync(orphan, serializeProfileJsonDocument(emptyProfileDocument()), 'utf8')
    fs.unlinkSync(profileBackupPath(profilePath))
    await expect(store.get()).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })
    expect(fs.existsSync(profilePath)).toBe(false)
  })

  it('observes orphan temp recovery evidence before cleanup and never initializes defaults', async () => {
    const profilePath = tempProfilePath()
    fs.mkdirSync(path.dirname(profilePath), { recursive: true })
    const orphan = profileTempPath(profilePath, 4242, 'orphan')
    const orphanBytes = serializeProfileJsonDocument({
      ...emptyProfileDocument(),
      profile: { ...emptyProfileDocument().profile, email: 'orphan@example.com' },
      revision: 'ignored',
    })
    fs.writeFileSync(orphan, orphanBytes, 'utf8')
    expect(fs.existsSync(profilePath)).toBe(false)
    expect(fs.existsSync(profileBackupPath(profilePath))).toBe(false)

    const store = createJsonProfileStore(profilePath, {
      isProcessAlive: () => false,
    })
    await expect(store.get()).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })
    expect(fs.existsSync(profilePath)).toBe(false)
    expect(fs.existsSync(profileBackupPath(profilePath))).toBe(false)
    // Orphan may be cleaned only after evidence was recorded.
    expect(fs.existsSync(orphan)).toBe(false)

    await expect(
      store.update({
        expectedRevision: 'any',
        profile: emptyProfileDocument().profile,
      }),
    ).rejects.toMatchObject({ code: 'profile_document_unavailable' })
    await expect(store.format({ expectedRevision: 'any' })).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })
    expect(fs.existsSync(profilePath)).toBe(false)

    const freshPath = tempProfilePath()
    const fresh = createJsonProfileStore(freshPath)
    const initialized = await fresh.get()
    expect(initialized.schemaVersion).toBe(1)
    expect(fs.existsSync(freshPath)).toBe(true)
  })

  it('remembers observed invalid or unsupported current and never reinitializes after delete', async () => {
    const invalidPath = tempProfilePath()
    fs.mkdirSync(path.dirname(invalidPath), { recursive: true })
    fs.writeFileSync(invalidPath, '{bad', 'utf8')
    const invalidStore = createJsonProfileStore(invalidPath)
    await expect(invalidStore.get()).rejects.toMatchObject({ code: 'invalid_profile_document' })
    fs.unlinkSync(invalidPath)
    await expect(invalidStore.get()).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })
    await expect(
      invalidStore.update({
        expectedRevision: 'any',
        profile: emptyProfileDocument().profile,
      }),
    ).rejects.toMatchObject({ code: 'profile_document_unavailable' })
    await expect(invalidStore.format({ expectedRevision: 'any' })).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })
    expect(fs.existsSync(invalidPath)).toBe(false)

    const unsupportedPath = tempProfilePath()
    fs.mkdirSync(path.dirname(unsupportedPath), { recursive: true })
    fs.writeFileSync(
      unsupportedPath,
      `${JSON.stringify({ schemaVersion: 99, profile: emptyProfileDocument().profile }, null, 2)}\n`,
      'utf8',
    )
    const unsupportedStore = createJsonProfileStore(unsupportedPath)
    await expect(unsupportedStore.get()).rejects.toMatchObject({
      code: 'unsupported_profile_schema_version',
    })
    fs.unlinkSync(unsupportedPath)
    await expect(unsupportedStore.get()).rejects.toMatchObject({
      code: 'profile_document_unavailable',
    })
    expect(fs.existsSync(unsupportedPath)).toBe(false)
  })

  it('clears self-write suppression after intervening external content so returning to A emits', async () => {
    vi.useFakeTimers()
    const profilePath = tempProfilePath()
    let currentTime = 1_000
    let watchCallback: ((eventType: string, filename: string | Buffer | null) => void) | null =
      null
    const store = createJsonProfileStore(profilePath, {
      debounceMs: 20,
      now: () => currentTime,
      setTimeoutFn: (callback, ms) => setTimeout(callback, ms),
      clearTimeoutFn: (handle) => clearTimeout(handle),
      watchFn: ((_directory, _options, listener) => {
        watchCallback = listener as (eventType: string, filename: string | Buffer | null) => void
        return {
          close() {
            watchCallback = null
          },
        } as fs.FSWatcher
      }) as typeof fs.watch,
    })
    cleanups.push(() => {
      store.dispose()
      vi.useRealTimers()
    })

    const events: Array<{ kind: string; email?: string | null }> = []
    store.subscribe((event) => {
      events.push({
        kind: event.kind,
        email: event.kind === 'valid' ? event.document.profile.email : undefined,
      })
    })

    const initial = await store.get()
    const writtenA = await store.update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'coop-a@example.com' },
    })
    expect(writtenA.ok).toBe(true)
    if (!writtenA.ok) return
    const bytesA = fs.readFileSync(profilePath, 'utf8')
    expect(events).toEqual([])

    currentTime += 1_000
    const bytesB = serializeProfileJsonDocument({
      ...emptyProfileDocument(),
      profile: { ...emptyProfileDocument().profile, email: 'external-b@example.com' },
      revision: 'ignored',
    })
    fs.writeFileSync(profilePath, bytesB, 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events.at(-1)).toEqual({ kind: 'valid', email: 'external-b@example.com' })
    expect(store.getLastKnownGoodPreview()).toBeNull()

    currentTime += 1_000
    events.length = 0
    fs.writeFileSync(profilePath, bytesA, 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events.at(-1)).toEqual({ kind: 'valid', email: 'coop-a@example.com' })
    expect(store.getLastKnownGoodPreview()).toBeNull()
    expect(JSON.parse(fs.readFileSync(profileBackupPath(profilePath), 'utf8')).profile.email).toBe(
      'external-b@example.com',
    )
  })

  it('bounds self-write suppression so repeated writes do not retain every fingerprint', async () => {
    vi.useFakeTimers()
    const profilePath = tempProfilePath()
    let watchCallback: ((eventType: string, filename: string | Buffer | null) => void) | null =
      null
    const store = createJsonProfileStore(profilePath, {
      debounceMs: 20,
      now: () => Date.now(),
      setTimeoutFn: (callback, ms) => setTimeout(callback, ms),
      clearTimeoutFn: (handle) => clearTimeout(handle),
      watchFn: ((_directory, _options, listener) => {
        watchCallback = listener as (eventType: string, filename: string | Buffer | null) => void
        return {
          close() {
            watchCallback = null
          },
        } as fs.FSWatcher
      }) as typeof fs.watch,
    })
    cleanups.push(() => {
      store.dispose()
      vi.useRealTimers()
    })

    const events: Array<{ kind: string }> = []
    store.subscribe((event) => {
      events.push({ kind: event.kind })
    })

    let current = await store.get()
    const early = await store.update({
      expectedRevision: current.revision,
      profile: { ...current.profile, email: 'early@example.com' },
    })
    expect(early.ok).toBe(true)
    if (!early.ok) return
    current = early.document
    const earlyBytes = fs.readFileSync(profilePath, 'utf8')

    for (let index = 0; index < 40; index += 1) {
      const next = await store.update({
        expectedRevision: current.revision,
        profile: { ...current.profile, email: `batch-${index}@example.com` },
      })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      current = next.document
    }

    // Older self-write fingerprints must not be retained forever.
    fs.writeFileSync(profilePath, earlyBytes, 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events.at(-1)).toEqual({ kind: 'valid' })

    events.length = 0
    const latest = await store.update({
      expectedRevision: (await store.get()).revision,
      profile: { ...current.profile, email: 'latest-self@example.com' },
    })
    expect(latest.ok).toBe(true)
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toEqual([])
  })

  it('propagates format, restore, notifications, and disposal through the JSON service', async () => {
    vi.useFakeTimers()
    const profilePath = tempProfilePath()
    let watchCallback: ((eventType: string, filename: string | Buffer | null) => void) | null =
      null
    const service = createJsonProfileService(profilePath, {
      debounceMs: 20,
      setTimeoutFn: (callback, ms) => setTimeout(callback, ms),
      clearTimeoutFn: (handle) => clearTimeout(handle),
      watchFn: ((_directory, _options, listener) => {
        watchCallback = listener as (eventType: string, filename: string | Buffer | null) => void
        return {
          close() {
            watchCallback = null
          },
        } as fs.FSWatcher
      }) as typeof fs.watch,
    })
    cleanups.push(() => {
      service.dispose()
      vi.useRealTimers()
    })

    const created = await service.update({ email: 'kenny@example.com' })
    const document = await service.getDocument()
    expect(document.profile.email).toBe(created.email)
    expect(service.getLastKnownGoodPreview()).toBeNull()

    const formatted = await service.formatDocument({ expectedRevision: document.revision })
    expect(formatted.revision).toBe(document.revision)
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(serializeProfileJsonDocument(formatted))

    const restored = await service.restoreDocument({ expectedRevision: document.revision })
    expect(restored.profile.email).toBeNull()

    const events: Array<{ kind: string }> = []
    const unsubscribe = service.subscribe((event) => events.push({ kind: event.kind }))
    fs.writeFileSync(profilePath, '{bad', 'utf8')
    watchCallback?.('change', 'profile.json')
    await vi.advanceTimersByTimeAsync(100)
    expect(events.at(-1)).toEqual({ kind: 'invalid' })
    expect(service.getLastKnownGoodPreview()?.stale).toBe(true)
    unsubscribe()
    service.dispose()
    service.dispose()

    const memory = createMemoryProfileStores()
    const fallback = createProfileService(memory)
    expect(fallback.getLastKnownGoodPreview()).toBeNull()
    expect(fallback.subscribe(() => {})).toEqual(expect.any(Function))
    fallback.dispose()
  })

  it('keeps ProfileCapabilityError filePath local-only for invalid current content', async () => {
    const profilePath = tempProfilePath()
    const store = createJsonProfileStore(profilePath)
    await store.get()
    fs.writeFileSync(profilePath, '{', 'utf8')
    try {
      await store.get()
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileCapabilityError)
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        filePath: profilePath,
      })
      expect(JSON.stringify((error as ProfileCapabilityError).body)).not.toContain(profilePath)
    }
  })
})

function createRecordingFileOps(fsynced: string[]): ProfileJsonFileOperations {
  return {
    fsyncSync(fd: number) {
      fsynced.push(`fd:${fd}`)
      fs.fsyncSync(fd)
    },
    fsyncDirectory(dir: string) {
      fsynced.push(dir)
      const fd = fs.openSync(dir, 'r')
      try {
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    },
    openSync: (filePath: string, flags: string, mode?: number) => fs.openSync(filePath, flags, mode),
    closeSync: (fd: number) => fs.closeSync(fd),
    writeSync: (fd: number, data: string | Buffer, offset?: number, length?: number) => {
      if (typeof data === 'string') {
        return fs.writeSync(fd, data)
      }
      return fs.writeSync(fd, data, offset, length)
    },
    writeFileSync: (filePath: string, data: string, options?: fs.WriteFileOptions) =>
      fs.writeFileSync(filePath, data, options),
    readFileSync: (filePath: string, encoding: BufferEncoding) => fs.readFileSync(filePath, encoding),
    renameSync: (from: string, to: string) => fs.renameSync(from, to),
    unlinkSync: (filePath: string) => fs.unlinkSync(filePath),
    existsSync: (filePath: string) => fs.existsSync(filePath),
    readdirSync: (dir: string) => fs.readdirSync(dir),
    mkdirSync: (dir: string, options?: fs.MakeDirectoryOptions) => {
      fs.mkdirSync(dir, options)
    },
    statSync: (filePath: string) => fs.statSync(filePath),
  }
}

describe('JSON profile short-write completion', () => {
  it('loops document temp writes until the full UTF-8 payload is written', async () => {
    const profilePath = tempProfilePath()
    const seed = createJsonProfileStore(profilePath)
    const initial = await seed.get()
    seed.dispose()

    let writeCalls = 0
    const shortOps: ProfileJsonFileOperations = {
      ...defaultProfileJsonFileOperations,
      writeSync(fd, data, offset = 0, length) {
        writeCalls += 1
        const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
        const remaining = length ?? buffer.length - offset
        const chunk = Math.min(3, remaining)
        if (chunk <= 0) return 0
        return fs.writeSync(fd, buffer, offset, chunk)
      },
    }

    const updated = await createJsonProfileStore(profilePath, { fileOps: shortOps }).update({
      expectedRevision: initial.revision,
      profile: { ...initial.profile, email: 'café@example.com' },
    })
    expect(updated.ok).toBe(true)
    expect(writeCalls).toBeGreaterThan(1)
    expect(JSON.parse(fs.readFileSync(profilePath, 'utf8')).profile.email).toBe('café@example.com')
  })

  it('fails closed on zero document write progress before rename', async () => {
    const profilePath = tempProfilePath()
    const seed = createJsonProfileStore(profilePath)
    const initial = await seed.get()
    const before = fs.readFileSync(profilePath, 'utf8')
    seed.dispose()

    const zeroOps: ProfileJsonFileOperations = {
      ...defaultProfileJsonFileOperations,
      writeSync() {
        return 0
      },
    }
    await expect(
      createJsonProfileStore(profilePath, { fileOps: zeroOps }).update({
        expectedRevision: initial.revision,
        profile: { ...initial.profile, email: 'zero@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'profile_document_unavailable' })
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(before)
  })

  it('loops lock payload writes including non-ASCII JSON before entering owned work', async () => {
    const profilePath = tempProfilePath()
    fs.mkdirSync(path.dirname(profilePath), { recursive: true })
    let writeCalls = 0
    const shortOps: ProfileJsonFileOperations = {
      ...defaultProfileJsonFileOperations,
      writeSync(fd, data, offset = 0, length) {
        writeCalls += 1
        const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
        const remaining = length ?? buffer.length - offset
        const chunk = Math.min(2, remaining)
        if (chunk <= 0) return 0
        return fs.writeSync(fd, buffer, offset, chunk)
      },
    }

    const lock = await acquireProfileJsonLock(profilePath, {
      fileOps: shortOps,
      ownershipToken: 'tokén-å',
      pid: 55,
    })
    expect(writeCalls).toBeGreaterThan(1)
    expect(JSON.parse(fs.readFileSync(profileLockPath(profilePath), 'utf8'))).toMatchObject({
      token: 'tokén-å',
      pid: 55,
    })
    lock.release()
  })

  it('does not treat a partial lock write as owned success', async () => {
    const profilePath = tempProfilePath()
    fs.mkdirSync(path.dirname(profilePath), { recursive: true })
    const zeroOps: ProfileJsonFileOperations = {
      ...defaultProfileJsonFileOperations,
      writeSync() {
        return 0
      },
    }
    await expect(
      acquireProfileJsonLock(profilePath, {
        fileOps: zeroOps,
        ownershipToken: 'partial',
        lockTimeoutMs: 10,
        lockRetryIntervalMs: 1,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'profile_document_unavailable' })
    expect(fs.existsSync(profileLockPath(profilePath))).toBe(false)
  })
})
