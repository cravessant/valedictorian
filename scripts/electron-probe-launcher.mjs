// Shared launcher for the real-layout Electron probes: provisions the Electron
// binary on demand (pnpm gates the postinstall, so node_modules/electron may ship
// without one), builds the harness, then runs the probe.
//
// Provisioning must not call electron's own install.js: its bundled extract-zip
// hangs under Node 26, exiting 0 without ever writing path.txt.

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = path.join(repoRoot, 'node_modules/.bin/vite')
const rootRequire = createRequire(import.meta.url)

// Must exceed the widest CSS viewport a probe requests, or it measures a clamped window.
const virtualScreen = '1920x1080x24'

function log(label, message) {
  console.log(`[${label}]`, message)
}

function fail(label, message) {
  console.error(`[${label}] ERROR:`, message)
  process.exit(1)
}

// The path.txt electron ships without a binary check, so verify the file exists.
function resolveElectronBinary() {
  try {
    delete rootRequire.cache[rootRequire.resolve('electron')]
  } catch {
    // not cached yet
  }
  try {
    const binary = rootRequire('electron')
    return typeof binary === 'string' && existsSync(binary) ? binary : null
  } catch {
    return null
  }
}

function platformExecutablePath() {
  switch (process.platform) {
    case 'win32':
      return 'electron.exe'
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    default:
      return 'electron'
  }
}

async function provisionElectron(label) {
  const electronDir = realpathSync(path.join(repoRoot, 'node_modules/electron'))
  const electronRequire = createRequire(path.join(electronDir, 'install.js'))
  let downloadArtifact
  let version
  let checksums
  try {
    ;({ downloadArtifact } = electronRequire('@electron/get'))
    ;({ version } = electronRequire('./package.json'))
    checksums = electronRequire('./checksums.json')
  } catch (err) {
    fail(label, `cannot load Electron download tooling (${err.message}); delete node_modules/electron and reinstall`)
  }

  log(label, `Electron binary missing; provisioning v${version} for ${process.platform}/${process.arch} ...`)
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    checksums,
  })
  log(label, `using ${path.basename(zipPath)}`)

  const distDir = path.join(electronDir, 'dist')
  const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', distDir], { stdio: 'inherit' })
  if (unzip.error && unzip.error.code === 'ENOENT') {
    const ditto = spawnSync('ditto', ['-x', '-k', zipPath, distDir], { stdio: 'inherit' })
    if (ditto.status !== 0) fail(label, 'failed to extract the Electron archive (unzip missing, ditto failed)')
  } else if (unzip.status !== 0) {
    fail(label, `failed to extract the Electron archive (unzip status ${unzip.status})`)
  }
  writeFileSync(path.join(electronDir, 'path.txt'), platformExecutablePath())
}

async function ensureElectron(label) {
  const existing = resolveElectronBinary()
  if (existing) return existing
  await provisionElectron(label)
  const provisioned = resolveElectronBinary()
  if (!provisioned) fail(label, 'Electron binary still missing after provisioning; check ELECTRON_CACHE / network access')
  log(label, 'Electron binary ready.')
  return provisioned
}

// Real window geometry needs a display server; headless Linux has to borrow one.
export function electronProbeCommand(electronBinary, probeEntry, {
  display = process.env.DISPLAY,
  platform = process.platform,
} = {}) {
  return platform === 'linux' && !display
    ? {
        args: ['--auto-servernum', `--server-args=-screen 0 ${virtualScreen}`, electronBinary, probeEntry],
        command: 'xvfb-run',
      }
    : { args: [probeEntry], command: electronBinary }
}

export async function runElectronLayoutProbe({ harnessConfig, label, probeEntry }) {
  const electronBinary = await ensureElectron(label)
  const build = spawnSync(viteBin, ['build', '--config', harnessConfig], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  })
  if (build.status !== 0) fail(label, `harness build failed (vite status ${build.status})`)
  const probe = electronProbeCommand(electronBinary, probeEntry)
  const run = spawnSync(probe.command, probe.args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  })
  process.exit(run.status ?? 1)
}
