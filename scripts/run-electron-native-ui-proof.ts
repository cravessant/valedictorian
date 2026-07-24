import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { electronNativeUiProofLaunch } from './electron-native-ui-proof-launch'
import { installElectronNativeUiProofSignalForwarding } from './electron-native-ui-proof-process'

const launch = electronNativeUiProofLaunch()
const proof = spawn(launch.command, launch.args, {
  cwd: process.cwd(),
  detached: process.platform !== 'win32',
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (!proof.pid) throw new Error('The Electron native UI proof did not start.')
const signalForwarding = installElectronNativeUiProofSignalForwarding(proof)

let output = ''
proof.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
proof.stderr?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
const [code, signal] = await once(proof, 'close')
signalForwarding.stop()
if (signalForwarding.error()) {
  throw new Error(`Electron native UI proof signal forwarding failed. ${safeOutput(String(signalForwarding.error()))}`)
}
const evidenceDirectory = output.match(/^Isolated validation evidence: (.+)$/m)?.[1]
if (!evidenceDirectory) {
  throw new Error(`Electron native UI proof did not report evidence. ${safeOutput(output)}`)
}
const resultPath = path.join(evidenceDirectory, 'electron-native-ui-proof.json')
if (!fs.existsSync(resultPath)) {
  throw new Error(`Electron native UI proof did not produce a result. ${safeOutput(output)}`)
}
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
  outcome?: unknown
  screenshots?: unknown
}
if (code !== 0 || signal || result.outcome !== 'completed' || !hasRequiredScreenshots(result.screenshots)) {
  throw new Error(`Electron native UI proof failed. ${safeOutput(output)}`)
}
process.stdout.write(`Electron native UI proof evidence: ${resultPath}\n`)

function hasRequiredScreenshots(value: unknown) {
  if (!Array.isArray(value)) return false
  const names = new Set(value.map((entry) => (
    entry && typeof entry === 'object' && 'name' in entry ? entry.name : undefined
  )))
  return names.has('before-completion') && names.has('after-completion')
}

function safeOutput(value: string) {
  return value
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(-600)
}
