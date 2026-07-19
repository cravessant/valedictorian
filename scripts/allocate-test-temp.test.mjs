import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GIBABYTE,
  MIN_MEM_AVAILABLE_BYTES,
  MIN_SHM_FREE_BYTES,
  SHM_ROOT,
  TEST_TEMP_DIR_PREFIX,
  allocateTestTempRoot,
  assertSafeTestTempCleanupPath,
  cleanupTestTempRoot,
} from './allocate-test-temp.mjs'

const cleanupPaths = new Set()
const allocatorCli = fileURLToPath(new URL('./allocate-test-temp.mjs', import.meta.url))

afterEach(() => {
  for (const cleanupPath of cleanupPaths) {
    fs.rmSync(cleanupPath, { force: true, recursive: true })
  }
  cleanupPaths.clear()
})

function createWritableRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanupPaths.add(root)
  return root
}

function runAllocatorCli(args, env = {}) {
  return spawnSync(process.execPath, [allocatorCli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('allocate-test-temp', () => {
  it('selects a unique /dev/shm child when Linux tmpfs probes all pass', () => {
    const logs = []
    const shmParent = '/dev/shm'
    const allocated = path.join(shmParent, `${TEST_TEMP_DIR_PREFIX}abc123`)
    let freeCalls = 0
    const result = allocateTestTempRoot({
      platform: 'linux',
      runnerOs: 'Linux',
      runnerTemp: '/home/runner/work/_temp',
      findmntFsType: (mount) => (mount === shmParent ? 'tmpfs' : null),
      isWritable: (dir) => dir === shmParent,
      freeBytes: (dir) => {
        freeCalls += 1
        expect(dir).toBe(shmParent)
        return MIN_SHM_FREE_BYTES
      },
      memAvailableBytes: () => MIN_MEM_AVAILABLE_BYTES,
      mktemp: (parent, prefix) => {
        expect(parent).toBe(shmParent)
        expect(prefix).toBe(TEST_TEMP_DIR_PREFIX)
        expect(freeCalls).toBe(1)
        return allocated
      },
      log: (message) => logs.push(message),
    })

    expect(result).toEqual({
      root: allocated,
      backing: 'shm',
      freeBytes: MIN_SHM_FREE_BYTES,
      memAvailableBytes: MIN_MEM_AVAILABLE_BYTES,
    })
    expect(freeCalls).toBe(1)
    expect(logs.join('\n')).toMatch(/backing=shm/)
    expect(logs.join('\n')).toMatch(/free_gib=2/)
    expect(logs.join('\n')).not.toMatch(/token|secret|password/i)
  })

  it('keeps the shm root when the diagnostic logger throws after allocation', () => {
    const allocated = `/dev/shm/${TEST_TEMP_DIR_PREFIX}log-throw`
    let runnerMktempCalls = 0
    const result = allocateTestTempRoot({
      platform: 'linux',
      runnerOs: 'Linux',
      runnerTemp: '/home/runner/work/_temp',
      findmntFsType: () => 'tmpfs',
      isWritable: () => true,
      freeBytes: (dir) => (dir === '/dev/shm' ? MIN_SHM_FREE_BYTES : 0),
      memAvailableBytes: () => MIN_MEM_AVAILABLE_BYTES,
      mktemp: (parent, prefix) => {
        if (parent === '/dev/shm') {
          expect(prefix).toBe(TEST_TEMP_DIR_PREFIX)
          return allocated
        }
        runnerMktempCalls += 1
        return path.join(parent, `${prefix}leaked`)
      },
      log: () => {
        throw new Error('stderr unavailable')
      },
    })

    expect(result).toEqual({
      root: allocated,
      backing: 'shm',
      freeBytes: MIN_SHM_FREE_BYTES,
      memAvailableBytes: MIN_MEM_AVAILABLE_BYTES,
    })
    expect(runnerMktempCalls).toBe(0)
  })

  it('does not re-probe shm free bytes after mktemp succeeds', () => {
    const allocated = `/dev/shm/${TEST_TEMP_DIR_PREFIX}once-free`
    let freeCalls = 0
    allocateTestTempRoot({
      platform: 'linux',
      runnerOs: 'Linux',
      runnerTemp: '/home/runner/work/_temp',
      findmntFsType: () => 'tmpfs',
      isWritable: () => true,
      freeBytes: (dir) => {
        freeCalls += 1
        if (freeCalls > 1) throw new Error('second freeBytes probe')
        expect(dir).toBe('/dev/shm')
        return MIN_SHM_FREE_BYTES
      },
      memAvailableBytes: () => MIN_MEM_AVAILABLE_BYTES,
      mktemp: () => allocated,
      log: () => {},
    })
    expect(freeCalls).toBe(1)
  })

  it('falls back to a unique RUNNER_TEMP child when shm probes fail or throw', () => {
    const runnerTemp = createWritableRoot('runner-temp-')
    const allocated = path.join(runnerTemp, `${TEST_TEMP_DIR_PREFIX}fallback`)
    const cases = [
      { platform: 'darwin', runnerOs: 'macOS', reason: 'non-linux' },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'ext4',
        reason: 'non-tmpfs',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'tmpfs',
        isWritable: () => false,
        reason: 'not-writable',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'tmpfs',
        isWritable: () => true,
        freeBytes: () => MIN_SHM_FREE_BYTES - 1,
        reason: 'low-free',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'tmpfs',
        isWritable: () => true,
        freeBytes: () => MIN_SHM_FREE_BYTES,
        memAvailableBytes: () => MIN_MEM_AVAILABLE_BYTES - 1,
        reason: 'low-mem',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => {
          throw new Error('findmnt boom')
        },
        reason: 'findmnt-throw',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'tmpfs',
        isWritable: () => {
          throw new Error('writable boom')
        },
        reason: 'writable-throw',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'tmpfs',
        isWritable: () => true,
        freeBytes: (dir) => {
          if (dir === '/dev/shm') throw new Error('freeBytes boom')
          return MIN_SHM_FREE_BYTES
        },
        reason: 'freeBytes-throw',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'tmpfs',
        isWritable: () => true,
        freeBytes: () => MIN_SHM_FREE_BYTES,
        memAvailableBytes: () => {
          throw new Error('mem boom')
        },
        reason: 'mem-throw',
      },
      {
        platform: 'linux',
        runnerOs: 'Linux',
        findmntFsType: () => 'tmpfs',
        isWritable: () => true,
        freeBytes: () => MIN_SHM_FREE_BYTES,
        memAvailableBytes: () => MIN_MEM_AVAILABLE_BYTES,
        mktemp: (parent, prefix) => {
          if (parent === '/dev/shm') throw new Error('mktemp failed')
          expect(parent).toBe(runnerTemp)
          expect(prefix).toBe(TEST_TEMP_DIR_PREFIX)
          return allocated
        },
        reason: 'mktemp-failed',
      },
    ]

    for (const scenario of cases) {
      const memCalls = { count: 0 }
      const result = allocateTestTempRoot({
        platform: scenario.platform,
        runnerOs: scenario.runnerOs,
        runnerTemp,
        findmntFsType: scenario.findmntFsType ?? (() => 'tmpfs'),
        isWritable: scenario.isWritable ?? (() => true),
        freeBytes: scenario.freeBytes ?? (() => MIN_SHM_FREE_BYTES),
        memAvailableBytes: scenario.memAvailableBytes ?? (() => {
          memCalls.count += 1
          return MIN_MEM_AVAILABLE_BYTES
        }),
        mktemp: scenario.mktemp ?? ((parent, prefix) => {
          expect(parent).toBe(runnerTemp)
          expect(prefix).toBe(TEST_TEMP_DIR_PREFIX)
          return allocated
        }),
        log: () => {},
      })

      expect(result, scenario.reason).toMatchObject({
        root: allocated,
        backing: 'runner-temp',
      })
      if (!scenario.memAvailableBytes) {
        expect(memCalls.count, scenario.reason).toBe(1)
      }
    }
  })

  it('samples MemAvailable once even when shm allocation succeeds', () => {
    let memCalls = 0
    allocateTestTempRoot({
      platform: 'linux',
      runnerOs: 'Linux',
      runnerTemp: '/home/runner/work/_temp',
      findmntFsType: () => 'tmpfs',
      isWritable: () => true,
      freeBytes: () => MIN_SHM_FREE_BYTES,
      memAvailableBytes: () => {
        memCalls += 1
        return MIN_MEM_AVAILABLE_BYTES
      },
      mktemp: () => `/dev/shm/${TEST_TEMP_DIR_PREFIX}once`,
      log: () => {},
    })
    expect(memCalls).toBe(1)
  })

  it('rejects nested, prefix-only, broad, and escaped cleanup targets', () => {
    const runnerTemp = createWritableRoot('runner-temp-safe-')
    const allocated = fs.mkdtempSync(path.join(runnerTemp, TEST_TEMP_DIR_PREFIX))
    cleanupPaths.add(allocated)
    fs.writeFileSync(path.join(allocated, 'scratch.txt'), 'temp')
    const nested = path.join(allocated, `${TEST_TEMP_DIR_PREFIX}nested`)
    fs.mkdirSync(nested)
    const prefixOnly = path.join(runnerTemp, TEST_TEMP_DIR_PREFIX)
    fs.mkdirSync(prefixOnly, { recursive: true })
    cleanupPaths.add(prefixOnly)

    expect(() => assertSafeTestTempCleanupPath('/')).toThrow(/reject|unsafe|broad/i)
    expect(() => assertSafeTestTempCleanupPath('/tmp')).toThrow(/reject|unsafe|broad/i)
    expect(() => assertSafeTestTempCleanupPath('/dev/shm')).toThrow(/reject|unsafe|broad/i)
    expect(() => assertSafeTestTempCleanupPath(runnerTemp, { runnerTemp })).toThrow(
      /reject|unsafe|broad/i,
    )
    expect(() => assertSafeTestTempCleanupPath(path.join(runnerTemp, 'other-prefix-x'), {
      runnerTemp,
    })).toThrow(/reject|unsafe/i)
    expect(() => assertSafeTestTempCleanupPath(nested, { runnerTemp })).toThrow(
      /direct child|unsafe/i,
    )
    expect(() => assertSafeTestTempCleanupPath(prefixOnly, { runnerTemp })).toThrow(
      /prefix\+suffix|unsafe/i,
    )
    expect(() => assertSafeTestTempCleanupPath(allocated, {
      runnerTemp,
      realpath: (candidate) => (
        candidate === allocated ? path.join(runnerTemp, 'escaped-outside') : candidate
      ),
    })).toThrow(/direct child|unsafe/i)

    const symlinkEscape = path.join(runnerTemp, `${TEST_TEMP_DIR_PREFIX}linky`)
    fs.symlinkSync(path.join(runnerTemp, '..'), symlinkEscape)
    cleanupPaths.add(symlinkEscape)
    expect(() => assertSafeTestTempCleanupPath(symlinkEscape, { runnerTemp })).toThrow(
      /symbolic link|symlink|direct child|unsafe|broad/i,
    )

    expect(() => cleanupTestTempRoot(allocated, { runnerTemp })).not.toThrow()
    expect(fs.existsSync(allocated)).toBe(false)
    expect(() => cleanupTestTempRoot(allocated, { runnerTemp })).not.toThrow()
  })

  it('rejects sibling allocator-shaped symlinks without deleting the real target', () => {
    const runnerTemp = createWritableRoot('runner-temp-sibling-link-')
    const allocated = fs.mkdtempSync(path.join(runnerTemp, TEST_TEMP_DIR_PREFIX))
    cleanupPaths.add(allocated)
    fs.writeFileSync(path.join(allocated, 'keep-me.txt'), 'preserve')
    const siblingLink = path.join(runnerTemp, `${TEST_TEMP_DIR_PREFIX}sibling-link`)
    fs.symlinkSync(allocated, siblingLink)
    cleanupPaths.add(siblingLink)

    expect(() => assertSafeTestTempCleanupPath(siblingLink, { runnerTemp })).toThrow(
      /symbolic link|symlink|unsafe/i,
    )
    expect(() => cleanupTestTempRoot(siblingLink, { runnerTemp })).toThrow(
      /symbolic link|symlink|unsafe/i,
    )
    expect(fs.existsSync(allocated)).toBe(true)
    expect(fs.readFileSync(path.join(allocated, 'keep-me.txt'), 'utf8')).toBe('preserve')
    expect(fs.lstatSync(siblingLink).isSymbolicLink()).toBe(true)
  })

  it('rejects nonexistent unsafe paths and allows repeated cleanup of a valid allocated child', () => {
    const runnerTemp = createWritableRoot('runner-temp-idempotent-')
    const outsideMissing = path.join(os.tmpdir(), `not-allocator-${Date.now()}`, 'missing-child')
    expect(fs.existsSync(outsideMissing)).toBe(false)
    expect(() => assertSafeTestTempCleanupPath(outsideMissing, { runnerTemp })).toThrow(
      /direct child|unsafe|reject/i,
    )
    expect(() => cleanupTestTempRoot(outsideMissing, { runnerTemp })).toThrow(
      /direct child|unsafe|reject/i,
    )

    const allocated = fs.mkdtempSync(path.join(runnerTemp, TEST_TEMP_DIR_PREFIX))
    cleanupPaths.add(allocated)
    fs.writeFileSync(path.join(allocated, 'scratch.txt'), 'temp')
    expect(() => cleanupTestTempRoot(allocated, { runnerTemp })).not.toThrow()
    expect(fs.existsSync(allocated)).toBe(false)
    expect(() => cleanupTestTempRoot(allocated, { runnerTemp })).not.toThrow()
    expect(() => assertSafeTestTempCleanupPath(allocated, { runnerTemp })).not.toThrow()
  })

  it('requires process.platform linux and never lets RUNNER_OS override a non-Linux platform', () => {
    const runnerTemp = createWritableRoot('runner-temp-linux-gate-')
    const allocated = path.join(runnerTemp, `${TEST_TEMP_DIR_PREFIX}linux-gate`)
    const shmProbes = {
      findmntFsType: () => 'tmpfs',
      isWritable: () => true,
      freeBytes: () => MIN_SHM_FREE_BYTES,
      memAvailableBytes: () => MIN_MEM_AVAILABLE_BYTES,
      mktemp: (parent) => path.join(parent, `${TEST_TEMP_DIR_PREFIX}shm`),
      log: () => {},
    }

    expect(allocateTestTempRoot({
      platform: 'darwin',
      runnerOs: 'Linux',
      runnerTemp,
      ...shmProbes,
      mktemp: (parent, _prefix) => {
        expect(parent).toBe(runnerTemp)
        return allocated
      },
    }).backing).toBe('runner-temp')

    expect(allocateTestTempRoot({
      platform: 'linux',
      runnerOs: 'Windows',
      runnerTemp,
      ...shmProbes,
      mktemp: (parent, _prefix) => {
        expect(parent).toBe(runnerTemp)
        return allocated
      },
    }).backing).toBe('runner-temp')

    expect(allocateTestTempRoot({
      platform: 'linux',
      runnerOs: undefined,
      runnerTemp,
      ...shmProbes,
      mktemp: () => `/dev/shm/${TEST_TEMP_DIR_PREFIX}absent-runner-os`,
    }).backing).toBe('shm')
  })

  it('exposes 2 GiB thresholds used by the Linux shm gate', () => {
    expect(GIBABYTE).toBe(1024 ** 3)
    expect(MIN_SHM_FREE_BYTES).toBe(2 * GIBABYTE)
    expect(MIN_MEM_AVAILABLE_BYTES).toBe(2 * GIBABYTE)
  })

  it('CLI --print-root emits only the root on stdout and keeps logs on stderr', () => {
    const runnerTemp = createWritableRoot('runner-temp-cli-')
    const printed = runAllocatorCli(['--print-root'], { RUNNER_TEMP: runnerTemp })
    expect(printed.status).toBe(0)
    const root = printed.stdout.trim()
    // The allocator prefers a /dev/shm tmpfs child on Linux CI and falls back to
    // RUNNER_TEMP elsewhere; accept whichever legitimate backing it selected
    // rather than assuming RUNNER_TEMP (which only holds off Linux tmpfs hosts).
    const underShm = root.startsWith(`${SHM_ROOT}${path.sep}`)
    const underRunnerTemp = root.startsWith(`${runnerTemp}${path.sep}`)
    expect(underShm || underRunnerTemp).toBe(true)
    expect(path.basename(root).startsWith(TEST_TEMP_DIR_PREFIX)).toBe(true)
    expect(path.basename(root).length).toBeGreaterThan(TEST_TEMP_DIR_PREFIX.length)
    expect(printed.stdout.trim().split('\n')).toEqual([root])
    expect(printed.stderr).toMatch(underShm ? /backing=shm/ : /backing=runner-temp/)
    expect(printed.stderr).not.toContain(root)
    cleanupPaths.add(root)

    const cleaned = runAllocatorCli(['--cleanup', root], { RUNNER_TEMP: runnerTemp })
    expect(cleaned.status).toBe(0)
    expect(fs.existsSync(root)).toBe(false)
  })

  it('CLI assignment preserves unusual shell-safe paths and propagates failures under bash -e', () => {
    const runnerTemp = createWritableRoot("runner-temp-cli-'quote-")
    const printed = runAllocatorCli(['--print-root'], { RUNNER_TEMP: runnerTemp })
    expect(printed.status).toBe(0)
    const root = printed.stdout.trim()
    cleanupPaths.add(root)
    expect(root.includes("'") || path.basename(root).length > TEST_TEMP_DIR_PREFIX.length).toBe(true)

    const assignment = spawnSync('bash', ['-euo', 'pipefail', '-c', `
      TEST_TEMP_ROOT="$(${JSON.stringify(process.execPath)} ${JSON.stringify(allocatorCli)} --print-root)"
      test -n "$TEST_TEMP_ROOT"
      printf '%s' "$TEST_TEMP_ROOT"
    `], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: runnerTemp },
    })
    expect(assignment.status).toBe(0)
    expect(assignment.stdout).toBe(assignment.stdout.trim())
    cleanupPaths.add(assignment.stdout)

    const failedCleanup = runAllocatorCli(['--cleanup', '/tmp'], { RUNNER_TEMP: runnerTemp })
    expect(failedCleanup.status).not.toBe(0)
    expect(failedCleanup.stderr).toMatch(/reject|unsafe|broad/i)

    const failedAssign = spawnSync('bash', ['-euo', 'pipefail', '-c', `
      TEST_TEMP_ROOT="$(${JSON.stringify(process.execPath)} ${JSON.stringify(allocatorCli)} --cleanup /tmp)"
      echo should-not-run
    `], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: runnerTemp },
    })
    expect(failedAssign.status).not.toBe(0)
    expect(failedAssign.stdout).not.toContain('should-not-run')
  })
})
