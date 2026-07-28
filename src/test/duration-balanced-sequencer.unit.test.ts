import { describe, expect, it } from 'vitest'
import { assignDurationBalancedShards } from './duration-balanced-shards'
import {
  assignWorkspaceSpecsToDurationBalancedShards,
  sortAssignedShardFilesByDescendingWeight,
  sortWorkspaceSpecsByDescendingWeight,
} from './duration-balanced-sequencer'
import type { TestSpecification } from 'vitest/node'

/** The sequencer only reads a spec's module id and project name. */
function testSpecification(moduleId: string, projectName: string): TestSpecification {
  return { moduleId, project: { name: projectName } } as unknown as TestSpecification
}

describe('duration-balanced test sharding', () => {
  it('assigns every file exactly once with deterministic bounded imbalance', () => {
    const files = [
      { path: 'a.test.ts', weight: 90 },
      { path: 'b.test.ts', weight: 80 },
      { path: 'c.test.ts', weight: 70 },
      { path: 'd.test.ts', weight: 60 },
      { path: 'e.test.ts', weight: 30 },
      { path: 'f.test.ts', weight: 20 },
      { path: 'g.test.ts', weight: 10 },
    ]

    const first = assignDurationBalancedShards(files, 3)
    const second = assignDurationBalancedShards([...files].reverse(), 3)

    expect(second).toEqual(first)
    expect(first.flatMap(({ files: shardFiles }) => shardFiles).sort()).toEqual(
      files.map(({ path }) => path).sort(),
    )
    expect(new Set(first.flatMap(({ files: shardFiles }) => shardFiles)).size).toBe(files.length)
    const weights = first.map(({ totalWeight }) => totalWeight)
    expect(Math.max(...weights) - Math.min(...weights)).toBeLessThanOrEqual(90)
  })

  it('rejects invalid shard counts and duplicate file paths', () => {
    expect(() => assignDurationBalancedShards([], 0)).toThrow(/positive integer/i)
    expect(() => assignDurationBalancedShards([
      { path: 'same.test.ts', weight: 1 },
      { path: 'same.test.ts', weight: 2 },
    ], 2)).toThrow(/duplicate test file/i)
  })

  it('assigns proportionally more duration weight to a faster shard', () => {
    const files = Array.from({ length: 20 }, (_, index) => ({
      path: `${String(index).padStart(2, '0')}.test.ts`,
      weight: 10,
    }))

    const shards = assignDurationBalancedShards(files, 2, [3, 7])

    expect(shards.map(({ totalWeight }) => totalWeight)).toEqual([60, 140])
    expect(shards.flatMap(({ files: shardFiles }) => shardFiles)).toHaveLength(20)
    expect(() => assignDurationBalancedShards(files, 2, [1])).toThrow(/capacity/i)
    expect(() => assignDurationBalancedShards(files, 2, [1, 0])).toThrow(/capacity/i)
  })

  it('orders files inside an assigned shard by descending weight with normalized path tie-break', () => {
    const files = [
      'src/beta-light.test.ts',
      'src/heavy.test.ts',
      'src/alpha-light.test.ts',
      'src/z-mid.test.ts',
      'src/medium.test.ts',
    ]
    const weightForPath = (file: string) => ({
      'src/heavy.test.ts': 90,
      'src/medium.test.ts': 50,
      'src/alpha-light.test.ts': 10,
      'src/beta-light.test.ts': 10,
      'src/z-mid.test.ts': 30,
    }[file] ?? 0)
    const expected = [
      'src/heavy.test.ts',
      'src/medium.test.ts',
      'src/z-mid.test.ts',
      'src/alpha-light.test.ts',
      'src/beta-light.test.ts',
    ]

    expect(sortAssignedShardFilesByDescendingWeight(files, weightForPath)).toEqual(expected)
    expect(sortAssignedShardFilesByDescendingWeight([...files].reverse(), weightForPath))
      .toEqual(expected)
    expect(sortAssignedShardFilesByDescendingWeight(files, weightForPath).sort())
      .toEqual([...files].sort())
  })

  it('preserves duplicate normalized WorkspaceSpec paths with stable index tie-break', () => {
    const root = '/repo'
    const first = testSpecification(`${root}/src/same.test.ts`, 'a')
    const second = testSpecification(`${root}/src/same.test.ts`, 'b')
    const heavy = testSpecification(`${root}/src/heavy.test.ts`, 'c')
    const weightForPath = (file: string) => (file.endsWith('heavy.test.ts') ? 50 : 10)

    const ordered = sortWorkspaceSpecsByDescendingWeight(
      [first, second, heavy],
      root,
      weightForPath,
    )
    expect(ordered).toHaveLength(3)
    expect(ordered[0]).toBe(heavy)
    expect(ordered[1]).toBe(first)
    expect(ordered[2]).toBe(second)
    expect(ordered.filter((spec) => spec.moduleId.endsWith('same.test.ts'))).toEqual([first, second])
  })

  it('preserves every WorkspaceSpec across shards when normalized paths collide', () => {
    const root = '/repo'
    const projectA = testSpecification(`${root}/src/same.test.ts`, 'a')
    const projectB = testSpecification(`${root}/src/same.test.ts`, 'b')
    const heavy = testSpecification(`${root}/src/heavy.test.ts`, 'c')
    const light = testSpecification(`${root}/src/light.test.ts`, 'd')
    const weightForPath = (file: string) => {
      if (file.endsWith('heavy.test.ts')) return 100
      if (file.endsWith('same.test.ts')) return 40
      return 10
    }
    const input = [projectA, projectB, heavy, light]

    const first = assignWorkspaceSpecsToDurationBalancedShards(
      input,
      root,
      2,
      undefined,
      weightForPath,
    )
    const second = assignWorkspaceSpecsToDurationBalancedShards(
      [...input].reverse(),
      root,
      2,
      undefined,
      weightForPath,
    )

    const firstMembership = first.flat()
    expect(firstMembership).toHaveLength(input.length)
    expect(new Set(firstMembership).size).toBe(input.length)
    expect(firstMembership).toEqual(expect.arrayContaining(input))
    expect(firstMembership.filter((spec) => spec === projectA || spec === projectB)).toEqual(
      expect.arrayContaining([projectA, projectB]),
    )
    expect(firstMembership.filter((spec) => spec === projectA || spec === projectB)).toHaveLength(2)
    expect(second).toEqual(first)

    const shardWeights = first.map((shardFiles) => shardFiles.reduce(
      (total, spec) => {
        const relative = spec.moduleId.startsWith(`${root}/`)
          ? spec.moduleId.slice(root.length + 1)
          : spec.moduleId
        return total + weightForPath(relative)
      },
      0,
    ))
    expect(Math.max(...shardWeights) - Math.min(...shardWeights)).toBeLessThanOrEqual(100)

    const heavyFirst = sortWorkspaceSpecsByDescendingWeight(firstMembership, root, weightForPath)
    expect(heavyFirst[0]).toBe(heavy)
    expect(heavyFirst.filter((spec) => spec === projectA || spec === projectB)).toEqual([
      projectA,
      projectB,
    ])
  })
})
