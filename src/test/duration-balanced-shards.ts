import { slowTestBoundaryInventory } from './slow-test-boundary-inventory'

export type WeightedTestFile = {
  path: string
  weight: number
}

export type TestShard = {
  files: string[]
  totalWeight: number
}

export const CI_TEST_SHARD_CAPACITIES = [1, 1] as const

const defaultFileWeight = 1_000
const currentWeightOverrides = new Map<string, number>([
  ['src/modules/profile/ProfileSettingsPanel.test.tsx', 6_000],
  ['src/modules/connectors/connector.runner.refresh-contract.test.ts', 4_000],
  ['src/server/local-server.connector-capabilities.edge-contracts.test.ts', 5_000],
  ['src/modules/source-execution/source-execution-governor.test.ts', 7_000],
  ['src/modules/source-execution/source-session-executor.test.ts', 7_000],
  ['src/modules/action-queue/action-queue.repository.test.ts', 7_000],
])
const baselineWeights = new Map(
  slowTestBoundaryInventory.map(({ hostedDurationMs, path: file }) => [
    file,
    hostedDurationMs,
  ]),
)

export function testWeightForPath(file: string) {
  return currentWeightOverrides.get(file)
    ?? baselineWeights.get(file)
    ?? defaultFileWeight
}

export function assignDurationBalancedShards(
  files: readonly WeightedTestFile[],
  shardCount: number,
  shardCapacities: readonly number[] = Array.from({ length: shardCount }, () => 1),
): TestShard[] {
  if (!Number.isInteger(shardCount) || shardCount <= 0) {
    throw new Error('Shard count must be a positive integer')
  }
  if (
    shardCapacities.length !== shardCount
    || shardCapacities.some((capacity) => !Number.isFinite(capacity) || capacity <= 0)
  ) {
    throw new Error('Shard capacity must be a positive finite number for every shard')
  }
  const paths = new Set<string>()
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`Duplicate test file: ${file.path}`)
    if (!Number.isFinite(file.weight) || file.weight < 0) {
      throw new Error(`Invalid test weight for ${file.path}`)
    }
    paths.add(file.path)
  }

  const shards = Array.from({ length: shardCount }, (): TestShard => ({
    files: [],
    totalWeight: 0,
  }))
  const ordered = [...files].sort(
    (left, right) => right.weight - left.weight || left.path.localeCompare(right.path),
  )
  for (const file of ordered) {
    const target = shards.reduce((best, candidate) => {
      const candidateIndex = shards.indexOf(candidate)
      const bestIndex = shards.indexOf(best)
      const candidateNormalizedLoad = candidate.totalWeight / shardCapacities[candidateIndex]!
      const bestNormalizedLoad = best.totalWeight / shardCapacities[bestIndex]!
      if (candidateNormalizedLoad !== bestNormalizedLoad) {
        return candidateNormalizedLoad < bestNormalizedLoad ? candidate : best
      }
      if (candidate.files.length !== best.files.length) {
        return candidate.files.length < best.files.length ? candidate : best
      }
      return candidateIndex < bestIndex ? candidate : best
    })
    target.files.push(file.path)
    target.totalWeight += file.weight
  }
  for (const shard of shards) {
    shard.files.sort()
  }
  return shards
}
