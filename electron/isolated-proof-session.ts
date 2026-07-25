import { isolatedValidationFixture } from '../src/runtime/isolated-validation.fixture-contract'
import {
  readIsolatedValidationEnvironment,
  type IsolatedValidationManifest,
} from '../src/runtime/isolated-validation'
import type { WorkspaceSummary } from '../src/workspace/workspace.initializer'

interface IsolatedProofWindow {
  isDestroyed(): boolean
  readonly webContents: {
    isDestroyed(): boolean
  }
}

export function requireIsolatedProofSession({
  manifest,
  proofName,
  window,
  workspace,
}: {
  readonly manifest: IsolatedValidationManifest | null
  readonly proofName: string
  readonly window: IsolatedProofWindow
  readonly workspace: Pick<WorkspaceSummary, 'id' | 'rootPath'>
}) {
  const session = readIsolatedValidationEnvironment()
  if (!session || !manifest) throw new Error(`${proofName} requires an isolated validation session.`)
  if (
    window.isDestroyed()
    || window.webContents.isDestroyed()
    || manifest.build.branch !== session.branch
    || manifest.build.commit !== session.commit
    || JSON.stringify(manifest.build.worktree) !== JSON.stringify(session.worktree)
    || manifest.workspace.id !== workspace.id
    || manifest.workspace.path !== workspace.rootPath
    || manifest.fixture.version !== isolatedValidationFixture.version
  ) {
    throw new Error(`${proofName} identity does not match the ready isolated session.`)
  }
  return { manifest, session }
}
