import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IsolatedValidationManifest } from '../src/runtime/isolated-validation'
import {
  cliUiDevProofCompanyName,
  createCliUiDevProofSession,
  expectedCliCommit,
  expectedCliDependency,
} from './cli-ui-dev-proof-cli'

const captureId = '01986e01-4030-7000-8000-000000000001'
const companyId = '01986e01-4030-7000-8000-000000000003'
const jobId = '01986e01-4030-7000-8000-000000000005'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('CLI/UI development proof CLI boundary', () => {
  it('uses the pinned local CLI for unresolved read, exact lineage, and guarded mutation', async () => {
    const fixture = cliFixture()
    const session = createCliUiDevProofSession({
      cwd: fixture.root,
      expectedPackageSha256: fixture.packageSha256,
      manifest: validationManifest(),
    })

    const initial = await session.readUnresolvedCapture()
    fixture.update({ jobCreated: true })
    const completed = await session.verifyLineageAndMutateCompany(initial)

    expect(initial).toEqual({
      captureRevision: 1,
      evidenceReferences: [{ captureId, captureRevision: 1, evidenceIndexes: [0] }],
    })
    expect(completed).toMatchObject({
      companyRevisionAfter: 2,
      companyRevisionBefore: 1,
      jobFactsRevision: 1,
      jobId,
    })
    expect(fixture.read()).toMatchObject({
      companyName: cliUiDevProofCompanyName,
      companyRevision: 2,
    })
    expect(session.provenance).toMatchObject({
      commit: expectedCliCommit,
      dependency: expectedCliDependency,
      packageSha256: fixture.packageSha256,
      version: '0.1.0-alpha.18',
    })
    expect(session.diagnostics().map((entry) => entry.label)).toEqual([
      'capture-before',
      'capture-detail-before',
      'capture-projection-before',
      'capture-projection-after',
      'job-after',
      'job-company-after',
      'company-before-mutation',
      'company-mutation',
      'company-after-mutation',
    ])
  })

  it('rejects a stale dependency even when a global CLI could be on PATH', () => {
    const fixture = cliFixture()
    fs.writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify({
      devDependencies: {
        '@sparxie/valedictorian-cli': '0.1.0-alpha.18',
      },
    }))

    expect(() => createCliUiDevProofSession({
      cwd: fixture.root,
      expectedPackageSha256: fixture.packageSha256,
      manifest: validationManifest(),
    })).toThrow(/required commit/i)
  })

  it('rejects a tampered installed CLI even when name and version still match', () => {
    const fixture = cliFixture()
    fs.appendFileSync(
      path.join(
        fixture.root,
        'node_modules',
        '@sparxie',
        'valedictorian-cli',
        'dist',
        'implementation.mjs',
      ),
      '\n// tampered\n',
    )

    expect(() => createCliUiDevProofSession({
      cwd: fixture.root,
      expectedPackageSha256: fixture.packageSha256,
      manifest: validationManifest(),
    })).toThrow(/package hash/i)
  })

  it('rejects a manifest whose API URL and port do not identify the same listener', () => {
    const fixture = cliFixture()
    const manifest = validationManifest()

    expect(() => createCliUiDevProofSession({
      cwd: fixture.root,
      expectedPackageSha256: fixture.packageSha256,
      manifest: {
        ...manifest,
        ports: { ...manifest.ports, api: 4318 },
      },
    })).toThrow(/exact loopback API/i)
  })

  it('fails when the CLI Job read drops the exact Capture evidence reference', async () => {
    const fixture = cliFixture()
    const session = createCliUiDevProofSession({
      cwd: fixture.root,
      expectedPackageSha256: fixture.packageSha256,
      manifest: validationManifest(),
    })
    const initial = await session.readUnresolvedCapture()
    fixture.update({ brokenLineage: true, jobCreated: true })

    await expect(session.verifyLineageAndMutateCompany(initial))
      .rejects.toThrow(/exact fixture Capture lineage/i)
  })

  it('fails when a reported Company mutation is absent from the CLI read-back', async () => {
    const fixture = cliFixture()
    const session = createCliUiDevProofSession({
      cwd: fixture.root,
      expectedPackageSha256: fixture.packageSha256,
      manifest: validationManifest(),
    })
    const initial = await session.readUnresolvedCapture()
    fixture.update({ ignoreMutation: true, jobCreated: true })

    await expect(session.verifyLineageAndMutateCompany(initial))
      .rejects.toThrow(/read back its fixture Company mutation/i)
  })
})

function cliFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ui-dev-proof-test-'))
  temporaryDirectories.push(root)
  const packageDirectory = path.join(
    root,
    'node_modules',
    '@sparxie',
    'valedictorian-cli',
  )
  fs.mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    devDependencies: {
      '@sparxie/valedictorian-cli': expectedCliDependency,
    },
  }))
  fs.writeFileSync(
    path.join(root, 'pnpm-lock.yaml'),
    '      specifier: file:vendor/valedictorian-cli\n'
    + '      version: file:vendor/valedictorian-cli\n',
  )
  fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({
    bin: { 'valedictorian-cli': 'dist/valedictorian.mjs' },
    name: '@sparxie/valedictorian-cli',
    valedictorianSourceCommit: expectedCliCommit,
    version: '0.1.0-alpha.18',
  }))
  const statePath = path.join(packageDirectory, 'state.json')
  fs.writeFileSync(statePath, JSON.stringify(defaultState()))
  const entryPath = path.join(packageDirectory, 'dist', 'valedictorian.mjs')
  fs.writeFileSync(entryPath, "import './implementation.mjs'\n")
  fs.writeFileSync(path.join(packageDirectory, 'dist', 'implementation.mjs'), fakeCliSource)
  const packageSha256 = packagePayloadSha256(packageDirectory)
  return {
    packageSha256,
    read: () => JSON.parse(fs.readFileSync(statePath, 'utf8')) as FakeState,
    root,
    update(input: Partial<FakeState>) {
      fs.writeFileSync(statePath, JSON.stringify({ ...this.read(), ...input }))
    },
  }
}

