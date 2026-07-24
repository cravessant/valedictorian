import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readIsolatedValidationBuildIdentity,
  type GitCommandRunner,
} from './isolated-validation-build-identity'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { force: true, recursive: true })
})

describe('isolated validation build identity', () => {
  it('reports a clean initialized repository without a fingerprint', () => {
    const repository = createRepository()

    expect(readIsolatedValidationBuildIdentity(repository)).toMatchObject({
      fingerprint: '',
      state: 'clean',
    })
  })

  it('changes its dirty fingerprint when a tracked file changes', () => {
    const repository = createRepository()
    const trackedPath = path.join(repository, 'tracked.txt')
    const first = dirtyIdentityAfter(repository, () => fs.writeFileSync(trackedPath, 'first change\n'))
    const second = dirtyIdentityAfter(repository, () => fs.writeFileSync(trackedPath, 'second change\n'))

    expect(first).toMatchObject({ state: 'dirty' })
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  it('changes its dirty fingerprint when only an untracked file changes', () => {
    const repository = createRepository()
    const untrackedPath = path.join(repository, 'untracked.txt')
    fs.writeFileSync(untrackedPath, 'first\n')
    const first = readIsolatedValidationBuildIdentity(repository)
    fs.writeFileSync(untrackedPath, 'second\n')
    const second = readIsolatedValidationBuildIdentity(repository)

    expect(first).toMatchObject({ state: 'dirty' })
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  it('hashes large tracked binary changes without reading a Git diff payload', () => {
    const repository = createRepository()
    const binaryPath = path.join(repository, 'large.bin')
    fs.writeFileSync(binaryPath, Buffer.alloc(2 * 1024 * 1024, 0x61))
    git(repository, ['add', 'large.bin'])
    git(repository, ['commit', '-m', 'large fixture'])
    fs.writeFileSync(binaryPath, Buffer.alloc(2 * 1024 * 1024, 0x62))

    expect(readIsolatedValidationBuildIdentity(repository)).toMatchObject({
      fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      state: 'dirty',
    })
  })

  it('includes deleted paths and symlink targets when the platform supports symlinks', () => {
    const repository = createRepository()
    const deletedPath = path.join(repository, 'delete-me.txt')
    const linkPath = path.join(repository, 'link.txt')
    fs.writeFileSync(deletedPath, 'delete me\n')
    fs.symlinkSync('target-a.txt', linkPath)
    git(repository, ['add', 'delete-me.txt', 'link.txt'])
    git(repository, ['commit', '-m', 'deletion and symlink fixture'])
    fs.rmSync(deletedPath)
    fs.rmSync(linkPath)
    fs.symlinkSync('target-b.txt', linkPath)
    const first = readIsolatedValidationBuildIdentity(repository)
    fs.rmSync(linkPath)
    fs.symlinkSync('target-c.txt', linkPath)
    const second = readIsolatedValidationBuildIdentity(repository)

    expect(first).toMatchObject({ state: 'dirty' })
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  it('fails closed when Git cannot provide complete command output', () => {
    const repository = createRepository()
    const failedGit: GitCommandRunner = () => ({
      error: new Error('git metadata token=must-not-escape'),
      status: null,
    })

    expect(() => readIsolatedValidationBuildIdentity(repository, { gitCommand: failedGit }))
      .toThrow('Git validation metadata could not be read completely.')
  })

  it('rejects metadata that exceeds a configured buffer limit', () => {
    const repository = createRepository()
    const oversizedGit: GitCommandRunner = () => ({
      status: 0,
      stdout: Buffer.from('exceeds-the-limit'),
    })

    expect(() => readIsolatedValidationBuildIdentity(repository, {
      gitCommand: oversizedGit,
      metadataLimitBytes: 4,
    })).toThrow('Git validation metadata exceeded its configured limit.')
  })
})

function createRepository() {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-build-identity-'))
  directories.push(repository)
  git(repository, ['init'])
  git(repository, ['config', 'user.email', 'validation@example.test'])
  git(repository, ['config', 'user.name', 'Validation'])
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'tracked\n')
  git(repository, ['add', 'tracked.txt'])
  git(repository, ['commit', '-m', 'fixture'])
  return repository
}

function dirtyIdentityAfter(repository: string, change: () => void) {
  change()
  return readIsolatedValidationBuildIdentity(repository)
}

function git(repository: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
}
