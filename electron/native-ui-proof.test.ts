import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedValidationFixture } from '../src/runtime/isolated-validation.fixture-contract'
import { cliUiDevProofCompanyName } from './cli-ui-dev-proof-cli'
import {
  runElectronNativeUiProof,
  type ElectronNativeUiDriver,
  type ProofScreenshot,
  type RendererConsoleCapture,
  type SemanticTarget,
} from './native-ui-proof'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('Electron native UI proof', () => {
  it('proves the rendered Capture transition and writes app-only before/after evidence', async () => {
    const evidenceDirectory = temporaryDirectory()
    const driver = new FakeNativeUiDriver()

    const result = await runElectronNativeUiProof({
      build: { branch: 'feat/electron-proof', commit: '1234567', worktree: { state: 'clean' } },
      driver,
      evidenceDirectory,
      fixture: isolatedValidationFixture,
      rendererConsole: rendererConsole(),
      workspace: { id: 'workspace-proof', path: '/tmp/workspace-proof' },
    })

    expect(result.outcome).toBe('completed')
    expect(result.assertions).toEqual({
      captureCompletionOpened: true,
      existingCompanySelected: true,
      jobVisible: true,
      workspaceCompanyVisible: true,
    })
    expect(driver.populatedBeforeScreenshot).toBe(true)
    expect(driver.screenshots).toEqual(['before-completion', 'after-completion'])
    expect(result.screenshots.map((screenshot) => screenshot.target)).toEqual([
      'main-window-web-contents',
      'main-window-web-contents',
    ])
    expect(result.screenshots.every((screenshot) => fs.existsSync(screenshot.path))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(evidenceDirectory, 'electron-native-ui-proof.json'), 'utf8')))
      .toMatchObject({ outcome: 'completed', schemaVersion: 'valedictorian-electron-native-ui-proof@1' })
  })

  it('fails when the rendered completion does not produce a Job and preserves a safe failure screenshot', async () => {
    const evidenceDirectory = temporaryDirectory()
    const driver = new FakeNativeUiDriver({ blockJobTransition: true })

    const result = await runElectronNativeUiProof({
      build: { branch: 'feat/electron-proof', commit: '1234567', worktree: { state: 'clean' } },
      driver,
      evidenceDirectory,
      fixture: isolatedValidationFixture,
      rendererConsole: rendererConsole(),
      workspace: { id: 'workspace-proof', path: '/tmp/workspace-proof' },
    })

    expect(result.outcome).toBe('failed')
    expect(result.assertions.jobVisible).toBe(false)
    expect(result.screenshots.at(-1)).toMatchObject({
      name: 'failure',
      target: 'main-window-web-contents',
    })
    expect(result.diagnostics.assertionFailure).toContain('Job created')
  })

  it('fails when a screenshot does not target the app window web contents', async () => {
    const evidenceDirectory = temporaryDirectory()
    const driver = new FakeNativeUiDriver({ wrongScreenshotTarget: true })

    const result = await runElectronNativeUiProof({
      build: { branch: 'feat/electron-proof', commit: '1234567', worktree: { state: 'clean' } },
      driver,
      evidenceDirectory,
      fixture: isolatedValidationFixture,
      rendererConsole: rendererConsole(),
      workspace: { id: 'workspace-proof', path: '/tmp/workspace-proof' },
    })

    expect(result.outcome).toBe('failed')
    expect(result.diagnostics.assertionFailure).toContain('main window web contents')
  })

  it('runs cross-surface hooks around completion and observes the mutated Company value', async () => {
    const evidenceDirectory = temporaryDirectory()
    const driver = new FakeNativeUiDriver()
    let unresolvedRead = false
    let cliMutation = false

    const result = await runElectronNativeUiProof({
      build: { branch: 'feat/dev-proof', commit: '1234567', worktree: { state: 'clean' } },
      driver,
      evidenceDirectory,
      fixture: isolatedValidationFixture,
      rendererConsole: rendererConsole(),
      workflow: {
        async afterJobVisible() {
          cliMutation = true
          driver.renameCompany(cliUiDevProofCompanyName)
        },
        async beforeCompletion() {
          unresolvedRead = true
        },
        expectedCompanyName: cliUiDevProofCompanyName,
      },
      workspace: { id: 'workspace-proof', path: '/tmp/workspace-proof' },
    })

    expect(result.outcome).toBe('completed')
    expect(unresolvedRead).toBe(true)
    expect(cliMutation).toBe(true)
    expect(driver.lastCompanyExpectation).toBe(cliUiDevProofCompanyName)
  })

  it('expands the sidebar then navigates through exact Application views controls', async () => {
    const evidenceDirectory = temporaryDirectory()
    const driver = new FakeNativeUiDriver()

    const result = await runElectronNativeUiProof({
      build: { branch: 'feat/electron-proof', commit: '1234567', worktree: { state: 'clean' } },
      driver,
      evidenceDirectory,
      fixture: isolatedValidationFixture,
      rendererConsole: rendererConsole(),
      workspace: { id: 'workspace-proof', path: '/tmp/workspace-proof' },
    })

    expect(result.outcome).toBe('completed')
    expect(driver.clickedTargets).toEqual(expect.arrayContaining([
      { name: 'Expand sidebar', role: 'button' },
      {
        name: 'Jobs',
        role: 'button',
        within: { name: 'Application views', role: 'navigation' },
      },
      {
        name: 'Companies',
        role: 'button',
        within: { name: 'Application views', role: 'navigation' },
      },
    ]))
  })
})

