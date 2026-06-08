import { describe, expect, it } from 'vitest'
import { createSourcingPreloadApi } from './sourcing.preload'

describe('sourcing preload API', () => {
  it('invokes sourcing findings IPC channels with typed payloads', async () => {
    const invocations: unknown[][] = []
    const api = createSourcingPreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          hasMore: false,
        })
      },
    })
    const listQuery = { mergeStatus: 'new' as const, limit: 25 }
    const createInput = {
      workflowRunId: 'run-1',
      sourceName: 'LinkedIn',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship' as const,
      country: 'US',
      workMode: 'remote' as const,
    }
    const updateInput = {
      findingId: 'finding-1',
      priorityScore: 4,
      priorityBand: 'skip',
    }
    const decisionInput = {
      findingId: 'finding-1',
      mergeStatus: 'not_fit' as const,
      mergeNotes: 'Requires a non-student schedule.',
    }
    const promoteInput = { findingId: 'finding-1' }

    await expect(api.findings.list(listQuery)).resolves.toMatchObject({ total: 0 })
    await api.findings.create(createInput)
    await api.findings.update(updateInput)
    await api.findings.decide(decisionInput)
    await api.findings.promote(promoteInput)

    expect(invocations).toEqual([
      ['sourcing:findings:list', listQuery],
      ['sourcing:findings:create', createInput],
      ['sourcing:findings:update', updateInput],
      ['sourcing:findings:decide', decisionInput],
      ['sourcing:findings:promote', promoteInput],
    ])
  })
})
