import path from 'node:path'
import type { ProfileDocument, ProfileDocumentFormatInput, ProfileDocumentRestoreInput } from '@sparxie/sdk'
import type {
  JsonProfileAdapter,
  ProfileDocumentChangeEvent,
  ProfileDocumentCapability,
  ProfileLastKnownGoodPreview,
} from './profile.document.capability.js'
import {
  ProfileCapabilityError,
  profileDocumentError,
} from './profile.errors.js'
import {
  cleanOrphanProfileTemps,
  defaultProfileJsonFileOperations,
  profileBackupPath,
  readOptionalText,
  writeProfileJsonAtomically,
  type ProfileJsonFileOperations,
} from './profile.json.atomic.js'
import {
  parseProfileJsonDocument,
  serializeProfileJsonDocument,
} from './profile.json.document.js'
import { withProfileJsonLock, type ProfileJsonLockOptions } from './profile.json.lock.js'
import { createProfileJsonWatcher, type ProfileJsonWatchOptions } from './profile.json.watch.js'
import { emptyProfileDocument } from './profile.revision.js'
import type { ProfileStoreUpdateResult } from './profile.store.js'

export interface CreateJsonProfileStoreOptions
  extends ProfileJsonLockOptions, ProfileJsonWatchOptions {
  fileOps?: ProfileJsonFileOperations
}

type CurrentDocumentStatus = 'unknown' | 'valid' | 'invalid' | 'unavailable'