class FakeNativeUiDriver implements ElectronNativeUiDriver {
  populatedBeforeScreenshot = false
  readonly clickedTargets: SemanticTarget[] = []
  readonly screenshots: ProofScreenshot['name'][] = []
  lastCompanyExpectation = ''
  private companyDisplayName = 'Validation Company'
  private companySelected = false
  private dialogOpen = false
  private jobCreated = false
  private phase: 'captures' | 'jobs' | 'companies' = 'captures'

  constructor(private readonly options: {
    readonly blockJobTransition?: boolean
    readonly wrongScreenshotTarget?: boolean
  } = {}) {}

  async captureAppOnlyScreenshot(name: ProofScreenshot['name']): Promise<ProofScreenshot> {
    if (name === 'before-completion') {
      this.populatedBeforeScreenshot = this.provenanceLoaded
      if (!this.provenanceLoaded) throw new Error('The before screenshot raced Capture provenance.')
    }
    this.screenshots.push(name)
    return {
      bytes: pngBytes(),
      name,
      target: this.options.wrongScreenshotTarget
        ? 'wrong-target' as ProofScreenshot['target']
        : 'main-window-web-contents',
    }
  }

  async click(target: SemanticTarget) {
    this.clickedTargets.push(target)
    if (target.name === 'Complete Job information') this.dialogOpen = true
    if (target.name === 'Use') this.companySelected = true
    if (target.name === 'Create Job' && this.companySelected && !this.options.blockJobTransition) {
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
    const content = this.text(target)
    if (!content.includes(expectedText)) throw new Error(`Expected ${target.name} to contain ${expectedText}.`)
  }

  async fill(target: SemanticTarget, value: string) {
    if (target.name === 'Employer or ATS URL' && value !== 'https://validation.example/careers') {
      throw new Error('The proof supplied an unexpected destination.')
    }
  }

  async waitFor(target: SemanticTarget) {
    if (!this.hasTarget(target)) throw new Error(`Missing accessible ${target.role}: ${target.name}`)
  }

  async waitForText(target: SemanticTarget, expectedText: string) {
    if (target.name === 'Complete Capture into a Job' && expectedText === 'Raw evidence (1)') {
      this.provenanceLoaded = true
    }
    if (target.name === 'Companies') this.lastCompanyExpectation = expectedText
    await this.expectText(target, expectedText)
  }

  renameCompany(displayName: string) {
    this.companyDisplayName = displayName
  }

  private provenanceLoaded = false

  private hasTarget(target: SemanticTarget) {
    if (target.name === 'Complete Job information') return this.phase === 'captures' && !this.jobCreated
    if (target.name === 'Complete Capture into a Job') return this.dialogOpen
    if (target.name === 'Company search results') return this.dialogOpen
    if (target.name === 'Use') return this.dialogOpen
    if (target.name === 'Captures') return this.phase === 'captures'
    if (target.name === 'Jobs') return true
    if (target.name === 'Companies') return true
    return true
  }

  private text(target: SemanticTarget) {
    if (target.name === 'Complete Capture into a Job') {
      return [
        'Validation Engineer',
        this.provenanceLoaded ? 'Raw evidence (1)' : 'Loading Capture provenance…',
        this.companySelected ? 'Using Validation Company' : '',
      ].join(' ')
    }
    if (target.name === 'Captures') {
      return this.jobCreated ? 'Job created Validation Engineer · Validation Company' : 'Validation Engineer'
    }
    if (target.name === 'Jobs') return this.jobCreated ? 'Validation Engineer Validation Company' : ''
    if (target.name === 'Companies') return this.jobCreated ? this.companyDisplayName : ''
    return ''
  }
}

function rendererConsole(): RendererConsoleCapture {
  return { entries: () => [], stop: () => undefined }
}

function pngBytes() {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
}

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-native-ui-proof-test-'))
  temporaryDirectories.push(directory)
  return directory
}
