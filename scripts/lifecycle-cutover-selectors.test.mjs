import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = path.resolve(import.meta.dirname, 'lifecycle-cutover-selectors.mjs')
const temporaryPaths = []

afterEach(() => {
  while (temporaryPaths.length) fs.rmSync(temporaryPaths.pop(), { recursive: true, force: true })
})

describe('lifecycle cutover selector provenance', () => {
  it('labels default App inspection as working-tree count validation, not exact proof', () => {
    const result = run([])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('working-tree count validation (not exact-head provenance)')
    expect(result.stdout).not.toContain('clean/exact')
  })

  it.each(['tracked', 'staged', 'untracked'])('rejects a dirty %s file in exact mode', (kind) => {
    const repo = createRepo('app', 'rawRecord\n')
    const manifest = writeManifest([repo])
    if (kind === 'tracked' || kind === 'staged') fs.appendFileSync(path.join(repo.root, repo.file), 'dirty\n')
    else fs.writeFileSync(path.join(repo.root, 'untracked.md'), 'dirty\n')
    if (kind === 'staged') git(repo.root, 'add', repo.file)

    const result = run([`--manifest=${manifest}`, `--repo=app=${repo.root}`])
    expect(result.status).toBe(1)
    expect(output(result)).toContain('exact-head inspection requires a clean repository')
  })

  it('accepts a clean exact repository at the claimed commit and tree', () => {
    const repo = createRepo('app', 'rawRecord\n')
    const result = run([`--manifest=${writeManifest([repo])}`, `--repo=app=${repo.root}`])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('exact committed-tree validation')
    expect(result.stdout).toContain(`commit ${repo.head}, tree ${repo.tree}, clean/exact`)
  })

  it('rejects a wrong expected head', () => {
    const repo = createRepo('app', 'rawRecord\n')
    const result = run([
      `--manifest=${writeManifest([repo])}`, `--repo=app=${repo.root}`,
      `--expected-head=app=${'0'.repeat(40)}`,
    ])
    expect(result.status).toBe(1)
    expect(output(result)).toContain('does not match inspected head')
  })

  it('rejects a claimed commit whose manifest tree is wrong', () => {
    const repo = createRepo('app', 'rawRecord\n')
    const manifest = writeManifest([repo], undefined, { app: '0'.repeat(40) })
    const result = run([`--manifest=${manifest}`, `--repo=app=${repo.root}`])
    expect(result.status).toBe(1)
    expect(output(result)).toContain('does not match manifest tree')
  })

  it.each([
    ['unclassified', [], 'unclassified app:proof.md'],
    ['count drift', [{ repo: 'app', file: 'proof.md', category: 'raw_record', count: 2 }], 'count drift app:proof.md'],
    ['stale', [
      { repo: 'app', file: 'proof.md', category: 'raw_record', count: 1 },
      { repo: 'app', file: 'stale.md', category: 'raw_record', count: 1 },
    ], 'stale disposition app:stale.md'],
  ])('rejects %s selector dispositions', (_case, dispositions, expected) => {
    const repo = createRepo('app', 'rawRecord\n')
    const result = run([
      `--manifest=${writeManifest([repo], dispositions)}`, `--repo=app=${repo.root}`,
    ])
    expect(result.status).toBe(1)
    expect(output(result)).toContain(expected)
  })

  it('proves a finite clean App, Sparxie, and CLI set at exact commits and trees', () => {
    const repos = [
      createRepo('app', 'rawRecord\n'),
      createRepo('sparxie', 'retryWorkId\n'),
      createRepo('cli', 'sourcingFindingId\n'),
    ]
    const result = run([
      `--manifest=${writeManifest(repos)}`,
      ...repos.map((repo) => `--repo=${repo.name}=${repo.root}`),
    ])
    expect(result.status).toBe(0)
    expect(result.stdout.match(/clean\/exact/g)).toHaveLength(3)
  })

  it('keeps print-observed generation output distinct from exact proof', () => {
    const repo = createRepo('app', 'rawRecord\n')
    fs.writeFileSync(path.join(repo.root, 'untracked.md'), 'rawRecord\n')
    const result = run([
      `--manifest=${writeManifest([repo])}`, '--print-observed', `--repo=app=${repo.root}`,
    ])
    expect(result.status).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(result.stdout).not.toContain('exact committed-tree validation')
  })
})

function createRepo(name, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `lifecycle-selector-${name}-`))
  temporaryPaths.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'selector@example.invalid')
  git(root, 'config', 'user.name', 'Selector Test')
  fs.writeFileSync(path.join(root, 'proof.md'), contents)
  git(root, 'add', 'proof.md')
  git(root, 'commit', '-qm', 'fixture')
  return {
    name, root, file: 'proof.md', head: git(root, 'rev-parse', 'HEAD').trim(),
    tree: git(root, 'rev-parse', 'HEAD^{tree}').trim(),
    category: name === 'app' ? 'raw_record' : name === 'sparxie' ? 'collapsed_retry_work' : 'sourcing_finding',
  }
}

function writeManifest(repos, dispositions, treeOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-selector-manifest-'))
  temporaryPaths.push(directory)
  const manifestPath = path.join(directory, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify({
    heads: Object.fromEntries(repos.map((repo) => [repo.name, repo.head])),
    trees: Object.fromEntries(repos.map((repo) => [repo.name, treeOverrides[repo.name] ?? repo.tree])),
    dispositions: dispositions ?? repos.map((repo) => ({
      repo: repo.name, file: repo.file, category: repo.category, count: 1,
    })),
  }))
  return manifestPath
}

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
}

function output(result) {
  return `${result.stdout}${result.stderr}`
}

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}
