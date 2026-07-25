import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { electronNativeUiProofLaunch } from './electron-native-ui-proof-launch'
import { installElectronNativeUiProofSignalForwarding } from './electron-native-ui-proof-process'

const layoutProof = readLayoutProofArgument(process.argv.slice(2))
const launch = electronNativeUiProofLaunch({
  proof: layoutProof ? 'capture-completion-layout' : 'workflow',
})
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
const resultPath = path.join(
  evidenceDirectory,
  layoutProof ? 'capture-completion-dialog-layout-proof.json' : 'electron-native-ui-proof.json',
)
if (!fs.existsSync(resultPath)) {
  throw new Error(`Electron proof did not produce a result. ${safeOutput(output)}`)
}
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
  assertions?: unknown
  measurements?: unknown
  outcome?: unknown
  screenshots?: unknown
}
if (
  code !== 0
  || signal
  || result.outcome !== 'completed'
  || (layoutProof
    ? !hasLayoutMeasurements(result.measurements) || !hasCompletedCaptureAssertions(result.assertions)
    : !hasRequiredScreenshots(result.screenshots))
) {
  throw new Error(`Electron proof failed. ${safeOutput(output)}`)
}
process.stdout.write(`${layoutProof ? 'Capture completion dialog layout' : 'Electron native UI'} proof evidence: ${resultPath}\n`)

function hasRequiredScreenshots(value: unknown) {
  if (!Array.isArray(value)) return false
  const names = new Set(value.map((entry) => (
    entry && typeof entry === 'object' && 'name' in entry ? entry.name : undefined
  )))
  return names.has('before-completion') && names.has('after-completion')
}

function hasLayoutMeasurements(value: unknown) {
  if (!Array.isArray(value) || value.length !== 3) return false
  const widths = value.map((entry) => (
    entry
    && typeof entry === 'object'
    && 'viewport' in entry
    && entry.viewport
    && typeof entry.viewport === 'object'
    && 'width' in entry.viewport
      ? entry.viewport.width
      : undefined
  ))
  return widths.join(',') === '320,768,1440'
}

function hasCompletedCaptureAssertions(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const assertions = value as Record<string, unknown>
  return assertions.captureCompletionOpened === true
    && assertions.existingCompanySelected === true
    && assertions.jobVisible === true
    && assertions.workspaceCompanyVisible === true
}

function readLayoutProofArgument(args: readonly string[]) {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--capture-completion-layout') return true
  throw new Error('Electron native UI proof accepts only --capture-completion-layout.')
}

function safeOutput(value: string) {
  return value
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(-600)
}
