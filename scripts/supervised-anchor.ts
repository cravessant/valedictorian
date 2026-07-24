import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  SUPERVISED_LEADER_EXIT_MESSAGE,
  type SupervisedLeaderExitMessage,
} from './supervised-launch'

const validationRendererPort = process.env.VALEDICTORIAN_ISOLATED_VALIDATION_RENDERER_PORT
const validationEvidenceDirectory = process.env.VALEDICTORIAN_ISOLATED_VALIDATION_EVIDENCE_PATH
const leader = spawn('pnpm', validationRendererPort === '0'
  ? ['exec', 'vite', '--host', '127.0.0.1']
  : validationRendererPort
    ? ['exec', 'vite', '--host', '127.0.0.1', '--port', validationRendererPort, '--strictPort']
    : ['exec', 'vite'], {
  env: process.env,
  stdio: 'inherit',
})
let reported = false
let terminalExitCode: 0 | 1 | null = null
const terminalStatePath = validationEvidenceDirectory
  ? path.join(validationEvidenceDirectory, 'terminal-state.json')
  : null
const terminalStateWatcher = validationEvidenceDirectory
  ? fs.watch(validationEvidenceDirectory, (_, filename) => {
      if (String(filename) === 'terminal-state.json') completeFromTerminalState()
    })
  : null

function reportLeaderExit(code: number | null, signal: NodeJS.Signals | null) {
  if (reported) return
  reported = true
  terminalStateWatcher?.close()
  const message: SupervisedLeaderExitMessage = {
    code,
    signal,
    type: SUPERVISED_LEADER_EXIT_MESSAGE,
  }
  if (!process.send) return
  process.send(message, () => process.disconnect())
}

leader.once('error', () => reportLeaderExit(1, null))
leader.once('exit', (code, signal) => {
  terminalStateWatcher?.close()
  reportLeaderExit(terminalExitCode ?? code, terminalExitCode === null ? signal : null)
})
process.once('disconnect', () => undefined)

function completeFromTerminalState() {
  if (!terminalStatePath || terminalExitCode !== null) return
  try {
    const state = JSON.parse(fs.readFileSync(terminalStatePath, 'utf8')) as { outcome?: unknown }
    if (state.outcome !== 'completed' && state.outcome !== 'child_failure') return
    terminalExitCode = state.outcome === 'completed' ? 0 : 1
    leader.kill('SIGTERM')
  } catch {
    // Atomic writes can briefly make a watcher event observable before the rename completes.
  }
}
