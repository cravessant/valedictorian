export {
  ProfileCapabilityError,
  invalidProfileDocumentError,
  issuePath,
  profileDocumentError,
} from './profile.errors.js'
export type { ProfileCapabilityErrorDetails } from './profile.errors.js'
export {
  mergeProfile,
  normalizeProfilePatch,
} from './profile.normalize.js'
export {
  computeProfileRevision,
  emptyProfileDocument,
} from './profile.revision.js'
export type {
  ProfileDocument,
  ProfileDocumentUpdateInput,
  ProfileStore,
  ProfileStoreUpdateResult,
  UserProfile,
} from './profile.store.js'
export type {
  JsonProfileAdapter,
  ProfileDocumentCapability,
  ProfileDocumentChangeEvent,
  ProfileLastKnownGoodPreview,
} from './profile.document.capability.js'
export {
  cleanOrphanProfileTemps,
  defaultProfileJsonFileOperations,
  profileBackupPath,
  profileLockPath,
  profileTempPath,
  readOptionalText,
  removeIfExists,
  unavailableProfileDocument,
  writeAllSync,
  writeProfileJsonAtomically,
} from './profile.json.atomic.js'
export type { ProfileJsonFileOperations } from './profile.json.atomic.js'
export {
  parseProfileJsonDocument,
  serializeProfileJsonDocument,
} from './profile.json.document.js'
export {
  acquireProfileJsonLock,
  withProfileJsonLock,
} from './profile.json.lock.js'
export type {
  AcquiredProfileJsonLock,
  ProfileJsonLockOptions,
} from './profile.json.lock.js'
export {
  isProfileSidecarPath,
  isProfileTempPath,
  parseProfileTempPath,
} from './profile.json.paths.js'
export {
  createJsonProfileStore,
} from './profile.json.store.js'
export type {
  CreateJsonProfileStoreOptions,
} from './profile.json.store.js'
export {
  createProfileJsonWatcher,
} from './profile.json.watch.js'
export type {
  ProfileJsonWatcher,
  ProfileJsonWatchOptions,
} from './profile.json.watch.js'
