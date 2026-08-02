export {
  LocalWorkspaceMigrationSession,
  migrationReceiptDigest,
  type LocalWorkspaceMigrationOptions,
  type WorkspaceMigrationSessionInterruptionPoint,
  type WorkspaceSourceFencePort,
} from './migration/workspace-migration-session.js'
export {
  authenticateWorkspaceDocument,
  authenticateWorkspaceReceipt,
  verifyWorkspaceDocument,
  verifyWorkspaceReceipt,
  type AuthenticatedWorkspaceDocument,
  type AuthenticatedWorkspaceReceipt,
  type WorkspaceDocumentAuthentication,
  type WorkspaceReceiptAuthority,
} from './migration/workspace-migration-receipt.js'
export {
  assertAlpha55CompatibilityIdentity,
  type SupportedLocalWorkspaceMigrationFixture,
  type WorkspaceOldRuntimeVerification,
} from './migration/workspace-migration-alpha55.js'
export {
  createImmutableWorkspaceSnapshot,
  reconcileWorkspaceSnapshot,
  resolveWorkspaceSnapshotArtifact,
  resolveWorkspaceRestoreTransactionPaths,
  restoreWorkspaceSnapshot,
  supportedLocalWorkspaceMigrationFixtures,
  verifyWorkspaceSnapshot,
  type WorkspaceSnapshotArtifact,
  type WorkspaceSnapshotFile,
  type WorkspaceSnapshotInspection,
  type WorkspaceSnapshotInspector,
  type WorkspaceSnapshotManifest,
  type WorkspaceMigrationInterruptionHook,
  type WorkspaceMigrationInterruptionPoint,
} from './migration/workspace-migration-snapshot.js'
