import { describe, expect, it } from 'vitest'
import type {
  ArchiveApplicationInput,
  CreateApplicationInput,
  CreateApplicationLinkInput,
  ValedictorianClient,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationLinkInput,
  UpdateApplicationWorkflowInput,
} from 'sparxie'
import { registerApplicationIpc } from './applications.ipc'
import type {
  ApplicationAttemptsListInput,
  ApplicationEventsListInput,
  ApplicationLinksListInput,
  ApplicationListQuery,
} from '../modules/applications/application.types'

describe('application IPC registration', () => {
  it('registers an applications:list handler that delegates query filters to the selected client', async () => {
    const queries: ApplicationListQuery[] = []
    const attemptQueries: ApplicationAttemptsListInput[] = []
    const eventQueries: ApplicationEventsListInput[] = []
    const linkQueries: ApplicationLinksListInput[] = []
    const getIds: string[] = []
    const createInputs: CreateApplicationInput[] = []
    const updateInputs: UpdateApplicationInput[] = []
    const statusInputs: StatusUpdateInput[] = []
    const archiveInputs: ArchiveApplicationInput[] = []
    const workflowInputs: UpdateApplicationWorkflowInput[] = []
    const noteInputs: Array<{ applicationId: string; message: string }> = []
    const linkCreateInputs: CreateApplicationLinkInput[] = []
    const linkUpdateInputs: UpdateApplicationLinkInput[] = []
    const detail = {
      id: 'application-1',
      companyName: 'Astranis Space Technologies',
      roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
      sourceName: 'LinkedIn',
      status: 'needs_user_info' as const,
      term: 'Fall 2026 internship',
      location: 'San Francisco, CA / Onsite',
      workMode: 'onsite' as const,
      hasApplied: false,
      currentPriorityScore: 8,
      currentPriorityBand: 'high',
      primaryLink: null,
      notes: null,
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:00:00.000Z',
    }
    const client = {
      applications: {
        attempts: {
          async list(input: ApplicationAttemptsListInput) {
            attemptQueries.push(input)
            return {
              items: [],
              total: 0,
              limit: 50,
              offset: 0,
              hasMore: false,
            }
          },
        },
        events: {
          async list(input: ApplicationEventsListInput) {
            eventQueries.push(input)
            return {
              items: [],
              total: 0,
              limit: 50,
              offset: 0,
              hasMore: false,
            }
          },
        },
        links: {
          async list(input: ApplicationLinksListInput) {
            linkQueries.push(input)
            return {
              items: [],
              total: 0,
              limit: 50,
              offset: 0,
              hasMore: false,
            }
          },
          async create(input: CreateApplicationLinkInput) {
            linkCreateInputs.push(input)
            return {
              id: 'link-1',
              applicationId: input.applicationId,
              kind: input.kind,
              label: input.label,
              url: input.url,
              externalId: input.externalId ?? null,
              isPrimary: input.isPrimary === true,
              discoveredAt: '2026-06-04T16:00:00.000Z',
              createdAt: '2026-06-04T16:00:00.000Z',
              updatedAt: '2026-06-04T16:00:00.000Z',
              deletedAt: null,
            }
          },
          async update(input: UpdateApplicationLinkInput) {
            linkUpdateInputs.push(input)
            return {
              id: input.linkId,
              applicationId: input.applicationId,
              kind: input.kind ?? 'official',
              label: input.label ?? 'official',
              url: input.url ?? 'https://jobs.example.com/delta',
              externalId: input.externalId ?? null,
              isPrimary: input.isPrimary === true,
              discoveredAt: '2026-06-04T16:00:00.000Z',
              createdAt: '2026-06-04T16:00:00.000Z',
              updatedAt: '2026-06-04T16:00:00.000Z',
              deletedAt: null,
            }
          },
        },
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
        async get(applicationId: string) {
          getIds.push(applicationId)
          return null
        },
        async create(input: CreateApplicationInput) {
          createInputs.push(input)
          return detail
        },
        async update(input: UpdateApplicationInput) {
          updateInputs.push(input)
          return detail
        },
        async updateStatus(input: StatusUpdateInput) {
          statusInputs.push(input)
          return detail
        },
        async archive(input: ArchiveApplicationInput) {
          archiveInputs.push(input)
        },
        workflow: {
          async update(input: UpdateApplicationWorkflowInput) {
            workflowInputs.push(input)
            return detail
          },
        },
        notes: {
          async append(input: { applicationId: string; message: string }) {
            noteInputs.push(input)
            return detail
          },
        },
      },
      scores: {
        async record() {
          throw new Error('not used')
        },
      },
    } as unknown as ValedictorianClient
    const handlers = new Map<
      string,
      (
        _event: unknown,
        query?: ApplicationListQuery | ApplicationAttemptsListInput | ApplicationEventsListInput | ApplicationLinksListInput | string,
      ) => Promise<unknown>
    >()

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
    await expect(
      handlers.get('applications:attempts:list')?.(
        {},
        { applicationId: 'application-1', limit: 25 },
      ),
    ).resolves.toMatchObject({
      total: 0,
    })
    await expect(
      handlers.get('applications:links:list')?.(
        {},
        { applicationId: 'application-1', limit: 25 },
      ),
    ).resolves.toMatchObject({
      total: 0,
    })
    await expect(
      handlers.get('applications:events:list')?.(
        {},
        { applicationId: 'application-1', offset: 5 },
      ),
    ).resolves.toMatchObject({
      total: 0,
    })
    await expect(handlers.get('applications:get')?.({}, 'application-1')).resolves.toBeNull()
    const createInput: CreateApplicationInput = {
      companyName: 'Delta Labs',
      roleTitle: 'Software Engineering Intern',
      sourceName: 'LinkedIn',
      roleKind: 'internship',
      country: 'US',
      workMode: 'remote',
      status: 'queued',
      primaryLink: {
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.com/delta',
      },
    }
    await expect(handlers.get('applications:create')?.({}, createInput)).resolves.toMatchObject({
      id: 'application-1',
    })
    await expect(
      handlers.get('applications:update')?.(
        {},
        { applicationId: 'application-1', roleTitle: 'Backend Intern' },
      ),
    ).resolves.toMatchObject({ id: 'application-1' })
    await expect(
      handlers.get('applications:update-status')?.(
        {},
        {
          applicationId: 'application-1',
          status: 'submitted',
          notes: 'Submitted manually.',
        },
      ),
    ).resolves.toMatchObject({ id: 'application-1' })
    await expect(
      handlers.get('applications:archive')?.(
        {},
        { applicationId: 'application-1', note: 'Duplicate row.' },
      ),
    ).resolves.toBeUndefined()
    await expect(
      handlers.get('applications:workflow:update')?.(
        {},
        { applicationId: 'application-1', manualReviewKind: 'overridable' },
      ),
    ).resolves.toMatchObject({ id: 'application-1' })
    await expect(
      handlers.get('applications:notes:append')?.(
        {},
        { applicationId: 'application-1', message: 'Human note.' },
      ),
    ).resolves.toMatchObject({ id: 'application-1' })
    await expect(
      handlers.get('applications:links:create')?.(
        {},
        {
          applicationId: 'application-1',
          kind: 'official',
          label: 'official',
          url: 'https://jobs.example.com/delta',
          isPrimary: true,
        },
      ),
    ).resolves.toMatchObject({ id: 'link-1' })
    await expect(
      handlers.get('applications:links:update')?.(
        {},
        {
          applicationId: 'application-1',
          linkId: 'link-1',
          label: 'source',
        },
      ),
    ).resolves.toMatchObject({ id: 'link-1' })

    expect(queries).toEqual([query])
    expect(attemptQueries).toEqual([{ applicationId: 'application-1', limit: 25 }])
    expect(linkQueries).toEqual([{ applicationId: 'application-1', limit: 25 }])
    expect(eventQueries).toEqual([{ applicationId: 'application-1', offset: 5 }])
    expect(getIds).toEqual(['application-1'])
    expect(createInputs).toEqual([createInput])
    expect(updateInputs).toEqual([{ applicationId: 'application-1', roleTitle: 'Backend Intern' }])
    expect(statusInputs).toEqual([
      {
        applicationId: 'application-1',
        status: 'submitted',
        notes: 'Submitted manually.',
      },
    ])
    expect(archiveInputs).toEqual([{ applicationId: 'application-1', note: 'Duplicate row.' }])
    expect(workflowInputs).toEqual([
      { applicationId: 'application-1', manualReviewKind: 'overridable' },
    ])
    expect(noteInputs).toEqual([{ applicationId: 'application-1', message: 'Human note.' }])
    expect(linkCreateInputs).toEqual([
      {
        applicationId: 'application-1',
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.com/delta',
        isPrimary: true,
      },
    ])
    expect(linkUpdateInputs).toEqual([
      {
        applicationId: 'application-1',
        linkId: 'link-1',
        label: 'source',
      },
    ])
  })
})