function packagePayloadSha256(packageDirectory: string) {
  const files = ['package.json', 'dist/implementation.mjs', 'dist/valedictorian.mjs'].sort()
  const hash = createHash('sha256')
  for (const relativePath of files) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(packageDirectory, relativePath)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function validationManifest(): IsolatedValidationManifest {
  return {
    artifacts: {
      diagnosticsPath: '/tmp/evidence/diagnostics.json',
      evidenceDirectory: '/tmp/evidence',
      manifestPath: '/tmp/evidence/session-manifest.json',
    },
    build: {
      branch: 'feat/405-cli-ui-dev-proof',
      commit: '4058584',
      worktree: { state: 'clean' },
    },
    fixture: {
      captureId,
      companyId,
      expectedObservables: {
        companyCount: 1,
        unresolvedCaptureCount: 1,
      },
      timestamp: '2026-07-24T00:00:00.000Z',
      version: 'isolated-validation-fixture@1',
    },
    ports: { api: 4317, renderer: 5173 },
    run: {
      id: 'validation-cli-ui-proof-test',
      mode: 'isolated-validation',
    },
    schemaVersion: 'valedictorian-isolated-validation@1',
    urls: {
      api: 'http://127.0.0.1:4317/',
      renderer: 'http://127.0.0.1:5173/',
    },
    workspace: {
      id: 'isolated-validation-workspace-test',
      path: '/tmp/workspace',
    },
  }
}

interface FakeState {
  readonly brokenLineage: boolean
  readonly companyName: string
  readonly companyRevision: number
  readonly ignoreMutation: boolean
  readonly jobCreated: boolean
}

function defaultState(): FakeState {
  return {
    brokenLineage: false,
    companyName: 'Validation Company',
    companyRevision: 1,
    ignoreMutation: false,
    jobCreated: false,
  }
}

const fakeCliSource = String.raw`
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const captureId = '${captureId}'
const companyId = '${companyId}'
const jobId = '${jobId}'
const workspaceId = 'isolated-validation-workspace-test'
const statePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'state.json')
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const args = process.argv.slice(2)
const command = args[0] === '--json' ? args.slice(1) : args
const flag = (name) => command[command.indexOf(name) + 1]
const output = (value) => process.stdout.write(JSON.stringify(value))

if (
  process.env.VALEDICTORIAN_API_URL !== 'http://127.0.0.1:4317/'
  || flag('--workspace') !== workspaceId
) {
  process.stderr.write('wrong manifest API or workspace')
  process.exit(3)
}

if (command[0] === 'captures' && command[1] === 'get') {
  output({
    id: captureId, workspaceId, revision: 1, removedAt: null,
    evidence: [{ kind: 'title', label: 'Role title', value: 'Validation Engineer' }],
  })
} else if (command[0] === 'captures' && command[1] === 'resolution' && command[2] === 'get') {
  output({
    captureId, captureRevision: 1,
    exactEvidenceReferences: [{ captureId, captureRevision: 1, evidenceIndexes: [0] }],
  })
} else if (command[0] === 'captures' && command[1] === 'resolution' && command[2] === 'list') {
  output({
    items: [{
      captureId, captureRevision: 1,
      linkedJob: state.jobCreated ? { jobId } : null,
      primaryIntent: state.jobCreated
        ? { kind: 'view_job', jobId }
        : { kind: 'complete_job_information' },
    }],
    totalCount: 1,
  })
} else if (command[0] === 'jobs' && command[1] === 'get') {
  output({
    id: jobId, workspaceId, factsRevision: 1,
    facts: { companyName: 'Validation Company', roleTitle: 'Validation Engineer' },
    captureEvidenceReferences: [{
      captureId, captureRevision: 1,
      evidenceIndexes: state.brokenLineage ? [] : [0],
    }],
  })
} else if (command[0] === 'jobs' && command[1] === 'company') {
  output({
    jobId, assignmentRevision: 1,
    workspaceCompany: {
      companyId, revision: state.companyRevision,
      displayName: state.companyName, status: 'active',
    },
  })
} else if (command[0] === 'companies' && command[1] === 'get') {
  const company = {
    id: companyId, workspaceId, displayName: state.companyName,
    revision: state.companyRevision, status: 'active',
  }
  output({ lookup: { requested: company, canonical: company, redirectPath: [] } })
} else if (command[0] === 'companies' && command[1] === 'update') {
  const input = JSON.parse(flag('--input-json'))
  const next = {
    ...state,
    companyName: input.displayName,
    companyRevision: state.companyRevision + 1,
  }
  if (!state.ignoreMutation) fs.writeFileSync(statePath, JSON.stringify(next))
  output({
    status: 'updated', workspaceId, companyId,
    requestCompanyRevision: state.companyRevision,
    company: {
      id: companyId, workspaceId, displayName: input.displayName,
      revision: state.companyRevision + 1, status: 'active',
    },
  })
} else {
  process.stderr.write('unsupported fake CLI command')
  process.exit(2)
}
`
