// Node-side launcher for the cravessant/valedictorian-app#309 real-layout probe.
//
// The probe itself (connector-modal-scroll-probe.mjs) runs *inside* Electron, but
// the `electron` binary cannot even launch when its dist is absent — pnpm blocks
// Electron's postinstall download in CI (and locally), so node_modules/electron
// ships without a binary and `require('electron')` throws before any probe code
// runs. The packaged smoke passes only because electron-builder provisions its
// own Electron dist independently. This launcher makes local and CI behave
// identically: it self-provisions the Electron binary, builds the harness, then
// spawns the probe.
//
// We do NOT enable the postinstall repo-wide (pnpm-workspace.yaml deliberately
// gates builds) — every install would then pay the ~100MB download. Instead we
// provision on demand and reuse the cache electron-builder already populated in
// the same macOS job (@electron/get and electron-builder share
// ~/Library/Caches/electron), so this is a fast extract there rather than a
// fresh download.
//
// Provisioning intentionally does NOT call electron's own install.js: its bundled
// extract-zip/yauzl hangs under Node 26 (the extract promise never settles, so
// install.js exits 0 without ever writing path.txt). We download via @electron/get
// (cache-aware) and extract with the system `unzip`, which is reliable here.

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const harnessConfig = path.join(repoRoot, 'electron/scroll-probe/vite.config.mjs')
const probeEntry = path.join(here, 'connector-modal-scroll-probe.mjs')
const viteBin = path.join(repoRoot, 'node_modules/.bin/vite')
const rootRequire = createRequire(import.meta.url)

function log(message) {
  console.log('[#309 scroll probe]', message)
}

function fail(message) {
  console.error('[#309 scroll probe] ERROR:', message)
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

async function provisionElectron() {
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
    fail(`cannot load Electron download tooling (${err.message}); delete node_modules/electron and reinstall`)
  }

  log(`Electron binary missing; provisioning v${version} for ${process.platform}/${process.arch} ...`)
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    checksums,
  })
  log(`using ${path.basename(zipPath)}`)

  const distDir = path.join(electronDir, 'dist')
  const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', distDir], { stdio: 'inherit' })
  if (unzip.error && unzip.error.code === 'ENOENT') {
    // macOS fallback (the CI job is macOS-only, but be resilient).
    const ditto = spawnSync('ditto', ['-x', '-k', zipPath, distDir], { stdio: 'inherit' })
    if (ditto.status !== 0) fail('failed to extract the Electron archive (unzip missing, ditto failed)')
  } else if (unzip.status !== 0) {
    fail(`failed to extract the Electron archive (unzip status ${unzip.status})`)
  }
  writeFileSync(path.join(electronDir, 'path.txt'), platformExecutablePath())
}

async function ensureElectron() {
  const existing = resolveElectronBinary()
  if (existing) return existing
  await provisionElectron()
  const provisioned = resolveElectronBinary()
  if (!provisioned) fail('Electron binary still missing after provisioning; check ELECTRON_CACHE / network access')
  log('Electron binary ready.')
  return provisioned
}

function buildHarness() {
  const build = spawnSync(viteBin, ['build', '--config', harnessConfig], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  })
  if (build.status !== 0) fail(`harness build failed (vite status ${build.status})`)
}

function runProbe(electronBinary) {
  const probe = spawnSync(electronBinary, [probeEntry], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  })
  process.exit(probe.status ?? 1)
}

const electronBinary = await ensureElectron()
buildHarness()
runProbe(electronBinary)
