import { spawn } from 'node:child_process'
import {
  SUPERVISED_LEADER_EXIT_MESSAGE,
  type SupervisedLeaderExitMessage,
} from './supervised-launch'

const leader = spawn('pnpm', ['exec', 'vite'], {
  env: process.env,
  stdio: 'inherit',
})
let reported = false

function reportLeaderExit(code: number | null, signal: NodeJS.Signals | null) {
  if (reported) return
  reported = true
  const message: SupervisedLeaderExitMessage = {
    code,
    signal,
    type: SUPERVISED_LEADER_EXIT_MESSAGE,
  }
  process.send?.(message)
}

leader.once('error', () => reportLeaderExit(1, null))
leader.once('exit', reportLeaderExit)
process.once('disconnect', () => undefined)
