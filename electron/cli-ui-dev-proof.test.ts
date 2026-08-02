import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedValidationFixture } from '../src/runtime/isolated-validation.fixture-contract'
import type { IsolatedValidationManifest } from '@sparxie/valedictorian-local-runtime/isolated-validation'
import {
  cliUiDevProofCompanyName,
  expectedCliCommit,
  expectedCliDependency,
  expectedCliPackageSha256,
  expectedCliVersion,
  type CliUiDevProofSession,
} from './cli-ui-dev-proof-cli'
import {
  assertCliUiDevProofSessionIdentity,
  runCliUiDevProof,
} from './cli-ui-dev-proof'
import type {
  ElectronNativeUiDriver,
  ProofScreenshot,
  RendererConsoleCapture,
  SemanticTarget,
} from './native-ui-proof'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('CLI/UI development proof evidence', () => {
  it('rejects a stale session manifest and the wrong opened workspace', () => {
    const evidenceDirectory = temporaryDirectory()
    const currentManifest = manifest(evidenceDirectory)
    const session = {
      branch: currentManifest.build.branch,
      commit: currentManifest.build.commit,
      evidenceDirectory,
      sessionId: currentManifest.run.id,
      worktree: currentManifest.build.worktree,
    }
    const workspace = {
      id: currentManifest.workspace.id,
      rootPath: currentManifest.workspace.path,
    }

    expect(() => assertCliUiDevProofSessionIdentity({
      manifest: currentManifest,
      session: { ...session, sessionId: 'stale-session' },
      windowReady: true,
      workspace,
    })).toThrow(/ready isolated session/i)
    expect(() => assertCliUiDevProofSessionIdentity({
      manifest: currentManifest,
      session,
      windowReady: true,
      workspace: { ...workspace, id: 'wrong-workspace' },
    })).toThrow(/ready isolated session/i)
  })

  it('binds CLI assertions and renderer screenshots into one manifest', async () => {
    const evidenceDirectory = temporaryDirectory()
    const driver = new ProofDriver()
    const result = await runCliUiDevProof({
      createSession: () => successfulCliSession(driver),
      driver,
      evidenceDirectory,
      manifest: manifest(evidenceDirectory),
      rendererConsole: rendererConsole(),
    })

    expect(result.outcome).toBe('completed')
    expect(Object.values(result.assertions).every(Boolean)).toBe(true)
    expect(result.cli.actual).toMatchObject({
      commit: expectedCliCommit,
      dependency: expectedCliDependency,
      version: expectedCliVersion,
    })
    expect(result.lineage).toMatchObject({
      captureRevision: 1,
      companyRevisionBefore: 1,
      companyRevisionAfter: 2,
      jobId: '01986e01-4030-7000-8000-000000000005',
    })
    expect(result.screenshots.map((screenshot) => screenshot.name)).toEqual([
      'before-completion',
      'after-completion',
    ])
    expect(JSON.parse(
      fs.readFileSync(path.join(evidenceDirectory, 'cli-ui-dev-proof.json'), 'utf8'),
    )).toMatchObject({
      outcome: 'completed',
      run: { id: 'validation-cli-ui-proof-test' },
      schemaVersion: 'valedictorian-cli-ui-dev-proof@1',
      workspace: { id: 'isolated-validation-workspace-test' },
    })
  })

  it('retains a failure screenshot when the CLI mutation is missing', async () => {
    const evidenceDirectory = temporaryDirectory()
    const driver = new ProofDriver()
    const session = successfulCliSession(driver)
    const result = await runCliUiDevProof({
      createSession: () => ({
        ...session,
        async verifyLineageAndMutateCompany() {
          throw new Error('The CLI Company mutation was missing.')
        },
      }),
      driver,
      evidenceDirectory,
      manifest: manifest(evidenceDirectory),
      rendererConsole: rendererConsole(),
    })

    expect(result.outcome).toBe('failed')
    expect(result.assertions.cliCompanyMutation).toBe(false)
    expect(result.assertions.uiObservedCliMutation).toBe(false)
    expect(result.diagnostics.assertionFailure).toContain('mutation was missing')
    expect(result.screenshots.at(-1)).toMatchObject({
      name: 'failure',
      target: 'main-window-web-contents',
    })
  })
})

class ProofDriver implements ElectronNativeUiDriver {
  private companyName = 'Validation Company'
  private companySelected = false
  private dialogOpen = false
  private jobCreated = false
  private phase: 'captures' | 'jobs' | 'companies' = 'captures'

