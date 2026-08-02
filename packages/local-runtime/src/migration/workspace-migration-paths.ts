import fs from 'node:fs'
import path from 'node:path'

export function canonicalizeWorkspacePath(candidate: string): string {
  let existing = path.resolve(candidate)
  const suffix: string[] = []
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    suffix.unshift(path.basename(existing))
    existing = parent
  }
  const canonicalExisting = fs.realpathSync(existing)
  return path.join(canonicalExisting, ...suffix)
}

export function isWorkspacePathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function workspacePathsOverlap(left: string, right: string): boolean {
  return left === right
    || isWorkspacePathWithin(left, right)
    || isWorkspacePathWithin(right, left)
}

export function resolveMigrationRoots(options: {
  evidenceRoot: string
  sourceRoot: string
  targetRoot: string
}) {
  const roots = {
    evidenceRoot: canonicalizeWorkspacePath(options.evidenceRoot),
    sourceRoot: canonicalizeWorkspacePath(options.sourceRoot),
    targetRoot: canonicalizeWorkspacePath(options.targetRoot),
  }
  const values = Object.values(roots)
  if (values.some((left, index) => values.some(
    (right, rightIndex) => index !== rightIndex && workspacePathsOverlap(left, right),
  ))) {
    throw new TypeError('Migration source, target, and evidence roots must not overlap.')
  }
  return roots
}

export function resolveMigrationJournalPath(evidenceRoot: string, transferId: string): string {
  if (!transferId.trim() || transferId.includes('/') || transferId.includes('\\')) {
    throw new TypeError('transferId must be a safe non-empty path segment.')
  }
  return path.join(evidenceRoot, 'transfers', transferId, 'journal.json')
}

export function resolveMigrationSnapshotRoot(evidenceRoot: string): string {
  return path.join(evidenceRoot, 'snapshots')
}

export function discardMigrationCandidate(targetRoot: string, sourceRoot: string): void {
  if (isTerminalSymbolicLink(targetRoot)) {
    throw new TypeError('Refusing to discard a symbolic-link migration candidate.')
  }
  const target = canonicalizeWorkspacePath(targetRoot)
  const source = canonicalizeWorkspacePath(sourceRoot)
  if (target === path.parse(target).root || workspacePathsOverlap(target, source)) {
    throw new TypeError('Refusing to discard an unsafe migration candidate path.')
  }
  fs.rmSync(target, { force: true, recursive: true })
}

function isTerminalSymbolicLink(candidate: string): boolean {
  try {
    return fs.lstatSync(path.resolve(candidate)).isSymbolicLink()
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}
