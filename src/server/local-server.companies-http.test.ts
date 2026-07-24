import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHttpValedictorianClient,
  ValedictorianHttpError,
} from '@sparxie/sdk'
import { createTestLocalValedictorianClient } from '../runtime/local-valedictorian-client.test-harness'
import { createLocalServerHttpTestFixture } from './local-server.http-test-harness'

const WORKSPACE = 'companies-http-workspace'
const ACTOR = { id: 'http-company-user', type: 'user' as const }

describe.sequential('Workspace Company HTTP surface', () => {
  const fixture = createLocalServerHttpTestFixture()

  beforeEach(() => fixture.setup())
  afterEach(() => fixture.teardown())

  async function setup() {
    const local = await createTestLocalValedictorianClient({ workspaceId: WORKSPACE })
    const server = await fixture.start({ client: local })
    const client = createHttpValedictorianClient({
      baseUrl: server.url,
    }).forWorkspace(WORKSPACE)
    return { client, server }
  }

  function context(idempotencyKey: string) {
    return {
      workspaceId: WORKSPACE,
      actor: ACTOR,
      rationale: 'Maintain Company data through HTTP.',
      idempotencyKey,
    }
  }

  it('round-trips the current Company contract without alternate routes', async () => {
    const { client } = await setup()
    const created = await client.companies.create({
      ...context('http-company-create'),
      displayName: 'HTTP Company',
      websiteUrl: 'https://http-company.example/jobs',
      notes: 'Created through the typed client.',
    })
    expect(created).toMatchObject({
      status: 'created',
      company: { displayName: 'HTTP Company', revision: 1 },
    })
    await expect(client.companies.create({
      ...context('http-company-create'),
      displayName: 'Different HTTP Company',
      websiteUrl: null,
      notes: null,
    })).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<ValedictorianHttpError>)
    if (created.status !== 'created') throw new Error('expected created Company')
    const companyId = created.company.id

    expect(await client.companies.get(companyId)).toMatchObject({
      lookup: { requested: { id: companyId }, canonical: { id: companyId } },
      assignedJobCount: 0,
    })
    expect(await client.companies.lookup(companyId)).toMatchObject({
      requested: { id: companyId },
      canonical: { id: companyId },
      redirectPath: [],
    })
    expect(await client.companies.search({
      query: 'http company',
      scope: 'active',
      limit: 20,
    })).toMatchObject({ items: [{ companyId }], truncated: false })
    expect(await client.companies.previewMatches({
      displayName: 'HTTP Company',
      websiteUrl: 'https://http-company.example',
      limit: 20,
    })).toMatchObject({ items: [{ companyId, score: 1 }] })
    expect(await client.companies.directory.list({
      filter: 'all',
      sort: 'display_name_asc',
      limit: 50,
    })).toMatchObject({
      items: [{ companyId, websiteHost: 'http-company.example' }],
      totalCount: 1,
    })

    const updated = await client.companies.update({
      ...context('http-company-update'),
      companyId,
      expectedCompanyRevision: 1,
      displayName: 'HTTP Company Labs',
    })
    expect(updated).toMatchObject({ status: 'updated', company: { revision: 2 } })
    const aliasAdded = await client.companies.aliases.add({
      ...context('http-alias-add'),
      companyId,
      expectedCompanyRevision: 2,
      value: 'HTTP Co.',
    })
    if (aliasAdded.status !== 'updated') throw new Error('expected alias update')
    const alias = aliasAdded.company.aliases[0]
    if (!alias) throw new Error('expected alias')
    expect(await client.companies.aliases.update({
      ...context('http-alias-update'),
      companyId,
      expectedCompanyRevision: 3,
      aliasId: alias.id,
      value: 'HTTP Incorporated',
    })).toMatchObject({
      status: 'updated',
      company: { revision: 4, aliases: [{ value: 'HTTP Incorporated' }] },
    })
    expect(await client.companies.notes.update({
      ...context('http-notes-update'),
      companyId,
      expectedCompanyRevision: 4,
      notes: 'Notes stay independently editable.',
    })).toMatchObject({ status: 'updated', company: { revision: 5 } })
    expect(await client.companies.aliases.remove({
      ...context('http-alias-remove'),
      companyId,
      expectedCompanyRevision: 5,
      aliasId: alias.id,
    })).toMatchObject({
      status: 'updated',
      company: { revision: 6, aliases: [] },
    })
    expect(await client.companies.archive({
      ...context('http-archive'),
      companyId,
      expectedCompanyRevision: 6,
    })).toMatchObject({
      status: 'archived',
      company: { revision: 7, status: 'archived' },
    })
    expect(await client.companies.restore({
      ...context('http-restore'),
      companyId,
      expectedCompanyRevision: 7,
    })).toMatchObject({
      status: 'restored',
      company: { revision: 8, status: 'active' },
    })
    expect(await client.companies.assignedJobs.list(companyId, {
      filter: 'all',
      sort: 'role_title_asc',
      limit: 50,
    })).toMatchObject({ items: [], totalCount: 0 })
    expect((await client.companies.history.list(companyId, {
      filter: 'all',
      sort: 'occurred_desc',
      limit: 50,
    })).items).toHaveLength(8)
  })

  it('keeps Company routes workspace-scoped and maps missing detail to 404', async () => {
    const { client, server } = await setup()
    await expect(client.companies.get(
      '018f0000-0000-7000-8000-000000000099' as never,
    )).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<ValedictorianHttpError>)

    const unscoped = await fetch(`${server.url}/v1/companies`)
    expect(unscoped.status).toBe(404)
  })

  it('serves only the canonical duplicate review routes and does not expose merge', async () => {
    const { client, server } = await setup()
    for (const [key, displayName] of [
      ['left', 'Canonical Duplicate Company'],
      ['right', 'Canonical Duplicate Co'],
    ] as const) {
      expect(await client.companies.create({
        ...context(`http-duplicate-${key}`),
        displayName,
        websiteUrl: 'https://canonical-duplicate.example',
        notes: null,
      })).toMatchObject({ status: 'created' })
    }
    const candidate = (await client.companies.duplicates.list({
      filter: 'open',
      sort: 'score_desc',
      limit: 10,
    })).items[0]
    if (!candidate) throw new Error('expected HTTP duplicate candidate')
    expect(await client.companies.duplicates.get(candidate.candidateId)).toEqual(candidate)
    expect(await client.companies.duplicates.markDistinct({
      ...context('http-mark-distinct'),
      candidateId: candidate.candidateId,
      expectedCandidateRevision: candidate.candidateRevision,
      leftCompanyId: candidate.left.companyId,
      expectedLeftCompanyRevision: candidate.left.revision,
      rightCompanyId: candidate.right.companyId,
      expectedRightCompanyRevision: candidate.right.revision,
    })).toMatchObject({
      status: 'marked_distinct',
      candidate: { status: 'marked_distinct' },
    })

    const merge = await fetch(
      `${server.url}/v1/workspaces/${WORKSPACE}/companies/merge`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    expect(merge.status).toBe(404)
  })
})
