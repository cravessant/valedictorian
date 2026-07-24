import { spawnSync } from 'node:child_process'
import crypto, { type Hash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const defaultMetadataLimitBytes = 4 * 1024 * 1024

export interface IsolatedValidationBuildIdentity {
  readonly branch: string
  readonly commit: string
  readonly fingerprint: string
  readonly state: 'clean' | 'dirty'
}

export interface GitCommandResult {
  readonly error?: Error
  readonly signal?: NodeJS.Signals | null
  readonly status: number | null
  readonly stdout?: Buffer
}

export type GitCommandRunner = (
  repositoryPath: string,
  args: readonly string[],
  maxOutputBytes: number,
) => GitCommandResult

export interface IsolatedValidationBuildIdentityOptions {
  readonly gitCommand?: GitCommandRunner
  readonly metadataLimitBytes?: number
}

interface ChangedEntry {
  readonly path: string
  readonly source: 'tracked' | 'untracked'
  readonly status: string
}

export function readIsolatedValidationBuildIdentity(
  repositoryPath = process.cwd(),
  {
    gitCommand = runGitCommand,
    metadataLimitBytes = defaultMetadataLimitBytes,
  }: IsolatedValidationBuildIdentityOptions = {},
): IsolatedValidationBuildIdentity {
  if (!Number.isSafeInteger(metadataLimitBytes) || metadataLimitBytes < 1) {
    throw new Error('The Git validation metadata limit is invalid.')
  }
  const repository = path.resolve(repositoryPath)
  const git = (args: readonly string[]) => readGitBytes(repository, args, metadataLimitBytes, gitCommand)
  const branch = sanitizeBuildValue(readGitText(git, ['branch', '--show-current']) || 'detached')
  const commit = sanitizeCommit(readGitText(git, ['rev-parse', '--short', 'HEAD']))
  const status = git(['status', '--porcelain=v1', '--untracked-files=all', '-z'])
  if (status.length === 0) return { branch, commit, fingerprint: '', state: 'clean' }

  const entries = readChangedEntries(repository, git)
  if (entries.length === 0) throw new Error('Git reported a dirty worktree without complete path metadata.')

  const fingerprint = crypto.createHash('sha256')
  updateHashPart(fingerprint, 'valedictorian-isolated-worktree-v2')
  updateHashPart(fingerprint, status)
  for (const entry of entries) updateChangedEntryHash(fingerprint, repository, entry)
  if (!git(['status', '--porcelain=v1', '--untracked-files=all', '-z']).equals(status)) {
    throw new Error('The validation worktree changed while its build identity was being read.')
  }
  return { branch, commit, fingerprint: `sha256:${fingerprint.digest('hex')}`, state: 'dirty' }
}

function readChangedEntries(repositoryPath: string, git: (args: readonly string[]) => Buffer) {
  const entries = new Map<string, ChangedEntry>()
  for (const entry of trackedEntries(git(['diff', '--name-status', '--no-ext-diff', '--no-renames', '-z', 'HEAD']))) {
    entries.set(entry.path, entry)
  }
  for (const relativePath of nulSeparatedPaths(git(['ls-files', '--others', '--exclude-standard', '-z']))) {
    if (entries.has(relativePath)) throw new Error('Git reported ambiguous validation worktree path metadata.')
    entries.set(relativePath, { path: relativePath, source: 'untracked', status: '??' })
  }
  return [...entries.values()]
    .map((entry) => ({ ...entry, path: requireRelativePath(repositoryPath, entry.path) }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
}

function trackedEntries(value: Buffer) {
  const fields = value.toString('utf8').split('\0')
  if (fields.at(-1) !== '') throw new Error('Git returned incomplete tracked path metadata.')
  const entries: ChangedEntry[] = []
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index]
    const relativePath = fields[index + 1]
    if (!status || !relativePath || !/^[ACDMRTUXB]+$/.test(status)) {
      throw new Error('Git returned invalid tracked path metadata.')
    }
    entries.push({ path: relativePath, source: 'tracked', status })
  }
  return entries
}

function nulSeparatedPaths(value: Buffer) {
  const fields = value.toString('utf8').split('\0')
  if (fields.at(-1) !== '') throw new Error('Git returned incomplete untracked path metadata.')
  return fields.slice(0, -1).map((relativePath) => {
    if (!relativePath) throw new Error('Git returned an invalid untracked path.')
    return relativePath
  })
}

function updateChangedEntryHash(fingerprint: Hash, repositoryPath: string, entry: ChangedEntry) {
  updateHashPart(fingerprint, entry.source)
  updateHashPart(fingerprint, entry.status)
  updateHashPart(fingerprint, entry.path)
  const absolutePath = path.resolve(repositoryPath, entry.path)
  let before: fs.Stats
  try {
    before = fs.lstatSync(absolutePath)
  } catch (error) {
    if (isMissingPath(error)) {
      updateHashPart(fingerprint, 'missing')
      return
    }
    throw error
  }
  updateHashPart(fingerprint, before.mode.toString(8))
  if (before.isSymbolicLink()) {
    updateHashPart(fingerprint, 'symlink')
    updateHashPart(fingerprint, fs.readlinkSync(absolutePath))
    return
  }
  if (!before.isFile()) throw new Error('Git validation cannot fingerprint a non-file worktree entry.')
  updateHashPart(fingerprint, 'file')
  updateHashPart(fingerprint, String(before.size))
  updateFileHash(fingerprint, absolutePath, before.size)
  const after = fs.lstatSync(absolutePath)
  if (after.mode !== before.mode || after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
    throw new Error('The validation worktree changed while its build identity was being read.')
  }
}

function updateFileHash(fingerprint: Hash, absolutePath: string, expectedBytes: number) {
  const descriptor = fs.openSync(absolutePath, 'r')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let bytesRead = 0
  try {
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      bytesRead += count
      fingerprint.update(buffer.subarray(0, count))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  if (bytesRead !== expectedBytes) throw new Error('The validation worktree file changed while it was being read.')
}

function requireRelativePath(repositoryPath: string, relativePath: string) {
  const absolutePath = path.resolve(repositoryPath, relativePath)
  if (absolutePath === repositoryPath || !absolutePath.startsWith(`${repositoryPath}${path.sep}`)) {
    throw new Error('Git returned a path outside the validation worktree.')
  }
  return relativePath
}

function readGitText(git: (args: readonly string[]) => Buffer, args: readonly string[]) {
  return git(args).toString('utf8').trim()
}

function readGitBytes(
  repositoryPath: string,
  args: readonly string[],
  metadataLimitBytes: number,
  gitCommand: GitCommandRunner,
) {
  const result = gitCommand(repositoryPath, args, metadataLimitBytes)
  if (result.error || result.signal || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error('Git validation metadata could not be read completely.')
  }
  const output = result.stdout
  if (output.length > metadataLimitBytes) {
    throw new Error('Git validation metadata exceeded its configured limit.')
  }
  return output
}

function runGitCommand(
  repositoryPath: string,
  args: readonly string[],
  maxOutputBytes: number,
): GitCommandResult {
  const result = spawnSync('git', args, {
    cwd: repositoryPath,
    encoding: 'buffer',
    maxBuffer: maxOutputBytes,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ...(result.error ? { error: result.error } : {}),
    signal: result.signal,
    status: result.status,
    ...(Buffer.isBuffer(result.stdout) ? { stdout: result.stdout } : {}),
  }
}

function updateHashPart(fingerprint: Hash, value: Buffer | string) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  fingerprint.update(`${String(bytes.length)}\0`)
  fingerprint.update(bytes)
}

function isMissingPath(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function sanitizeBuildValue(value: string) {
  const normalized = value.replace(/[^A-Za-z0-9._/-]/g, '-').slice(0, 128)
  return normalized || 'detached'
}

function sanitizeCommit(value: string) {
  if (!/^[0-9a-f]{7,64}$/.test(value)) throw new Error('Git returned an invalid validation commit identity.')
  return value
}
