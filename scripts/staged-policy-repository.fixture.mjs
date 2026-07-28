import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * @typedef {{
 *   root: string,
 *   git: (...args: string[]) => string,
 *   write: (relativePath: string, contents: string) => void,
 *   runStagedPolicy: (scriptPath: string) => { status: number | null, stderr: string },
 * }} StagedPolicyRepository
 */

/**
 * Builds a throwaway repository so staged-path selection is exercised against
 * real index state. `core.hooksPath` is pinned to the fixture's own hooks
 * directory so a machine-level hooks path can never run against it.
 * @param {Record<string, string>} committedFiles
 * @returns {StagedPolicyRepository}
 */
export function createStagedPolicyRepository(committedFiles) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'staged-policy-')))
  /** @type {(...args: string[]) => string} */
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

  git('init', '--quiet', '--initial-branch', 'main', '.')
  git('config', 'user.email', 'policy@example.test')
  git('config', 'user.name', 'Policy Fixture')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.hooksPath', path.join(root, '.git', 'hooks'))

  /** @type {(relativePath: string, contents: string) => void} */
  const write = (relativePath, contents) => {
    const absolutePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, contents)
  }

  for (const [relativePath, contents] of Object.entries(committedFiles)) {
    write(relativePath, contents)
  }
  git('add', '--all')
  git('commit', '--quiet', '--message', 'fixture baseline')

  return {
    root,
    git,
    write,
    runStagedPolicy(scriptPath) {
      const result = spawnSync(process.execPath, [scriptPath, '--staged'], {
        cwd: root,
        encoding: 'utf8',
      })
      return { status: result.status, stderr: result.stderr }
    },
  }
}

/**
 * @param {StagedPolicyRepository | undefined} repository
 * @returns {void}
 */
export function removeStagedPolicyRepository(repository) {
  if (repository) fs.rmSync(repository.root, { recursive: true, force: true })
}
