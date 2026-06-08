import { describe, expect, it } from 'vitest'
import { createApplicationsPreloadApi } from './applications.preload'

describe('applications preload API', () => {
  it('invokes the applications list IPC channel with query filters', async () => {
    const invocations: unknown[][] = []
    const api = createApplicationsPreloadApi({
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
    const query = {
      status: 'needs_user_info' as const,
      createdFrom: '2026-06-04T00:00:00.000Z',
    }

    await expect(api.list(query)).resolves.toMatchObject({ total: 0 })
    expect(invocations).toEqual([['applications:list', query]])
  })

  it('invokes the application attempts list IPC channel', async () => {
    const invocations: unknown[][] = []
    const api = createApplicationsPreloadApi({
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

    await expect(
      api.attempts.list({ applicationId: 'application-1', limit: 25 }),
    ).resolves.toMatchObject({ total: 0 })
    expect(invocations).toEqual([
      ['applications:attempts:list', { applicationId: 'application-1', limit: 25 }],
    ])
  })

  it('invokes application detail, links, and events IPC channels', async () => {
    const invocations: unknown[][] = []
    const api = createApplicationsPreloadApi({
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

    await api.get('application-1')
    await api.links.list({ applicationId: 'application-1', limit: 25 })
    await api.events.list({ applicationId: 'application-1', offset: 5 })

    expect(invocations).toEqual([
      ['applications:get', 'application-1'],
      ['applications:links:list', { applicationId: 'application-1', limit: 25 }],
      ['applications:events:list', { applicationId: 'application-1', offset: 5 }],
    ])
  })

  it('invokes application mutation IPC channels with exact payloads', async () => {
    const invocations: unknown[][] = []
    const api = createApplicationsPreloadApi({
      invoke(...args) {
        invocations.push(args)
        return Promise.resolve({})
      },
    })
    const createInput = {
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship' as const,
      country: 'US',
      workMode: 'remote' as const,
      status: 'queued' as const,
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.com/delta',
      },
    }
    const updateInput = {
      applicationId: 'application-1',
      roleTitle: 'Backend Intern',
    }

    await api.create(createInput)
    await api.update(updateInput)
    await api.updateStatus({
      applicationId: 'application-1',
      status: 'submitted',
      notes: 'Submitted manually.',
    })
    await api.archive({
      applicationId: 'application-1',
      note: 'Duplicate row.',
    })
    await api.workflow.update({
      applicationId: 'application-1',
      manualReviewKind: 'overridable',
    })
    await api.notes.append({
      applicationId: 'application-1',
      message: 'Human note.',
    })
    await api.links.create({
      applicationId: 'application-1',
      kind: 'official',
      label: 'official',
      url: 'https://jobs.example.com/delta',
      isPrimary: true,
    })
    await api.links.update({
      applicationId: 'application-1',
      linkId: 'link-1',
      label: 'source',
    })

    expect(invocations).toEqual([
      ['applications:create', createInput],
      ['applications:update', updateInput],
      [
        'applications:update-status',
        {
          applicationId: 'application-1',
          status: 'submitted',
          notes: 'Submitted manually.',
        },
      ],
      ['applications:archive', { applicationId: 'application-1', note: 'Duplicate row.' }],
      [
        'applications:workflow:update',
        {
          applicationId: 'application-1',
          manualReviewKind: 'overridable',
        },
      ],
      ['applications:notes:append', { applicationId: 'application-1', message: 'Human note.' }],
      [
        'applications:links:create',
        {
          applicationId: 'application-1',
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/delta',
          isPrimary: true,
        },
      ],
      [
        'applications:links:update',
        {
          applicationId: 'application-1',
          linkId: 'link-1',
          label: 'source',
        },
      ],
    ])
  })
})
