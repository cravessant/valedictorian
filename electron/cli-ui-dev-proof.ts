import fs from 'node:fs'
import path from 'node:path'
import type {
  IsolatedValidationEnvironment,
  IsolatedValidationManifest,
} from '@sparxie/valedictorian-local-runtime/isolated-validation'
import { isolatedValidationFixture } from '../src/runtime/isolated-validation.fixture-contract'
import type { WorkspaceSummary } from '@sparxie/valedictorian-local-runtime/workspace-runtime'
import {
  cliUiDevProofCompanyName,
  createCliUiDevProofSession,
  expectedCliCommit,
  expectedCliDependency,
  expectedCliPackageSha256,
  expectedCliVersion,
  type CliUiDevProofSession,
  type CompletedCliLineageProof,
  type InitialCliCaptureProof,
} from './cli-ui-dev-proof-cli'
import {
  runElectronNativeUiProof,
  type ElectronNativeUiDriver,
  type RendererConsoleCapture,
} from './native-ui-proof'

const schemaVersion = 'valedictorian-cli-ui-dev-proof@1'

export function assertCliUiDevProofSessionIdentity({
  manifest,
  session,
  windowReady,
  workspace,
}: {
  readonly manifest: IsolatedValidationManifest
  readonly session: IsolatedValidationEnvironment
  readonly windowReady: boolean
  readonly workspace: Pick<WorkspaceSummary, 'id' | 'rootPath'>
}) {
  if (
    !windowReady
    || manifest.run.id !== session.sessionId
    || manifest.build.branch !== session.branch
    || manifest.build.commit !== session.commit
    || JSON.stringify(manifest.build.worktree) !== JSON.stringify(session.worktree)
    || manifest.workspace.id !== workspace.id
    || manifest.workspace.path !== workspace.rootPath
    || manifest.fixture.captureId !== isolatedValidationFixture.captureId
    || manifest.fixture.companyId !== isolatedValidationFixture.companyId
    || manifest.fixture.version !== isolatedValidationFixture.version
  ) {
    throw new Error('Development proof identity does not match the ready isolated session.')
  }
}

export interface CliUiDevProofResult {
  readonly api: {
    readonly port: number
    readonly url: string
  }
  readonly app: IsolatedValidationManifest['build']
  readonly assertions: {
    readonly cliCompanyMutation: boolean
    readonly cliProvenance: boolean
    readonly exactCaptureLineage: boolean
    readonly fixtureCompanyAssignment: boolean
    readonly uiCompletedCapture: boolean
    readonly uiObservedCliMutation: boolean
    readonly unresolvedCaptureRead: boolean
  }
  readonly cli: {
    readonly actual: CliUiDevProofSession['provenance'] | null
    readonly commands: ReturnType<CliUiDevProofSession['diagnostics']>
    readonly expected: {
      readonly commit: typeof expectedCliCommit
      readonly dependency: typeof expectedCliDependency
      readonly packageSha256: typeof expectedCliPackageSha256
      readonly version: typeof expectedCliVersion
    }
  }
  readonly diagnostics: {
    readonly assertionFailure?: string
    readonly rendererConsole: readonly string[]
  }
  readonly durationMs: number
  readonly fixture: IsolatedValidationManifest['fixture']
  readonly lineage: (CompletedCliLineageProof & {
    readonly captureRevision: number
    readonly evidenceReferences: InitialCliCaptureProof['evidenceReferences']
  }) | null
  readonly mutation: {
    readonly companyId: string
    readonly displayName: typeof cliUiDevProofCompanyName
  }
  readonly outcome: 'completed' | 'failed'
  readonly run: IsolatedValidationManifest['run']
  readonly schemaVersion: typeof schemaVersion
  readonly screenshots: readonly {
    readonly name: string
    readonly path: string
    readonly sha256: string
    readonly target: 'main-window-web-contents'
  }[]
  readonly workspace: IsolatedValidationManifest['workspace']
}

export async function runCliUiDevProof({
  cwd = process.cwd(),
  createSession = createCliUiDevProofSession,
  driver,
  evidenceDirectory,
  manifest,
  rendererConsole,
}: {
  readonly cwd?: string
  readonly createSession?: typeof createCliUiDevProofSession
  readonly driver: ElectronNativeUiDriver
  readonly evidenceDirectory: string
  readonly manifest: IsolatedValidationManifest
  readonly rendererConsole: RendererConsoleCapture
}): Promise<CliUiDevProofResult> {
  const startedAt = Date.now()
  const state: {
    cliSession: CliUiDevProofSession | null
    completed: CompletedCliLineageProof | null
    initial: InitialCliCaptureProof | null
  } = { cliSession: null, completed: null, initial: null }
  const electron = await runElectronNativeUiProof({
    build: manifest.build,
    driver,
    evidenceDirectory,
    fixture: manifest.fixture,
    rendererConsole,
    workflow: {
      async afterJobVisible() {
        if (!state.cliSession || !state.initial) {
          throw new Error('The CLI proof did not establish the unresolved Capture baseline.')
        }
        state.completed = await state.cliSession.verifyLineageAndMutateCompany(state.initial)
      },
      async beforeCompletion() {
        state.cliSession = createSession({ cwd, manifest })
        state.initial = await state.cliSession.readUnresolvedCapture()
      },
      expectedCompanyName: cliUiDevProofCompanyName,
    },
    workspace: manifest.workspace,
  })
  const assertions = {
    cliCompanyMutation: Boolean(state.completed),
    cliProvenance: Boolean(state.cliSession),
    exactCaptureLineage: Boolean(state.completed),
    fixtureCompanyAssignment: Boolean(state.completed),
    uiCompletedCapture: electron.assertions.jobVisible,
    uiObservedCliMutation:
      electron.outcome === 'completed' && electron.assertions.workspaceCompanyVisible,
    unresolvedCaptureRead: Boolean(state.initial),
  }
  const outcome = electron.outcome === 'completed'
    && Object.values(assertions).every(Boolean)
    ? 'completed' as const
    : 'failed' as const
  const result: CliUiDevProofResult = {
    api: {
      port: manifest.ports.api,
      url: manifest.urls.api,
    },
    app: manifest.build,
    assertions,
    cli: {
      actual: state.cliSession?.provenance ?? null,
      commands: state.cliSession?.diagnostics() ?? [],
      expected: {
        commit: expectedCliCommit,
        dependency: expectedCliDependency,
        packageSha256: expectedCliPackageSha256,
        version: expectedCliVersion,
      },
    },
    diagnostics: {
      ...(electron.diagnostics.assertionFailure
        ? { assertionFailure: electron.diagnostics.assertionFailure }
        : {}),
      rendererConsole: electron.diagnostics.rendererConsole,
    },
    durationMs: Date.now() - startedAt,
    fixture: manifest.fixture,
    lineage: state.initial && state.completed
      ? {
          ...state.completed,
          captureRevision: state.initial.captureRevision,
          evidenceReferences: state.initial.evidenceReferences,
        }
      : null,
    mutation: {
      companyId: manifest.fixture.companyId,
      displayName: cliUiDevProofCompanyName,
    },
    outcome,
    run: manifest.run,
    schemaVersion,
    screenshots: electron.screenshots,
    workspace: manifest.workspace,
  }
  fs.writeFileSync(
    path.join(evidenceDirectory, 'cli-ui-dev-proof.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  )
  return result
}
