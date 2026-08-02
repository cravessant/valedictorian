import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, it } from 'vitest'
import {
  assertNpmOidcVersion,
  inspectReleaseTarball,
  registryReceiptViolations,
} from './publish-package-tarball.mjs'

const fixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'valedictorian-publish-tarball-test-'),
)
const packageRoot = path.join(fixtureRoot, 'package')
const tarballPath = path.join(fixtureRoot, 'package.tgz')

function validManifest() {
  return {
    name: '@sparxie/valedictorian-cli',
    version: '0.1.0-alpha.21',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://github.com/cravessant/valedictorian.git',
      directory: 'packages/cli',
    },
    bugs: {
      url: 'https://github.com/cravessant/valedictorian/issues',
    },
    homepage: 'https://github.com/cravessant/valedictorian#readme',
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
    dependencies: {
      '@sparxie/sdk': '0.36.0',
    },
  }
}

function pack(manifest) {
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  execFileSync(
    'tar',
    ['-czf', tarballPath, '-C', fixtureRoot, 'package'],
    { stdio: 'pipe' },
  )
}

afterAll(() => {
  fs.rmSync(fixtureRoot, { force: true, recursive: true })
})

describe('exact package tarball publisher', () => {
  it('accepts only reviewed product metadata and registry dependencies', () => {
    pack(validManifest())
    const inspection = inspectReleaseTarball(tarballPath)

    assert.deepEqual(inspection.violations, [])
    assert.match(inspection.integrity, /^sha512-/)
  })

  it('rejects workspace dependencies in the artifact manifest', () => {
    const manifest = validManifest()
    manifest.dependencies['@sparxie/sdk'] = 'workspace:0.36.0'
    pack(manifest)

    assert.deepEqual(
      inspectReleaseTarball(tarballPath).violations,
      ['dependencies.@sparxie/sdk uses forbidden source workspace:0.36.0'],
    )
  })

  it.each(['git+https:', 'git+ssh:', 'git+file:'])(
    'rejects %s dependency sources in the artifact manifest',
    (source) => {
      const manifest = validManifest()
      manifest.dependencies['@sparxie/sdk'] = `${source}//example.invalid/sdk.git`
      pack(manifest)

      assert.deepEqual(
        inspectReleaseTarball(tarballPath).violations,
        [
          `dependencies.@sparxie/sdk uses forbidden source `
            + `${source}//example.invalid/sdk.git`,
        ],
      )
    },
  )

  it('requires an npm version that supports Trusted Publishing OIDC', () => {
    assert.throws(() => assertNpmOidcVersion('11.4.9'), /too old/)
    assert.doesNotThrow(() => assertNpmOidcVersion('11.5.1'))
    assert.doesNotThrow(() => assertNpmOidcVersion('12.0.0'))
  })

  it('requires the exact tag, integrity, signature, provenance, and source', () => {
    const manifest = validManifest()
    const integrity = 'sha512-test'
    const packument = {
      'dist-tags': { migration: manifest.version },
      versions: {
        [manifest.version]: {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license,
          homepage: manifest.homepage,
          bugs: manifest.bugs,
          repository: manifest.repository,
          dist: {
            attestations: { provenance: { predicateType: 'test' } },
            integrity,
            signatures: [{ keyid: 'test', sig: 'test' }],
          },
        },
      },
    }
    assert.deepEqual(registryReceiptViolations({
      distTag: 'migration',
      integrity,
      name: manifest.name,
      packument,
      version: manifest.version,
    }), [])

    packument['dist-tags'].migration = '0.1.0-alpha.20'
    assert.deepEqual(registryReceiptViolations({
      distTag: 'migration',
      integrity,
      name: manifest.name,
      packument,
      version: manifest.version,
    }), ['migration dist-tag does not select 0.1.0-alpha.21'])

    packument['dist-tags'].migration = manifest.version
    packument.versions[manifest.version].repository.directory = 'packages/other'
    packument.versions[manifest.version].license = 'UNLICENSED'
    assert.deepEqual(registryReceiptViolations({
      distTag: 'migration',
      integrity,
      name: manifest.name,
      packument,
      version: manifest.version,
    }), [
      `${manifest.name}@${manifest.version} registry repository directory is incorrect`,
      `${manifest.name}@${manifest.version} registry license is not MIT`,
    ])
  })
})
