import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPackage } from '@electron/asar'
import { describe, it } from 'vitest'
import { inspectPackagedDeclaredSources } from './packaged-declared-sources-proof.mjs'

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function createFixture({ includeSource }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-declared-sources-'))
  const repositoryRoot = path.join(root, 'repository')
  const applicationRoot = path.join(root, 'application')
  const archivePath = path.join(root, 'app.asar')

  writeJson(path.join(repositoryRoot, 'package.json'), {
    dependencies: { '@fixture/runtime': 'workspace:1.0.0' },
  })
  writeJson(path.join(repositoryRoot, 'packages/runtime/package.json'), {
    name: '@fixture/runtime',
    version: '1.0.0',
    files: ['dist'],
  })
  writeJson(path.join(applicationRoot, 'node_modules/@fixture/runtime/package.json'), {
    name: '@fixture/runtime',
    version: '1.0.0',
    files: ['dist'],
  })
  fs.mkdirSync(
    path.join(applicationRoot, 'node_modules/@fixture/runtime/dist'),
    { recursive: true },
  )
  fs.writeFileSync(
    path.join(applicationRoot, 'node_modules/@fixture/runtime/dist/index.js'),
    'export const fixture = true\n',
  )
  if (includeSource) {
    fs.mkdirSync(
      path.join(applicationRoot, 'node_modules/@fixture/runtime/src'),
      { recursive: true },
    )
    fs.writeFileSync(
      path.join(applicationRoot, 'node_modules/@fixture/runtime/src/index.ts'),
      'export const fixture = true\n',
    )
  }
  await createPackage(applicationRoot, archivePath)
  return { archivePath, repositoryRoot, root }
}

describe('packaged declared-source proof', () => {
  it('accepts only package-declared runtime files', async () => {
    const fixture = await createFixture({ includeSource: false })
    try {
      const result = inspectPackagedDeclaredSources(fixture)
      assert.deepEqual(result.problems, [])
      assert.equal(result.packageCounts['@fixture/runtime'], 3)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects workspace source files in the desktop archive', async () => {
    const fixture = await createFixture({ includeSource: true })
    try {
      const result = inspectPackagedDeclaredSources(fixture)
      assert.deepEqual(result.problems, [
        '@fixture/runtime packages undeclared path src',
        '@fixture/runtime packages undeclared path src/index.ts',
      ])
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
