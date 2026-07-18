import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { inspectPgliteRuntimeArtifactLayout } from './inspect-pglite-runtime-assets.mjs'

const successFileName = 'success.json'

export function findPackagedAppExecutable(releaseRoot, platform = process.platform) {
  const expectedSuffix = platform === 'darwin'
    ? path.join('Valedictorian.app', 'Contents', 'MacOS', 'Valedictorian')
    : platform === 'win32'
      ? 'Valedictorian.exe'
      : 'valedictorian-app'
  const matches = collectFiles(path.resolve(releaseRoot))
    .filter((filePath) => filePath.endsWith(expectedSuffix))
    .filter((filePath) => !/uninstall/i.test(path.basename(filePath)))
    .sort()

  if (matches.length !== 1) {
    throw new Error(`Expected one packaged ${platform} executable under ${releaseRoot}; found ${matches.length}`)
  }
  return matches[0]
}

function collectFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(entryPath))
    else files.push(entryPath)
  }
  return files
}

export function packagedPgliteSmokeEnvironment(environment, resultDirectory) {
  const result = {
    ...environment,
    VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PATH: resultDirectory,
  }
  delete result.ELECTRON_RUN_AS_NODE
  return result
}

export function resolvePackagedResourcesDirectory(executablePath, platform = process.platform) {
  if (platform === 'darwin') {
    return path.resolve(path.dirname(executablePath), '..', 'Resources')
  }
  return path.join(path.dirname(executablePath), 'resources')
}

async function runPackagedApp(executablePath, environment, timeoutMs) {
  await new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Packaged PGlite smoke timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) resolve(undefined)
      else reject(new Error(`Packaged app exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`))
    })
  })
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function run() {
  const releaseRoot = path.resolve(readArgument('--release-root') ?? 'release')
  const executablePath = path.resolve(
    readArgument('--app') ?? findPackagedAppExecutable(releaseRoot),
  )
  const timeoutMs = Number(readArgument('--timeout-ms') ?? 120_000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer')
  }

  const resourcesDirectory = resolvePackagedResourcesDirectory(executablePath)
  const artifactProblems = inspectPgliteRuntimeArtifactLayout(resourcesDirectory)
  if (artifactProblems.length > 0) {
    throw new Error(`Packaged PGlite asset inspection failed:\n${artifactProblems.join('\n')}`)
  }

  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-packaged-smoke-'))
  try {
    await runPackagedApp(
      executablePath,
      packagedPgliteSmokeEnvironment(process.env, resultDirectory),
      timeoutMs,
    )
    const successPath = path.join(resultDirectory, successFileName)
    if (!fs.existsSync(successPath)) {
      throw new Error(`Packaged app did not create ${successFileName}`)
    }
    const result = JSON.parse(fs.readFileSync(successPath, 'utf8'))
    if (result.companyName !== 'Packaged PGlite Smoke' || result.persistedApplications < 1) {
      throw new Error('Packaged app returned an invalid PGlite smoke result')
    }
    process.stdout.write('Packaged PGlite restart smoke OK\n')
  } finally {
    fs.rmSync(resultDirectory, { force: true, recursive: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
