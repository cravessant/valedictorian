import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedValidationFixture } from './isolated-validation.fixture-contract'
import {
  isolatedValidationManifestSchema,
  publishIsolatedValidationReadiness,
  readIsolatedValidationEnvironment,
  writeIsolatedValidationDiagnostic,
} from './isolated-validation'

const validationWorkspace = { id: 'isolated-validation-test-workspace', path: '/tmp/workspace' }

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('isolated validation readiness', () => {
  it('writes a restrictive, schema-validated manifest without process environment data', () => {
    const evidenceDirectory = temporaryDirectory()
    const manifest = publishIsolatedValidationReadiness({
      apiUrl: 'http://127.0.0.1:4317',
      rendererUrl: 'http://127.0.0.1:5173/',
      workspace: validationWorkspace,
      fixture: isolatedValidationFixture,
      environment: validationEnvironment(evidenceDirectory),
    })

    expect(manifest).not.toBeNull()
    const manifestPath = path.join(evidenceDirectory, 'session-manifest.json')
    expect(isolatedValidationManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))))
      .toEqual(manifest)
    expect(fs.statSync(manifestPath).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(manifest)).not.toMatch(/token|secret|password/i)
  })

  it('rejects non-loopback readiness URLs and incomplete validation environments', () => {
    const evidenceDirectory = temporaryDirectory()
    expect(() => publishIsolatedValidationReadiness({
      apiUrl: 'https://api.example.test:443',
      rendererUrl: 'http://127.0.0.1:5173/',
      workspace: validationWorkspace,
      fixture: isolatedValidationFixture,
      environment: validationEnvironment(evidenceDirectory),
    })).toThrow(/loopback/i)
    expect(() => readIsolatedValidationEnvironment({ VALEDICTORIAN_ISOLATED_VALIDATION: '1' }))
      .toThrow(/incomplete/i)
  })

  it('does not create a manifest outside explicit isolated validation mode', () => {
    expect(publishIsolatedValidationReadiness({
      apiUrl: 'http://127.0.0.1:4317',
      rendererUrl: 'http://127.0.0.1:5173/',
      workspace: validationWorkspace,
      fixture: isolatedValidationFixture,
      environment: {},
    })).toBeNull()
  })

  it('publishes the actual loopback ports reported by the running services', () => {
    const evidenceDirectory = temporaryDirectory()
    const manifest = publishIsolatedValidationReadiness({
      apiUrl: 'http://127.0.0.1:4318',
      rendererUrl: 'http://127.0.0.1:5174/',
      workspace: validationWorkspace,
      fixture: isolatedValidationFixture,
      environment: validationEnvironment(evidenceDirectory),
    })
    expect(manifest?.ports).toEqual({ api: 4318, renderer: 5174 })
  })

  it('writes a bounded sanitized causal diagnostic', () => {
    const evidenceDirectory = temporaryDirectory()
    const diagnosticsPath = writeIsolatedValidationDiagnostic(evidenceDirectory, {
      classification: 'setup_failure',
      message: 'secret=should-not-appear\nsetup did not complete',
      stage: 'setup',
    })
    expect(JSON.parse(fs.readFileSync(diagnosticsPath, 'utf8'))).toMatchObject({
      classification: 'setup_failure',
      message: '[redacted] setup did not complete',
      stage: 'setup',
    })
  })
})

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-isolated-validation-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function validationEnvironment(evidenceDirectory: string) {
  return {
    VALEDICTORIAN_ISOLATED_VALIDATION: '1',
    VALEDICTORIAN_ISOLATED_VALIDATION_BRANCH: 'feat/403-isolated-validation-lifecycle',
    VALEDICTORIAN_ISOLATED_VALIDATION_COMMIT: '5d75fa7',
    VALEDICTORIAN_ISOLATED_VALIDATION_EVIDENCE_PATH: evidenceDirectory,
    VALEDICTORIAN_ISOLATED_VALIDATION_SESSION_ID: 'validation-1234567890ab',
    VALEDICTORIAN_ISOLATED_VALIDATION_WORKTREE_STATE: 'clean',
  }
}
