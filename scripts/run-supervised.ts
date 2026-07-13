import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDefaultWorkspaceRegistryPath } from '../src/workspace/workspace.paths'
import { createFileWorkspaceRegistryStore } from '../src/workspace/workspace.registry'
import { initializeWorkspace } from '../src/workspace/workspace.initializer'
import {
  createProcessTreeShutdown,
  createSupervisedLaunchLifecycle,
  isSupervisedLeaderExitMessage,
  launchSupervisedAnchor,
} from './supervised-launch'

const validation = process.argv[2] === 'validation'
const temporaryRoot = validation
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-validation-'))
  : null
const childEnvironment = { ...process.env }

if (temporaryRoot) {
  const userDataPath = path.join(temporaryRoot, 'user-data')
  const workspacePath = path.join(temporaryRoot, 'workspace')
  const workspace = initializeWorkspace(workspacePath)
  await createFileWorkspaceRegistryStore(
    getDefaultWorkspaceRegistryPath(userDataPath),
  ).markOpened({ id: workspace.id, name: workspace.name, path: workspace.rootPath })
  const branch = gitValue(['branch', '--show-current']) || 'detached'
  const commit = gitValue(['rev-parse', '--short', 'HEAD']) || 'unknown'
  childEnvironment.VALEDICTORIAN_USER_DATA_PATH = userDataPath
  childEnvironment.VITE_VALEDICTORIAN_BUILD_IDENTITY = `validation ${branch}@${commit}`
}
const anchor = launchSupervisedAnchor({ environment: childEnvironment })
const lifecycle = anchor.pid === undefined
  ? null
  : createSupervisedLaunchLifecycle({
      cleanup: cleanupValidationState,
      processTreeShutdown: createProcessTreeShutdown({
        onError(error) {
          console.error('Failed to terminate the supervised app process tree.', error)
          process.exitCode = 1
        },
        processId: anchor.pid,
      }),
      setExitCode(code) {
        process.exitCode = code
      },
    })
function shutdown() {
  lifecycle?.shutdown()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
anchor.on('message', (message) => {
  if (isSupervisedLeaderExitMessage(message)) {
    lifecycle?.leaderExited(message.code, message.signal)
  }
})
anchor.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
  shutdown()
})
anchor.once('exit', () => {
  if (lifecycle) {
    void lifecycle.anchorExited().catch((error) => {
      console.error('Failed to finalize supervised app teardown.', error)
      process.exitCode = 1
    })
  }
  else cleanupValidationState()
})

function cleanupValidationState() {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { force: true, recursive: true })
}

function gitValue(args: string[]) {
  return spawnSync('git', args, { encoding: 'utf8' }).stdout.trim()
}
