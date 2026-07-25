import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { electronNativeUiProofLaunch } from './electron-native-ui-proof-launch'
import { installElectronNativeUiProofSignalForwarding } from './electron-native-ui-proof-process'
import { electronNativeUiProofFailureMessage } from './electron-native-ui-proof-result'

const proofMode = readProofArgument(process.argv.slice(2))
const launch = electronNativeUiProofLaunch({
  proof: proofMode,
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
  proofMode === 'capture-completion-layout'
    ? 'capture-completion-dialog-layout-proof.json'
    : 'electron-native-ui-proof.json',
)
if (!fs.existsSync(resultPath)) {
  throw new Error(`Electron proof did not produce a result. ${safeOutput(output)}`)
}
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
  assertions?: unknown
  measurements?: unknown
  outcome?: unknown
  diagnostics?: {
    assertionFailure?: unknown
  }
  screenshots?: unknown
}
if (
  code !== 0
  || signal
  || result.outcome !== 'completed'
  || (proofMode === 'capture-completion-layout'
    ? !hasLayoutMeasurements(result.measurements) || !hasCompletedCaptureAssertions(result.assertions)
    : !hasRequiredScreenshots(result.screenshots))
) {
  throw new Error(electronNativeUiProofFailureMessage({ output, result, safeOutput }))
}
process.stdout.write(`${proofMode === 'capture-completion-layout'
  ? 'Capture completion dialog layout'
  : 'Electron native UI'} proof evidence: ${resultPath}\n`)

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

function readProofArgument(args: readonly string[]) {
  if (args.length === 0) return 'workflow' as const
  if (args.length === 1 && args[0] === '--capture-completion-layout') return 'capture-completion-layout' as const
  throw new Error('Electron native UI proof accepts no arguments or --capture-completion-layout.')
}

function safeOutput(value: string) {
  return value
    .replace(/(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/ig, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(-600)
}
