import path from 'node:path'
import { BaseSequencer, type WorkspaceSpec } from 'vitest/node'
import {
  assignDurationBalancedShards,
  CI_TEST_SHARD_CAPACITIES,
  testWeightForPath,
  type WeightedTestFile,
} from './duration-balanced-shards'

function normalizedSpecPath(root: string, spec: WorkspaceSpec) {
  return path.relative(root, spec.moduleId).split(path.sep).join('/')
}

function workspaceProjectName(spec: WorkspaceSpec) {
  return spec.project?.name ?? ''
}

export function sortAssignedShardFilesByDescendingWeight(
  files: readonly string[],
  weightForPath: (file: string) => number = testWeightForPath,
) {
  return [...files]
    .map((file, index) => ({ file, index }))
    .sort((left, right) => {
      const normalizedLeft = left.file.split(path.sep).join('/')
      const normalizedRight = right.file.split(path.sep).join('/')
      const weightDelta = weightForPath(normalizedRight) - weightForPath(normalizedLeft)
      if (weightDelta !== 0) return weightDelta
      const pathDelta = normalizedLeft.localeCompare(normalizedRight)
      if (pathDelta !== 0) return pathDelta
      return left.index - right.index
    })
    .map(({ file }) => file)
}

export function sortWorkspaceSpecsByDescendingWeight(
  files: readonly WorkspaceSpec[],
  root: string,
  weightForPath: (file: string) => number = testWeightForPath,
) {
  return [...files]
    .map((spec, index) => ({ spec, index }))
    .sort((left, right) => {
      const normalizedLeft = normalizedSpecPath(root, left.spec)
      const normalizedRight = normalizedSpecPath(root, right.spec)
      const weightDelta = weightForPath(normalizedRight) - weightForPath(normalizedLeft)
      if (weightDelta !== 0) return weightDelta
      const pathDelta = normalizedLeft.localeCompare(normalizedRight)
      if (pathDelta !== 0) return pathDelta
      return left.index - right.index
    })
    .map(({ spec }) => spec)
}

export function assignWorkspaceSpecsToDurationBalancedShards(
  files: readonly WorkspaceSpec[],
  root: string,
  shardCount: number,
  shardCapacities?: readonly number[],
  weightForPath: (file: string) => number = testWeightForPath,
): WorkspaceSpec[][] {
  const annotated = files.map((spec, index) => {
    const relativePath = normalizedSpecPath(root, spec)
    return {
      spec,
      index,
      relativePath,
      projectName: workspaceProjectName(spec),
      weight: weightForPath(relativePath),
    }
  })
  const ranked = [...annotated].sort((left, right) => {
    const weightDelta = right.weight - left.weight
    if (weightDelta !== 0) return weightDelta
    const pathDelta = left.relativePath.localeCompare(right.relativePath)
    if (pathDelta !== 0) return pathDelta
    const projectDelta = left.projectName.localeCompare(right.projectName)
    if (projectDelta !== 0) return projectDelta
    return left.index - right.index
  })
  const weightedFiles = ranked.map((entry, rank): WeightedTestFile => ({
    path: `rank:${String(rank).padStart(8, '0')}`,
    weight: entry.weight,
  }))
  const specsByRankKey = new Map<string, WorkspaceSpec>(
    ranked.map((entry, rank) => [`rank:${String(rank).padStart(8, '0')}`, entry.spec]),
  )
  const assigned = assignDurationBalancedShards(
    weightedFiles,
    shardCount,
    shardCapacities,
  )
  return assigned.map((shard) => shard.files.map((key) => specsByRankKey.get(key)!))
}

export class DurationBalancedSequencer extends BaseSequencer {
  override async shard(files: WorkspaceSpec[]) {
    const shard = this.ctx.config.shard
    if (!shard) return files

    const shardCapacities = process.env.CI && shard.count === CI_TEST_SHARD_CAPACITIES.length
      ? CI_TEST_SHARD_CAPACITIES
      : undefined
    const shards = assignWorkspaceSpecsToDurationBalancedShards(
      files,
      this.ctx.config.root,
      shard.count,
      shardCapacities,
    )
    return shards[shard.index - 1]!
  }

  override async sort(files: WorkspaceSpec[]) {
    return sortWorkspaceSpecsByDescendingWeight(files, this.ctx.config.root)
  }
}
