import { describe, expect, it } from 'vitest'
import type { JobAppClient } from 'job-app-sdk'
import { registerApplicationIpc } from './applications.ipc'
import type { ApplicationListQuery } from '../modules/applications/application.types'

describe('application IPC registration', () => {
  it('registers an applications:list handler that delegates query filters to the selected client', async () => {
    const queries: ApplicationListQuery[] = []
    const client: JobAppClient = {
      applications: {
        async list(query) {
          if (query) {
            queries.push(query)
          }

          return {
            items: [
              {
                id: 'application-1',
                companyName: 'Astranis Space Technologies',
                roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
                sourceName: 'LinkedIn',
                status: 'needs_user_info',
                term: 'Fall 2026 internship',
                location: 'San Francisco, CA / Onsite',
                workMode: 'onsite',
                hasApplied: false,
                currentPriorityScore: 8,
                currentPriorityBand: 'high',
                primaryLink: null,
                notes: null,
                createdAt: '2026-06-04T16:00:00.000Z',
                updatedAt: '2026-06-04T16:00:00.000Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
            hasMore: false,
          }
        },
        async get() {
          return null
        },
        async updateStatus() {
          throw new Error('not used')
        },
      },
      scores: {
        async record() {
          throw new Error('not used')
        },
      },
    }
    const handlers = new Map<string, (_event: unknown, query?: ApplicationListQuery) => Promise<unknown>>()

    registerApplicationIpc(client, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    const query: ApplicationListQuery = {
      role: 'backend',
      updatedFrom: '2026-06-04T00:00:00.000Z',
    }

    await expect(handlers.get('applications:list')?.({}, query)).resolves.toMatchObject({
      total: 1,
    })
    expect(queries).toEqual([query])
  })
})
