import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { cliUiDevProofLaunch } from './cli-ui-dev-proof-launch'
import { installElectronNativeUiProofSignalForwarding } from './electron-native-ui-proof-process'

const launch = cliUiDevProofLaunch()
const proof = spawn(launch.command, launch.args, {
  cwd: process.cwd(),
  detached: process.platform !== 'win32',
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (!proof.pid) throw new Error('The CLI/UI development proof did not start.')
const signalForwarding = installElectronNativeUiProofSignalForwarding(proof)

let output = ''
proof.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
proof.stderr?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_768) })
const [code, signal] = await once(proof, 'close')
signalForwarding.stop()
if (signalForwarding.error()) {
  throw new Error(`CLI/UI proof signal forwarding failed. ${safeOutput(String(signalForwarding.error()))}`)
}
const evidenceDirectory = output.match(/^Isolated validation evidence: (.+)$/m)?.[1]
if (!evidenceDirectory) {
  throw new Error(`CLI/UI development proof did not report evidence. ${safeOutput(output)}`)
}
const resultPath = path.join(evidenceDirectory, 'cli-ui-dev-proof.json')
if (!fs.existsSync(resultPath)) {
  throw new Error(`CLI/UI development proof did not produce a result. ${safeOutput(output)}`)
}
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
  assertions?: unknown
  cli?: unknown
  outcome?: unknown
  schemaVersion?: unknown
  screenshots?: unknown
}
if (
  code !== 0
  || signal
  || result.schemaVersion !== 'valedictorian-cli-ui-dev-proof@1'
  || result.outcome !== 'completed'
  || !allAssertionsPassed(result.assertions)
  || !hasPinnedCli(result.cli)
  || !hasRequiredScreenshots(result.screenshots)
) {
  throw new Error(`CLI/UI development proof failed. ${safeOutput(output)}`)
}
process.stdout.write(`CLI/UI development proof evidence: ${resultPath}\n`)

function allAssertionsPassed(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const assertions = Object.values(value)
  return assertions.length === 7 && assertions.every((assertion) => assertion === true)
}

function hasPinnedCli(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('actual' in value)) return false
  const actual = value.actual
  return Boolean(
    actual
    && typeof actual === 'object'
    && 'version' in actual
    && actual.version === '0.1.0-alpha.18'
    && 'commit' in actual
    && actual.commit === '147eadc5fa84c560f32c0392e68f8c7627ccec47'
    && 'packageSha256' in actual
    && actual.packageSha256
      === 'sha256:368c39360cf7b0268759ae7f261651519cc6f0573be2674c9e2116364e83a37b',
  )
}

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