  async captureAppOnlyScreenshot(name: ProofScreenshot['name']): Promise<ProofScreenshot> {
    return {
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      name,
      target: 'main-window-web-contents',
    }
  }

  async click(target: SemanticTarget) {
    if (target.name === 'Complete Job information') this.dialogOpen = true
    if (target.name === 'Use') this.companySelected = true
    if (target.name === 'Create Job') {
      this.jobCreated = true
      this.dialogOpen = false
    }
    if (target.name === 'Jobs') this.phase = 'jobs'
    if (target.name === 'Companies') this.phase = 'companies'
  }

  async exists(target: SemanticTarget) {
    return this.hasTarget(target)
  }

  async expectText(target: SemanticTarget, expectedText: string) {
    if (!this.text(target).includes(expectedText)) {
      throw new Error(`Expected ${target.name} to contain ${expectedText}.`)
    }
  }

  async fill() {}

  async waitFor(target: SemanticTarget) {
    if (!this.hasTarget(target)) throw new Error(`Missing ${target.name}.`)
  }

  async waitForText(target: SemanticTarget, expectedText: string) {
    await this.expectText(target, expectedText)
  }

  renameCompany() {
    this.companyName = cliUiDevProofCompanyName
  }

  private hasTarget(target: SemanticTarget) {
    if (target.name === 'Complete Job information') return !this.jobCreated
    if (target.name === 'Complete Capture into a Job') return this.dialogOpen
    if (target.name === 'Captures') return this.phase === 'captures'
    if (target.name === 'Jobs') return true
    if (target.name === 'Companies') return true
    return true
  }

  private text(target: SemanticTarget) {
    if (target.name === 'Complete Capture into a Job') {
      return `Validation Engineer Raw evidence (1) ${
        this.companySelected ? 'Using Validation Company' : ''
      }`
    }
    if (target.name === 'Captures') {
      return this.jobCreated
        ? 'Job created Validation Engineer · Validation Company'
        : 'Validation Engineer'
    }
    if (target.name === 'Jobs') {
      return this.jobCreated ? 'Validation Engineer Validation Company' : ''
    }
    if (target.name === 'Companies') return this.jobCreated ? this.companyName : ''
    return ''
  }
}

function successfulCliSession(driver: ProofDriver): CliUiDevProofSession {
  return {
    diagnostics: () => [{
      exitCode: 0,
      label: 'fixture',
      stderr: '',
      stderrBytes: 0,
      stdoutBytes: 120,
    }],
    provenance: {
      commit: expectedCliCommit,
      dependency: expectedCliDependency,
      name: '@sparxie/valedictorian-cli',
      packageSha256: expectedCliPackageSha256,
      version: expectedCliVersion,
    },
    async readUnresolvedCapture() {
      return {
        captureRevision: 1,
        evidenceReferences: [{
          captureId: isolatedValidationFixture.captureId,
          captureRevision: 1,
          evidenceIndexes: [0],
        }],
      }
    },
    async verifyLineageAndMutateCompany() {
      driver.renameCompany()
      return {
        companyRevisionAfter: 2,
        companyRevisionBefore: 1,
        jobFactsRevision: 1,
        jobId: '01986e01-4030-7000-8000-000000000005',
      }
    },
  }
}

function manifest(evidenceDirectory: string): IsolatedValidationManifest {
  return {
    artifacts: {
      diagnosticsPath: path.join(evidenceDirectory, 'diagnostics.json'),
      evidenceDirectory,
      manifestPath: path.join(evidenceDirectory, 'session-manifest.json'),
    },
    build: {
      branch: 'feat/405-cli-ui-dev-proof',
      commit: '4058584',
      worktree: { state: 'clean' },
    },
    fixture: {
      ...isolatedValidationFixture,
      expectedObservables: { companyCount: 1, unresolvedCaptureCount: 1 },
    },
    ports: { api: 4317, renderer: 5173 },
    run: { id: 'validation-cli-ui-proof-test', mode: 'isolated-validation' },
    schemaVersion: 'valedictorian-isolated-validation@1',
    urls: { api: 'http://127.0.0.1:4317/', renderer: 'http://127.0.0.1:5173/' },
    workspace: { id: 'isolated-validation-workspace-test', path: '/tmp/workspace' },
  }
}

function rendererConsole(): RendererConsoleCapture {
  return { entries: () => [], stop: () => undefined }
}

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ui-dev-evidence-test-'))
  temporaryDirectories.push(directory)
  return directory
}
