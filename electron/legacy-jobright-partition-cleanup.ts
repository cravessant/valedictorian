import fs from 'node:fs/promises'
import path from 'node:path'

export type LegacyJobrightPartitionCleanupCode =
  | 'legacy_jobright_partition_cleanup_failed'
  | 'legacy_jobright_partition_cleanup_succeeded'

interface LegacyJobrightPartitionCleanupLogger {
  info: (message: LegacyJobrightPartitionCleanupCode) => void
  warn: (message: LegacyJobrightPartitionCleanupCode) => void
}

interface RunLegacyJobrightBrowserPartitionCleanupOptions {
  logger?: LegacyJobrightPartitionCleanupLogger
  userDataPath: string
}

const legacyJobrightPartitionName =
  /^valedictorian-connector-[a-z0-9._-]+-jobright-browser-session$/

export async function runLegacyJobrightBrowserPartitionCleanup({
  logger = console,
  userDataPath,
}: RunLegacyJobrightBrowserPartitionCleanupOptions) {
  const code = await cleanupLegacyJobrightBrowserPartitions(userDataPath)

  try {
    if (code === 'legacy_jobright_partition_cleanup_failed') {
      logger.warn(code)
    } else {
      logger.info(code)
    }
  } catch {
    // Logging must never make a best-effort cleanup block app startup.
  }

  return code
}

export async function cleanupLegacyJobrightBrowserPartitions(
  userDataPath: string,
): Promise<LegacyJobrightPartitionCleanupCode> {
  const partitionsPath = path.join(userDataPath, 'Partitions')

  try {
    const partitionNames = await fs.readdir(partitionsPath)
    let cleanupFailed = false

    for (const partitionName of partitionNames) {
      if (!legacyJobrightPartitionName.test(partitionName)) {
        continue
      }

      try {
        await fs.rm(path.join(partitionsPath, partitionName), { force: true, recursive: true })
      } catch {
        cleanupFailed = true
      }
    }

    return cleanupFailed
      ? 'legacy_jobright_partition_cleanup_failed'
      : 'legacy_jobright_partition_cleanup_succeeded'
  } catch (error) {
    return isMissingPathError(error)
      ? 'legacy_jobright_partition_cleanup_succeeded'
      : 'legacy_jobright_partition_cleanup_failed'
  }
}

function isMissingPathError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
