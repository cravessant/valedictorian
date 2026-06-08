import { describe, expect, it } from 'vitest'
import { createScoresPreloadApi } from './scores.preload'
import type { ScoreInput } from 'sparxie'

describe('scores preload API', () => {
  it('invokes the score record IPC channel with exact payload', async () => {
    const invocations: unknown[][] = []
    const api = createScoresPreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve()
      },
    })
    const input: ScoreInput = {
      applicationId: 'application-1',
      band: 'high',
      careerSignal: 8,
      cityWorkMode: 7,
      compensationLogistics: 6,
      penalties: [1],
      rationale: 'Strong backend internship fit.',
      roleRelevance: 9,
      rubricVersion: 'v1',
      score: 8,
    }

    await api.record(input)

    expect(invocations).toEqual([['scores:record', input]])
  })
})
