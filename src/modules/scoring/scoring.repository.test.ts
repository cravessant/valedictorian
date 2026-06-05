import { describe, expect, it } from 'vitest'
import { scoreInputKeys } from './scoring.repository'
import type { ScoreInput, ScoringRepository } from './scoring.repository'

describe('scoring repository contract', () => {
  it('names the score input fields used by repository adapters', () => {
    expect(scoreInputKeys).toEqual([
      'applicationId',
      'score',
      'band',
      'roleRelevance',
      'careerSignal',
      'cityWorkMode',
      'compensationLogistics',
      'penalties',
      'rationale',
      'rubricVersion',
    ])
  })

  it('supports adding a score for an application', async () => {
    const scores: ScoreInput[] = []
    const repository: ScoringRepository = {
      async addScore(_applicationId, input) {
        scores.push(input)
      },
    }

    await repository.addScore('application-1', {
      score: 8,
      band: 'high',
      rationale: 'Strong backend fit.',
    })

    expect(scores).toHaveLength(1)
  })
})