export function createJsonProfileStore(
  profilePath: string,
  options: CreateJsonProfileStoreOptions = {},
): JsonProfileAdapter {
  const fileOps = options.fileOps ?? defaultProfileJsonFileOperations
  const now = options.now ?? Date.now
  const listeners = new Set<(event: ProfileDocumentChangeEvent) => void>()
  let disposed = false
  let observedCurrent = false
  let observedRecoveryEvidence = false
  let currentStatus: CurrentDocumentStatus = 'unknown'
  let lastKnownGood: ProfileDocument | null = null
  let lastEmittedFingerprint: string | null = null
  let selfWriteFingerprint: string | null = null
  let suppressWatchUntil = 0
  let watchBackupFingerprint: string | null = null

  const watcher = createProfileJsonWatcher(
    profilePath,
    () => {
      void handleExternalChange().catch((error) => {
        const capabilityError =
          error instanceof ProfileCapabilityError
            ? error
            : profileDocumentError('profile_document_unavailable', { filePath: profilePath })
        markCurrentUnavailable(capabilityError)
        emitInvalid(capabilityError)
      })
    },
    options,
  )

  const adapter: JsonProfileAdapter = {
    async get() {
      assertNotDisposed()
      return withProfileJsonLock(profilePath, lockOptions(), async () => {
        observeRecoveryEvidenceThenCleanOrphans()
        return readCurrentDocument({ initializeIfMissing: true }).document
      })
    },

    async update(input): Promise<ProfileStoreUpdateResult> {
      assertNotDisposed()
      return withProfileJsonLock(profilePath, lockOptions(), async () => {
        observeRecoveryEvidenceThenCleanOrphans()
        const current = readCurrentDocument({ initializeIfMissing: true })
        if (current.document.revision !== input.expectedRevision) {
          return {
            ok: false as const,
            code: 'profile_revision_conflict' as const,
            document: current.document,
          }
        }

        const nextDocument: ProfileDocument = {
          profile: input.profile,
          revision: '',
          schemaVersion: current.document.schemaVersion,
        }
        const serializedProbe = serializeProfileJsonDocument({
          ...nextDocument,
          revision: 'pending',
        })
        const validated = parseProfileJsonDocument(serializedProbe, profilePath).document
        if (validated.revision === current.document.revision) {
          return { ok: true as const, document: current.document }
        }

        persistValidatedDocument(validated, {
          previousValidText: current.text,
          rotateBackup: true,
        })
        return { ok: true as const, document: validated }
      })
    },

    async format(input: ProfileDocumentFormatInput): Promise<ProfileDocument> {
      assertNotDisposed()
      return withProfileJsonLock(profilePath, lockOptions(), async () => {
        observeRecoveryEvidenceThenCleanOrphans()
        const current = readCurrentDocument({ initializeIfMissing: true })
        if (current.document.revision !== input.expectedRevision) {
          throw profileDocumentError('profile_revision_conflict', { filePath: profilePath })
        }
        const canonical = serializeProfileJsonDocument(current.document)
        if (canonical === current.text) {
          return current.document
        }
        persistValidatedDocument(current.document, {
          previousValidText: current.text,
          rotateBackup: false,
          contents: canonical,
        })
        return current.document
      })
    },

    async restore(input: ProfileDocumentRestoreInput): Promise<ProfileDocument> {
      assertNotDisposed()
      return withProfileJsonLock(profilePath, lockOptions(), async () => {
        observeRecoveryEvidenceThenCleanOrphans()
        const backupText = readOptionalText(profileBackupPath(profilePath), fileOps)
        if (backupText == null) {
          throw profileDocumentError('profile_backup_unavailable', { filePath: profilePath })
        }

        let backupDocument: ProfileDocument
        try {
          backupDocument = parseProfileJsonDocument(backupText, profilePath).document
        } catch {
          throw profileDocumentError('profile_backup_unavailable', { filePath: profilePath })
        }

        const currentResult = tryReadCurrentDocument()
        if (currentResult.kind === 'unavailable') {
          throw currentResult.error
        }
        if (currentResult.kind === 'valid') {
          if (input.expectedRevision !== currentResult.document.revision) {
            throw profileDocumentError('profile_revision_conflict', { filePath: profilePath })
          }
          persistValidatedDocument(backupDocument, {
            previousValidText: currentResult.text,
            rotateBackup: true,
          })
          return backupDocument
        }

        // Missing (ENOENT) or successfully read-and-parsed invalid content only.
        if (input.expectedRevision !== null) {
          throw profileDocumentError('profile_revision_conflict', { filePath: profilePath })
        }

        persistValidatedDocument(backupDocument, {
          previousValidText: null,
          rotateBackup: false,
        })
        return backupDocument
      })
    },

    subscribe(listener) {
      assertNotDisposed()
      listeners.add(listener)
      if (listeners.size === 1) {
        seedWatcherStateFromDisk()
        watcher.start()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) watcher.stop()
      }
    },

    getLastKnownGoodPreview(): ProfileLastKnownGoodPreview | null {
      if (currentStatus === 'unknown') {
        probeCurrentStatusForPreview()
      }
      if (currentStatus === 'valid') return null
      const document = lastKnownGood ?? readBackupPreviewDocument()
      if (!document) return null
      lastKnownGood = document
      return {
        document,
        stale: true,
        readOnly: true,
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      watcher.stop()
    },
  }

  return adapter

  function lockOptions(): ProfileJsonLockOptions {
    return {
      fileOps,
      isProcessAlive: options.isProcessAlive,
      lockRetryIntervalMs: options.lockRetryIntervalMs,
      lockTimeoutMs: options.lockTimeoutMs,
      malformedLockGraceMs: options.malformedLockGraceMs,
      maxLockAgeMs: options.maxLockAgeMs,
      now,
      pid: options.pid,
      sleep: options.sleep,
    }
  }

  function assertNotDisposed() {
    if (disposed) {
      throw profileDocumentError('profile_document_unavailable', { filePath: profilePath })
    }
  }

  function cleanOrphansUnderLock(): void {
    cleanOrphanProfileTemps(profilePath, {
      fileOps,
      isProcessAlive: options.isProcessAlive,
      ownPid: options.pid,
    })
  }

  function observeRecoveryEvidenceThenCleanOrphans(): void {
    // Record evidence before cleanup can erase orphan tmp markers.
    if (hasDiskRecoveryEvidence()) {
      observedRecoveryEvidence = true
    }
    cleanOrphansUnderLock()
  }

  function readCurrentDocument(optionsInternal: { initializeIfMissing: boolean }): {
    document: ProfileDocument
    text: string
  } {
    const text = readOptionalText(profilePath, fileOps)
    if (text == null) {
      if (!optionsInternal.initializeIfMissing || hasRecoveryEvidence()) {
        markCurrentUnavailable(
          profileDocumentError('profile_document_unavailable', { filePath: profilePath }),
        )
        throw profileDocumentError('profile_document_unavailable', { filePath: profilePath })
      }
      const document = emptyProfileDocument()
      const contents = serializeProfileJsonDocument(document)
      persistValidatedDocument(document, {
        previousValidText: null,
        rotateBackup: false,
        contents,
      })
      return { document, text: contents }
    }

    // Presence is recovery evidence even when content is invalid/unsupported.
    observedCurrent = true
    try {
      const parsed = parseProfileJsonDocument(text, profilePath)
      markCurrentValid(parsed.document)
      return { document: parsed.document, text }
    } catch (error) {
      markCurrentInvalid(error)
      throw error
    }
  }

  function tryReadCurrentDocument():
    | { kind: 'valid'; document: ProfileDocument; text: string }
    | { kind: 'missing'; error: ProfileCapabilityError }
    | { kind: 'invalid'; error: ProfileCapabilityError; text: string }
    | { kind: 'unavailable'; error: ProfileCapabilityError } {
    let text: string | null
    try {
      text = readOptionalText(profilePath, fileOps)
    } catch (error) {
      const capabilityError =
        error instanceof ProfileCapabilityError
          ? error
          : profileDocumentError('profile_document_unavailable', { filePath: profilePath })
      markCurrentUnavailable(capabilityError)
      return { kind: 'unavailable', error: capabilityError }
    }
    if (text == null) {
      const error = profileDocumentError('profile_document_unavailable', { filePath: profilePath })
      markCurrentUnavailable(error)
      return { kind: 'missing', error }
    }
    observedCurrent = true
    try {
      const parsed = parseProfileJsonDocument(text, profilePath)
      markCurrentValid(parsed.document)
      return { kind: 'valid', document: parsed.document, text }
    } catch (error) {
      if (error instanceof ProfileCapabilityError) {
        markCurrentInvalid(error)
        return { kind: 'invalid', error, text }
      }
      throw error
    }
  }

  function hasRecoveryEvidence(): boolean {
    if (observedCurrent || observedRecoveryEvidence) return true
    return hasDiskRecoveryEvidence()
  }

  function hasDiskRecoveryEvidence(): boolean {
    if (fileOps.existsSync(profileBackupPath(profilePath))) return true
    const directoryPath = path.dirname(profilePath)
    if (!fileOps.existsSync(directoryPath)) return false
    return fileOps.readdirSync(directoryPath).some((entry) =>
      entry.startsWith(`${path.basename(profilePath)}.`) && entry.endsWith('.tmp'),
    )
  }

  function persistValidatedDocument(
    document: ProfileDocument,
    persistOptions: {
      previousValidText: string | null
      rotateBackup: boolean
      contents?: string
    },
  ): void {
    const contents = persistOptions.contents ?? serializeProfileJsonDocument(document)
    if (persistOptions.rotateBackup && persistOptions.previousValidText != null) {
      writeProfileJsonAtomically({
        profilePath: profileBackupPath(profilePath),
        contents: persistOptions.previousValidText,
        fileOps,
        pid: options.pid,
      })
      watchBackupFingerprint = fingerprint(persistOptions.previousValidText)
    }

    markSelfWrite(contents)
    writeProfileJsonAtomically({
      profilePath,
      contents,
      fileOps,
      pid: options.pid,
    })
    markCurrentValid(document)
    lastEmittedFingerprint = fingerprint(contents)
    cleanOrphansUnderLock()
  }

  function markSelfWrite(contents: string): void {
    // Keep only the currently relevant fingerprint — repeated cooperative writes
    // must not accumulate an unbounded set of full serialized documents.
    selfWriteFingerprint = fingerprint(contents)
    suppressWatchUntil = now() + (options.debounceMs ?? 50) * 4
  }

  function tryConsumeSelfWrite(mark: string): boolean {
    if (selfWriteFingerprint == null) return false
    if (now() >= suppressWatchUntil) {
      selfWriteFingerprint = null
      return false
    }
    if (selfWriteFingerprint !== mark) {
      // Intervening distinct external content clears suppression immediately.
      selfWriteFingerprint = null
      return false
    }
    selfWriteFingerprint = null
    return true
  }

  function seedWatcherStateFromDisk(): void {
    try {
      const text = readOptionalText(profilePath, fileOps)
      if (text == null) return
      observedCurrent = true
      const parsed = parseProfileJsonDocument(text, profilePath)
      markCurrentValid(parsed.document)
      lastEmittedFingerprint = fingerprint(text)
    } catch {
      // Invalid current stays unresolved until the first change event.
    }
  }

  function probeCurrentStatusForPreview(): void {
    try {
      const text = readOptionalText(profilePath, fileOps)
      if (text == null) {
        markCurrentUnavailable(
          profileDocumentError('profile_document_unavailable', { filePath: profilePath }),
        )
        return
      }
      observedCurrent = true
      const parsed = parseProfileJsonDocument(text, profilePath)
      markCurrentValid(parsed.document)
    } catch (error) {
      markCurrentInvalid(error)
    }
  }

  function readBackupPreviewDocument(): ProfileDocument | null {
    try {
      const backupText = readOptionalText(profileBackupPath(profilePath), fileOps)
      if (backupText == null) return null
      return parseProfileJsonDocument(backupText, profilePath).document
    } catch {
      return null
    }
  }

  async function handleExternalChange(): Promise<void> {
    if (disposed || listeners.size === 0) return

    const text = readOptionalText(profilePath, fileOps)
    if (text == null) {
      selfWriteFingerprint = null
      const error = profileDocumentError('profile_document_unavailable', { filePath: profilePath })
      markCurrentUnavailable(error)
      emitInvalid(error)
      return
    }

    const mark = fingerprint(text)
    if (tryConsumeSelfWrite(mark)) {
      lastEmittedFingerprint = mark
      return
    }
    if (mark === lastEmittedFingerprint) return

    observedCurrent = true
    try {
      const parsed = parseProfileJsonDocument(text, profilePath)
      if (lastKnownGood && lastKnownGood.revision !== parsed.document.revision) {
        const previous = serializeProfileJsonDocument(lastKnownGood)
        if (previous !== text) {
          await rotateDirectEditBackup(previous, mark)
        }
      }
      markCurrentValid(parsed.document)
      lastEmittedFingerprint = mark
      emitValid(parsed.document)
    } catch (error) {
      if (error instanceof ProfileCapabilityError) {
        lastEmittedFingerprint = mark
        markCurrentInvalid(error)
        emitInvalid(error)
        return
      }
      throw error
    }
  }

  async function rotateDirectEditBackup(previousText: string, expectedFingerprint: string): Promise<void> {
    await withProfileJsonLock(profilePath, lockOptions(), async () => {
      const currentText = readOptionalText(profilePath, fileOps)
      if (currentText == null || fingerprint(currentText) !== expectedFingerprint) return
      if (watchBackupFingerprint === fingerprint(previousText)) {
        // Cooperative writer already preserved this exact prior document.
        return
      }
      const existingBackup = readOptionalText(profileBackupPath(profilePath), fileOps)
      if (existingBackup != null && fingerprint(existingBackup) === fingerprint(previousText)) {
        watchBackupFingerprint = fingerprint(previousText)
        return
      }
      // Do not overwrite a newer cooperative backup that no longer matches prior watch state.
      if (
        existingBackup != null &&
        watchBackupFingerprint != null &&
        fingerprint(existingBackup) !== watchBackupFingerprint &&
        fingerprint(existingBackup) !== fingerprint(previousText)
      ) {
        return
      }
      writeProfileJsonAtomically({
        profilePath: profileBackupPath(profilePath),
        contents: previousText,
        fileOps,
        pid: options.pid,
      })
      watchBackupFingerprint = fingerprint(previousText)
    })
  }

  function markCurrentValid(document: ProfileDocument): void {
    observedCurrent = true
    currentStatus = 'valid'
    lastKnownGood = document
  }

  function markCurrentInvalid(error: unknown): void {
    currentStatus = error instanceof ProfileCapabilityError && error.code === 'invalid_profile_document'
      ? 'invalid'
      : 'unavailable'
    if (!lastKnownGood) {
      lastKnownGood = readBackupPreviewDocument()
    }
  }

  function markCurrentUnavailable(_error: ProfileCapabilityError): void {
    currentStatus = 'unavailable'
    if (!lastKnownGood) {
      lastKnownGood = readBackupPreviewDocument()
    }
  }

  function emitValid(document: ProfileDocument) {
    const event: ProfileDocumentChangeEvent = { kind: 'valid', document }
    for (const listener of listeners) listener(event)
  }

  function emitInvalid(error: ProfileCapabilityError) {
    const event: ProfileDocumentChangeEvent = { kind: 'invalid', error }
    for (const listener of listeners) listener(event)
  }

  function fingerprint(text: string): string {
    return text
  }
}

export type { ProfileDocumentCapability }
