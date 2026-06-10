import { describe, expect, it } from 'vitest'
import type {
  CreateSourcingFindingInput,
  ValedictorianClient,
  PromoteSourcingFindingInput,
  SetSourcingFindingDecisionInput,
  SourcingFindingsListInput,
  UpdateSourcingFindingInput,
} from 'sparxie'
import { registerSourcingIpc } from './sourcing.ipc'

describe('sourcing IPC registration', () => {
  it('registers sourcing findings handlers that delegate to the selected client', async () => {
    const calls: unknown[][] = []
    const result = {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    }
    const client = {
      sourcing: {
        findings: {
          async list(query?: SourcingFindingsListInput) {
            calls.push(['list', query])
            return result
          },
          async create(input: CreateSourcingFindingInput) {
            calls.push(['create', input])
            return { id: 'finding-1' }
          },
          async update(input: UpdateSourcingFindingInput) {
            calls.push(['update', input])
            return { id: input.findingId }
          },
          async decide(input: SetSourcingFindingDecisionInput) {
            calls.push(['decide', input])
            return { id: input.findingId }
          },
          async promote(input: PromoteSourcingFindingInput) {
            calls.push(['promote', input])
            return { id: input.findingId }
          },
        },
      },
    } as ValedictorianClient
    const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()

    registerSourcingIpc(client, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    const listQuery = { mergeStatus: 'new' as const, limit: 25 }
    const createInput = {
      workflowRunId: 'run-1',
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      roleKind: 'internship' as const,
      workMode: 'remote' as const,
    }
    const updateInput = { findingId: 'finding-1', sourceUrl: 'https://jobs.example.com/delta' }
    const decisionInput = {
      findingId: 'finding-1',
      mergeStatus: 'not_pursued' as const,
      mergeNotes: 'Skipping after review.',
    }
    const promoteInput = { findingId: 'finding-1' }

    await expect(handlers.get('sourcing:findings:list')?.({}, listQuery)).resolves.toEqual(result)
    await expect(handlers.get('sourcing:findings:create')?.({}, createInput)).resolves.toMatchObject({
      id: 'finding-1',
    })
    await expect(handlers.get('sourcing:findings:update')?.({}, updateInput)).resolves.toMatchObject({
      id: 'finding-1',
    })
    await expect(handlers.get('sourcing:findings:decide')?.({}, decisionInput)).resolves.toMatchObject({
      id: 'finding-1',
    })
    await expect(handlers.get('sourcing:findings:promote')?.({}, promoteInput)).resolves.toMatchObject({
      id: 'finding-1',
    })
    expect(calls).toEqual([
      ['list', listQuery],
      ['create', createInput],
      ['update', updateInput],
      ['decide', decisionInput],
      ['promote', promoteInput],
    ])
  })
})
