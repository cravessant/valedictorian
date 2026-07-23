import { describe, expect, it } from 'vitest'
import type { ValedictorianWorkspaceClient, ScoreInput, ScoreRecord } from '@sparxie/sdk'
import { registerScoresIpc } from './scores.ipc'

describe('scores IPC registration', () => {
  it('registers a scores:record handler that delegates to the selected client', async () => {
    const inputs: ScoreInput[] = []
    const scoreRecord: ScoreRecord = {
      applicationId: 'application-1',
      band: 'high',
      careerSignal: 8,
      cityWorkMode: 7,
      compensationLogistics: 6,
      createdAt: '2026-06-30T00:00:00.000Z',
      id: 'score-1',
      penalties: [1],
      rationale: 'Strong backend internship fit.',
      roleRelevance: 9,
      rubricVersion: 'v1',
      score: 8,
    }
    const client = {
      scores: {
        async record(input: ScoreInput) {
          inputs.push(input)
          return scoreRecord
        },
      },
    } as unknown as ValedictorianWorkspaceClient
    const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()

    registerScoresIpc(client, {
      handle(channel, handler) {
        handlers.set(channel, handler)
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

    await expect(handlers.get('scores:record')?.({}, input)).resolves.toEqual(scoreRecord)
    expect(inputs).toEqual([input])
  })
})
