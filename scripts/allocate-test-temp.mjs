import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const GIBABYTE = 1024 ** 3
export const MIN_SHM_FREE_BYTES = 2 * GIBABYTE
export const MIN_MEM_AVAILABLE_BYTES = 2 * GIBABYTE
export const TEST_TEMP_DIR_PREFIX = 'valedictorian-vitest-'
export const SHM_ROOT = '/dev/shm'

/**
 * @typedef {{
 *   platform?: string,
 *   runnerOs?: string | undefined,
 *   runnerTemp?: string | undefined,
 *   findmntFsType?: (mount: string) => string | null,
 *   isWritable?: (dir: string) => boolean,
 *   freeBytes?: (dir: string) => number,
 *   memAvailableBytes?: () => number,
 *   mktemp?: (parent: string, prefix: string) => string,
 *   realpath?: (candidate: string) => string,
 *   log?: (message: string) => void,
 * }} AllocateTestTempProbes
 */

/**
 * @typedef {{
 *   root: string,
 *   backing: 'shm' | 'runner-temp',
 *   freeBytes: number,
 *   memAvailableBytes: number,
 * }} AllocatedTestTempRoot
 */

/**
 * @param {string} mount
 * @returns {string | null}
 */
function defaultFindmntFsType(mount) {
  const output = execFileSync('findmnt', ['-n', '-o', 'FSTYPE', mount], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  return output || null
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function defaultIsWritable(dir) {
  fs.accessSync(dir, fs.constants.W_OK)
  return true
}

/**
 * @param {string} dir
 * @returns {number}
 */
function defaultFreeBytes(dir) {
  const stats = fs.statfsSync(dir)
  return Number(stats.bavail) * Number(stats.bsize)
}

/**
 * @returns {number}
 */
function defaultMemAvailableBytes() {
  const contents = fs.readFileSync('/proc/meminfo', 'utf8')
  const match = contents.match(/^MemAvailable:\s+(\d+)\s+kB$/m)
  if (!match) return 0
  return Number(match[1]) * 1024
}

/**
 * @param {string} parent
 * @param {string} prefix
 * @returns {string}
 */
function defaultMktemp(parent, prefix) {
  return fs.mkdtempSync(path.join(parent, prefix))
}

/**
 * @param {string} candidate
 * @returns {string}
 */
function defaultRealpath(candidate) {
  return fs.realpathSync.native(candidate)
}

/**
 * @param {AllocateTestTempProbes} [probes]
 * @returns {Required<AllocateTestTempProbes>}
 */
function resolveProbes(probes = {}) {
  return {
    platform: probes.platform ?? process.platform,
    runnerOs: probes.runnerOs ?? process.env.RUNNER_OS,
    runnerTemp: probes.runnerTemp ?? process.env.RUNNER_TEMP ?? os.tmpdir(),
    findmntFsType: probes.findmntFsType ?? defaultFindmntFsType,
    isWritable: probes.isWritable ?? defaultIsWritable,
    freeBytes: probes.freeBytes ?? defaultFreeBytes,
    memAvailableBytes: probes.memAvailableBytes ?? defaultMemAvailableBytes,
    mktemp: probes.mktemp ?? defaultMktemp,
    realpath: probes.realpath ?? defaultRealpath,
    log: probes.log ?? ((message) => {
      process.stderr.write(`${message}\n`)
    }),
  }
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatGib(bytes) {
  return (bytes / GIBABYTE).toFixed(2).replace(/\.?0+$/, '')
}

/**
 * @param {Required<AllocateTestTempProbes>} probes
 * @returns {boolean}
 */
function isLinuxAllocationHost(probes) {
  if (probes.platform !== 'linux') return false
  if (probes.runnerOs == null || probes.runnerOs === '') return true
  return String(probes.runnerOs).toLowerCase() === 'linux'
}

/**
 * @param {Required<AllocateTestTempProbes>} probes
 * @param {number} memAvailableBytes
 * @returns {{ root: string, freeBytes: number } | null}
 */
function tryAllocateShmRoot(probes, memAvailableBytes) {
  if (!isLinuxAllocationHost(probes)) return null
  if (probes.findmntFsType(SHM_ROOT) !== 'tmpfs') return null
  if (!probes.isWritable(SHM_ROOT)) return null
  const freeBytes = probes.freeBytes(SHM_ROOT)
  if (freeBytes < MIN_SHM_FREE_BYTES) return null
  if (memAvailableBytes < MIN_MEM_AVAILABLE_BYTES) return null
  return {
    root: probes.mktemp(SHM_ROOT, TEST_TEMP_DIR_PREFIX),
    freeBytes,
  }
}

/**
 * @param {Required<AllocateTestTempProbes>} probes
 * @param {string} message
 * @returns {void}
 */
function safeLog(probes, message) {
  try {
    probes.log(message)
  } catch {
    // Diagnostic logging must never abort allocation or trigger fallback.
  }
}

/**
 * @param {AllocateTestTempProbes} [probes]
 * @returns {AllocatedTestTempRoot}
 */
export function allocateTestTempRoot(probesInput = {}) {
  const probes = resolveProbes(probesInput)
  /** @type {number} */
  let memAvailableBytes = 0

  try {
    memAvailableBytes = probes.memAvailableBytes()
    const allocated = tryAllocateShmRoot(probes, memAvailableBytes)
    if (allocated) {
      safeLog(
        probes,
        `test-temp backing=shm root_parent=${SHM_ROOT} free_gib=${formatGib(allocated.freeBytes)} mem_available_gib=${formatGib(memAvailableBytes)}`,
      )
      return {
        root: allocated.root,
        backing: /** @type {const} */ ('shm'),
        freeBytes: allocated.freeBytes,
        memAvailableBytes,
      }
    }
  } catch {
    // Any shm probe/allocation failure (including MemAvailable) falls back to RUNNER_TEMP.
  }

  const runnerTemp = path.resolve(probes.runnerTemp)
  const freeBytes = probes.freeBytes(runnerTemp)
  const root = probes.mktemp(runnerTemp, TEST_TEMP_DIR_PREFIX)
  safeLog(
    probes,
    `test-temp backing=runner-temp root_parent=${runnerTemp} free_gib=${formatGib(freeBytes)} mem_available_gib=${formatGib(memAvailableBytes)}`,
  )
  return {
    root,
    backing: /** @type {const} */ ('runner-temp'),
    freeBytes,
    memAvailableBytes,
  }
}

/**
 * @param {string} baseName
 * @returns {boolean}
 */
function hasAllocatorPrefixAndSuffix(baseName) {
  if (!baseName.startsWith(TEST_TEMP_DIR_PREFIX)) return false
  return baseName.length > TEST_TEMP_DIR_PREFIX.length
}

/**
 * @param {string} candidate
 * @param {{
 *   runnerTemp?: string,
 *   realpath?: (candidate: string) => string,
 *   lstat?: (candidate: string) => Pick<fs.Stats, 'isSymbolicLink'>,
 *   existsSync?: (candidate: string) => boolean,
 * }} [options]
 * @returns {string}
 */
export function assertSafeTestTempCleanupPath(candidate, options = {}) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('Rejecting unsafe test-temp cleanup path: empty')
  }

  const resolvedCandidate = path.resolve(candidate)
  const runnerTemp = path.resolve(options.runnerTemp ?? process.env.RUNNER_TEMP ?? os.tmpdir())
  const shmRoot = path.resolve(SHM_ROOT)
  const existsSync = options.existsSync ?? ((target) => fs.existsSync(target))
  const lstat = options.lstat ?? ((target) => fs.lstatSync(target))
  const realpath = options.realpath ?? defaultRealpath

  const broad = new Set([
    '/',
    '/tmp',
    '/var/tmp',
    shmRoot,
    runnerTemp,
    path.resolve('.'),
  ])
  if (broad.has(resolvedCandidate) || resolvedCandidate === path.parse(resolvedCandidate).root) {
    throw new Error(`Rejecting unsafe/broad test-temp cleanup path: ${resolvedCandidate}`)
  }

  const lexicalParent = path.dirname(resolvedCandidate)
  const baseName = path.basename(resolvedCandidate)
  const directShmChild = lexicalParent === shmRoot
  const directRunnerChild = lexicalParent === runnerTemp
  if (!directShmChild && !directRunnerChild) {
    throw new Error(
      `Rejecting unsafe test-temp cleanup path (not a direct child of /dev/shm or RUNNER_TEMP): ${resolvedCandidate}`,
    )
  }
  if (!hasAllocatorPrefixAndSuffix(baseName)) {
    throw new Error(
      `Rejecting unsafe test-temp cleanup path without allocator prefix+suffix: ${resolvedCandidate}`,
    )
  }

  if (!existsSync(resolvedCandidate)) {
    return resolvedCandidate
  }

  const stats = lstat(resolvedCandidate)
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Rejecting unsafe test-temp cleanup path (symbolic link): ${resolvedCandidate}`,
    )
  }

  let realCandidate
  let realRunnerTemp
  try {
    realCandidate = path.resolve(realpath(resolvedCandidate))
    realRunnerTemp = path.resolve(realpath(runnerTemp))
  } catch {
    throw new Error(`Rejecting unsafe test-temp cleanup path (unresolvable): ${resolvedCandidate}`)
  }

  const realShmRoot = path.resolve(SHM_ROOT)
  const realBroad = new Set([
    '/',
    '/tmp',
    '/var/tmp',
    realShmRoot,
    realRunnerTemp,
    path.resolve('.'),
  ])
  if (realBroad.has(realCandidate) || realCandidate === path.parse(realCandidate).root) {
    throw new Error(`Rejecting unsafe/broad test-temp cleanup path: ${realCandidate}`)
  }

  const realParent = path.dirname(realCandidate)
  const realBaseName = path.basename(realCandidate)
  const realDirectShmChild = realParent === realShmRoot
  const realDirectRunnerChild = realParent === realRunnerTemp
  if (!realDirectShmChild && !realDirectRunnerChild) {
    throw new Error(
      `Rejecting unsafe test-temp cleanup path (not a direct child of /dev/shm or RUNNER_TEMP): ${realCandidate}`,
    )
  }
  if (!hasAllocatorPrefixAndSuffix(realBaseName)) {
    throw new Error(
      `Rejecting unsafe test-temp cleanup path without allocator prefix+suffix: ${realCandidate}`,
    )
  }

  return resolvedCandidate
}

/**
 * @param {string} candidate
 * @param {{
 *   runnerTemp?: string,
 *   realpath?: (candidate: string) => string,
 *   lstat?: (candidate: string) => Pick<fs.Stats, 'isSymbolicLink'>,
 *   existsSync?: (candidate: string) => boolean,
 * }} [options]
 * @returns {void}
 */
export function cleanupTestTempRoot(candidate, options = {}) {
  const resolved = assertSafeTestTempCleanupPath(candidate, options)
  const existsSync = options.existsSync ?? ((target) => fs.existsSync(target))
  if (!existsSync(resolved)) return
  fs.rmSync(resolved, { force: true, recursive: true })
}

/**
 * @param {string[]} argv
 * @returns {void}
 */
function runCli(argv) {
  if (argv[0] === '--cleanup') {
    const target = argv[1]
    if (!target) {
      process.stderr.write('allocate-test-temp: missing cleanup path\n')
      process.exitCode = 1
      return
    }
    try {
      cleanupTestTempRoot(target)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
    return
  }

  if (argv[0] === '--print-root' || argv[0] === '--print-env' || argv.length === 0) {
    if (argv[0] === '--print-env') {
      process.stderr.write('allocate-test-temp: --print-env is removed; use --print-root\n')
      process.exitCode = 1
      return
    }
    if (argv.length === 0) {
      process.stderr.write('allocate-test-temp: pass --print-root or --cleanup <path>\n')
      process.exitCode = 1
      return
    }
    try {
      const allocated = allocateTestTempRoot()
      process.stdout.write(`${allocated.root}\n`)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
    return
  }

  process.stderr.write(`allocate-test-temp: unknown arguments: ${argv.join(' ')}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2))
}
