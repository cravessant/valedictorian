import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupLegacyJobrightBrowserPartitions,
  runLegacyJobrightBrowserPartitionCleanup,
} from './legacy-jobright-partition-cleanup'

const tempDirectories: string[] = []

afterEach(() => {
  for (const tempDirectory of tempDirectories.splice(0)) {
    fs.rmSync(tempDirectory, { force: true, recursive: true })
  }
})

describe('legacy Jobright browser partition cleanup', () => {
  it('removes only production-shaped legacy Jobright browser-session partitions', async () => {
    const userDataPath = createTempUserDataPath()
    const partitionsPath = path.join(userDataPath, 'Partitions')
    const legacyPartitionPath = path.join(
      partitionsPath,
      'valedictorian-connector-workspace-1-jobright-browser-session',
    )
    const preservedPartitionNames = [
      'valedictorian-connector-workspace-1-jobright-browser-session-backup',
      'valedictorian-connector-workspace-1-jobright-browser-sessions',
      'valedictorian-connector-workspace-1-linkedin-browser-session',
      'unrelated-app-partition',
    ]
    const ordinaryProfilePath = path.join(userDataPath, 'Default')

    createProductionShapedPartition(legacyPartitionPath)
    for (const partitionName of preservedPartitionNames) {
      fs.mkdirSync(path.join(partitionsPath, partitionName), { recursive: true })
    }
    fs.mkdirSync(ordinaryProfilePath, { recursive: true })

    await expect(cleanupLegacyJobrightBrowserPartitions(userDataPath)).resolves.toBe(
      'legacy_jobright_partition_cleanup_succeeded',
    )

    expect(fs.existsSync(legacyPartitionPath)).toBe(false)
    for (const partitionName of preservedPartitionNames) {
      expect(fs.existsSync(path.join(partitionsPath, partitionName))).toBe(true)
    }
    expect(fs.existsSync(ordinaryProfilePath)).toBe(true)
  })

  it('records only a sanitized result code', async () => {
    const userDataPath = createTempUserDataPath()
    const privateWorkspaceIdentifier = 'private-workspace-identifier'
    createProductionShapedPartition(path.join(
      userDataPath,
      'Partitions',
      `valedictorian-connector-${privateWorkspaceIdentifier}-jobright-browser-session`,
    ))
    const infoMessages: string[] = []
    const warningMessages: string[] = []

    await expect(runLegacyJobrightBrowserPartitionCleanup({
      logger: {
        info: (message) => infoMessages.push(message),
        warn: (message) => warningMessages.push(message),
      },
      userDataPath,
    })).resolves.toBe('legacy_jobright_partition_cleanup_succeeded')

    expect(infoMessages).toEqual(['legacy_jobright_partition_cleanup_succeeded'])
    expect(warningMessages).toEqual([])
    expect(JSON.stringify(infoMessages)).not.toContain(privateWorkspaceIdentifier)
    expect(JSON.stringify(infoMessages)).not.toContain(userDataPath)
  })

  it('is idempotent across app restarts', async () => {
    const userDataPath = createTempUserDataPath()
    const legacyPartitionPath = path.join(
      userDataPath,
      'Partitions',
      'valedictorian-connector-workspace-restart-jobright-browser-session',
    )
    createProductionShapedPartition(legacyPartitionPath)

    await expect(cleanupLegacyJobrightBrowserPartitions(userDataPath)).resolves.toBe(
      'legacy_jobright_partition_cleanup_succeeded',
    )
    await expect(cleanupLegacyJobrightBrowserPartitions(userDataPath)).resolves.toBe(
      'legacy_jobright_partition_cleanup_succeeded',
    )

    expect(fs.existsSync(legacyPartitionPath)).toBe(false)
  })

  it('reports a sanitized failure without rejecting startup', async () => {
    const userDataPath = createTempUserDataPath()
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.closeSync(fs.openSync(path.join(userDataPath, 'Partitions'), 'w'))
    const infoMessages: string[] = []
    const warningMessages: string[] = []

    await expect(runLegacyJobrightBrowserPartitionCleanup({
      logger: {
        info: (message) => infoMessages.push(message),
        warn: (message) => warningMessages.push(message),
      },
      userDataPath,
    })).resolves.toBe('legacy_jobright_partition_cleanup_failed')

    expect(infoMessages).toEqual([])
    expect(warningMessages).toEqual(['legacy_jobright_partition_cleanup_failed'])
  })

  it('continues removing allowlisted partitions when one is locked', async () => {
    const userDataPath = createTempUserDataPath()
    const partitionsPath = path.join(userDataPath, 'Partitions')
    const lockedPartitionName =
      'valedictorian-connector-workspace-locked-jobright-browser-session'
    const removablePartitionName =
      'valedictorian-connector-workspace-removable-jobright-browser-session'
    const lockedPartitionPath = path.join(partitionsPath, lockedPartitionName)
    const removablePartitionPath = path.join(partitionsPath, removablePartitionName)
    createProductionShapedPartition(lockedPartitionPath)
    createProductionShapedPartition(removablePartitionPath)
    const removeDirectory = fsPromises.rm.bind(fsPromises)
    const removeSpy = vi.spyOn(fsPromises, 'rm').mockImplementation((filePath, options) => {
      if (path.basename(filePath.toString()) === lockedPartitionName) {
        return Promise.reject(Object.assign(new Error('fixture partition is locked'), {
          code: 'EBUSY',
        }))
      }

      return removeDirectory(filePath, options)
    })

    try {
      await expect(cleanupLegacyJobrightBrowserPartitions(userDataPath)).resolves.toBe(
        'legacy_jobright_partition_cleanup_failed',
      )
    } finally {
      removeSpy.mockRestore()
    }

    expect(fs.existsSync(lockedPartitionPath)).toBe(true)
    expect(fs.existsSync(removablePartitionPath)).toBe(false)
  })

  it('runs the cleanup at Electron startup before workspace activation', () => {
    const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
    const startupIndex = mainSource.indexOf('app.whenReady().then(async () => {')
    const cleanupIndex = mainSource.indexOf(
      "await runLegacyJobrightBrowserPartitionCleanup({ userDataPath: app.getPath('userData') })",
    )
    const workspaceRegistryIndex = mainSource.indexOf(
      'const registryStore = createFileWorkspaceRegistryStore(',
    )

    expect(mainSource).toContain(
      "import { runLegacyJobrightBrowserPartitionCleanup } from './legacy-jobright-partition-cleanup'",
    )
    expect(startupIndex).toBeGreaterThan(-1)
    expect(cleanupIndex).toBeGreaterThan(startupIndex)
    expect(cleanupIndex).toBeLessThan(workspaceRegistryIndex)
  })
})

function createTempUserDataPath() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-partition-cleanup-'))
  tempDirectories.push(tempDirectory)
  return path.join(tempDirectory, 'user-data')
}

function createProductionShapedPartition(partitionPath: string) {
  for (const relativeDirectory of [
    'Cache',
    'Local Storage/leveldb',
    'Network',
    'Session Storage',
  ]) {
    fs.mkdirSync(path.join(partitionPath, relativeDirectory), { recursive: true })
  }

  fs.closeSync(fs.openSync(path.join(partitionPath, 'Network', 'Cookies'), 'w'))
}
