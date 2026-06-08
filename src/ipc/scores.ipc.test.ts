import { describe, expect, it } from 'vitest'
import type { JobAppClient, ScoreInput } from 'sparxie'
import { registerScoresIpc } from './scores.ipc'

describe('scores IPC registration', () => {
  it('registers a scores:record handler that delegates to the selected client', async () => {
    const inputs: ScoreInput[] = []
    const client = {
      scores: {
        async record(input: ScoreInput) {
          inputs.push(input)
        },
      },
    } as unknown as JobAppClient
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

    await expect(handlers.get('scores:record')?.({}, input)).resolves.toBeUndefined()
    expect(inputs).toEqual([input])
  })
})
