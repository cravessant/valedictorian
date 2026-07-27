import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, runCli } from './valedictorian-cli.test-helpers'

const jobId = '018f0f2e-7b16-7a01-8c8c-20c6a9d52301'
const actor = { id: 'user-1', type: 'user' }
const facts = {
  companyName: 'Delta Labs',
  roleTitle: 'Platform Engineer',
  sourceName: 'Employer site',
  roleKind: 'experienced',
  term: null,
  terms: [],
  timingMode: 'unknown',
  startDate: null,
  endDate: null,
  location: null,
  workMode: 'remote',
  employmentType: 'full_time',
  seniority: 'mid',
  compensation: null,
  postedAt: null,
  destination: { class: 'employer_or_ats', url: 'https://jobs.example.com/role' },
}
const evidenceReferences = [{ captureId: 'capture-1', captureRevision: 1, evidenceIndexes: [0] }]
const identity = {
  kind: 'ats_job',
  provider: 'greenhouse',
  account: 'delta-labs',
  value: 'role-1',
  strength: 'strong',
}
const link = { kind: 'official', label: 'Apply', url: 'https://jobs.example.com/role' }

function json(input: unknown) {
  return JSON.stringify(input)
}

const removal = [
  '--choice', 'reject_if_dependents', '--actor-id', 'user-1', '--actor-type', 'user',
  '--rationale', 'No longer needed.',
]
const restore = ['--actor-id', 'user-1', '--actor-type', 'user', '--rationale', 'Needed again.']
const factsCorrection = {
  expectedFactsRevision: 1,
  actor,
  rationale: 'Employer page verified.',
  facts,
  evidenceReferences,
}

type Case = { name: string; argv: string[]; method: string; path: string }

/** A paged read with no page input requests the first page at the contract default limit. */
const firstPage = '?limit=50'

const cases: Case[] = [
  { name: 'captures.list', argv: ['captures', 'list'], method: 'GET', path: `/captures${firstPage}` },
  { name: 'captures.get', argv: ['captures', 'get', 'capture-1'], method: 'GET', path: '/captures/capture-1' },
  {
    name: 'captures.create',
    argv: [
      'captures', 'create', '--evidence-mode', 'reported', '--adapter-id', 'cli-1',
      '--adapter-kind', 'cli', '--adapter-version', '1.0.0', '--observed-at',
      '2026-07-21T18:00:00.000Z', '--payload-json', '{"url":"https://jobs.example.com/role"}',
      '--evidence-json', '[{"kind":"url","label":"posting","value":"https://jobs.example.com/role"}]',
    ],
    method: 'POST', path: '/captures',
  },
  {
    name: 'captures.correct', argv: ['captures', 'correct', 'capture-1', '--input-json', json({
      expectedRevision: 1, actor, rationale: 'Corrected provider id.', correction: { providerRecordId: 'role-1' },
    })], method: 'PATCH', path: '/captures/capture-1',
  },
  { name: 'captures.remove', argv: ['captures', 'remove', 'capture-1', ...removal], method: 'POST', path: '/captures/capture-1/remove' },
  { name: 'captures.restore', argv: ['captures', 'restore', 'capture-1', ...restore], method: 'POST', path: '/captures/capture-1/restore' },
  { name: 'captures.history', argv: ['captures', 'history', 'capture-1'], method: 'GET', path: `/captures/capture-1/history${firstPage}` },
  {
    name: 'captures.promoteToJob', argv: ['captures', 'promote-to-job', 'capture-1', '--input-json', json({
      idempotencyKey: 'promote-capture-1', actor, captureRevision: 1, selectedFacts: facts,
      evidenceReferences, externalIdentities: [identity],
    })], method: 'POST', path: '/captures/capture-1/promote-to-job',
  },
  { name: 'jobs.list', argv: ['jobs', 'list'], method: 'GET', path: `/jobs${firstPage}` },
  { name: 'jobs.get', argv: ['jobs', 'get', jobId], method: 'GET', path: `/jobs/${jobId}` },
  {
    name: 'jobs.create', argv: ['jobs', 'create', '--input-json', json({
      idempotencyKey: 'create-job-1', actor, facts,
      availability: { state: 'open', observedAt: '2026-07-21T18:00:00.000Z' },
      evidenceReferences, externalIdentities: [identity],
    })], method: 'POST', path: '/jobs',
  },
  { name: 'jobs.correctFacts', argv: ['jobs', 'correct-facts', jobId, '--input-json', json(factsCorrection)], method: 'PATCH', path: `/jobs/${jobId}/facts` },
  {
    name: 'jobs.updateAvailability', argv: ['jobs', 'update-availability', jobId, '--input-json', json({
      expectedAvailabilityRevision: 1, actor,
      availability: { state: 'closed', observedAt: '2026-07-21T19:00:00.000Z' },
      evidenceReferences,
    })], method: 'PATCH', path: `/jobs/${jobId}/availability`,
  },
  { name: 'jobs.externalIdentities.add', argv: ['jobs', 'external-identities', 'add', jobId, '--input-json', json({ actor, identity })], method: 'POST', path: `/jobs/${jobId}/external-identities` },
  { name: 'jobs.externalIdentities.remove', argv: ['jobs', 'external-identities', 'remove', jobId, '--input-json', json({ actor, identity, rationale: 'Provider retired.' })], method: 'POST', path: `/jobs/${jobId}/external-identities/remove` },
  { name: 'jobs.remove', argv: ['jobs', 'remove', jobId, ...removal], method: 'POST', path: `/jobs/${jobId}/remove` },
  { name: 'jobs.restore', argv: ['jobs', 'restore', jobId, ...restore], method: 'POST', path: `/jobs/${jobId}/restore` },
  { name: 'jobs.history', argv: ['jobs', 'history', jobId], method: 'GET', path: `/jobs/${jobId}/history${firstPage}` },
  {
    name: 'jobs.promoteToOpportunity', argv: ['jobs', 'promote-to-opportunity', jobId, '--input-json', json({
      idempotencyKey: 'promote-job-1', actor, expectedFactsRevision: 1,
      evaluation: { fit: 'fit', rank: 1, cutoff: 'above', disposition: 'pursue' },
    })], method: 'POST', path: `/jobs/${jobId}/promote-to-opportunity`,
  },
  { name: 'opportunities.list', argv: ['opportunities', 'list'], method: 'GET', path: `/opportunities${firstPage}` },
  { name: 'opportunities.get', argv: ['opportunities', 'get', 'opportunity-1'], method: 'GET', path: '/opportunities/opportunity-1' },
  {
    name: 'opportunities.create', argv: ['opportunities', 'create', '--input-json', json({
      idempotencyKey: 'create-opportunity-1', actor, jobId, expectedJobFactsRevision: 1,
      fit: 'fit', rank: 1, cutoff: 'above', disposition: 'pursue',
    })], method: 'POST', path: '/opportunities',
  },
  { name: 'opportunities.updateEvaluation', argv: ['opportunities', 'update-evaluation', 'opportunity-1', '--input-json', json({ expectedRevision: 1, actor, fit: 'possible', rank: 2, cutoff: 'above' })], method: 'PATCH', path: '/opportunities/opportunity-1/evaluation' },
  { name: 'opportunities.updateDisposition', argv: ['opportunities', 'update-disposition', 'opportunity-1', '--input-json', json({ expectedRevision: 1, actor, disposition: 'hold', rationale: 'Waiting for dates.' })], method: 'PATCH', path: '/opportunities/opportunity-1/disposition' },
  { name: 'opportunities.remove', argv: ['opportunities', 'remove', 'opportunity-1', ...removal], method: 'POST', path: '/opportunities/opportunity-1/remove' },
  { name: 'opportunities.restore', argv: ['opportunities', 'restore', 'opportunity-1', ...restore], method: 'POST', path: '/opportunities/opportunity-1/restore' },
  { name: 'opportunities.history', argv: ['opportunities', 'history', 'opportunity-1'], method: 'GET', path: `/opportunities/opportunity-1/history${firstPage}` },
  {
    name: 'opportunities.promoteToApplication', argv: ['opportunities', 'promote-to-application', 'opportunity-1', '--input-json', json({
      idempotencyKey: 'promote-opportunity-1', actor, expectedJobId: jobId, initialLinks: [link],
    })], method: 'POST', path: '/opportunities/opportunity-1/promote-to-application',
  },
  { name: 'applications.list', argv: ['applications', 'list'], method: 'GET', path: `/applications${firstPage}` },
  { name: 'applications.get', argv: ['applications', 'get', 'application-1'], method: 'GET', path: '/applications/application-1' },
  { name: 'applications.create', argv: ['applications', 'create', '--input-json', json({ idempotencyKey: 'create-application-1', actor, opportunityId: 'opportunity-1', jobId, expectedJobFactsRevision: 1, initialLinks: [link] })], method: 'POST', path: '/applications' },
  { name: 'applications.updateStatus', argv: ['applications', 'update-status', 'application-1', '--input-json', json({ expectedRevision: 1, actor, status: 'submitted', rationale: 'Submitted.' })], method: 'PATCH', path: '/applications/application-1/status' },
  { name: 'applications.updateCompany', argv: ['applications', 'update-company', 'application-1', '--input-json', json({ expectedRevision: 1, actor, companyName: 'Delta Systems', rationale: 'Legal name.' })], method: 'PATCH', path: '/applications/application-1/company' },
  { name: 'applications.updateSource', argv: ['applications', 'update-source', 'application-1', '--input-json', json({ expectedRevision: 1, actor, sourceName: 'Referral', rationale: 'Referral confirmed.' })], method: 'PATCH', path: '/applications/application-1/source' },
  { name: 'applications.links.create', argv: ['applications', 'links', 'create', 'application-1', '--input-json', json({ expectedRevision: 1, actor, link, primary: true })], method: 'POST', path: '/applications/application-1/links' },
  { name: 'applications.links.update', argv: ['applications', 'links', 'update', 'application-1', '--input-json', json({ expectedRevision: 1, actor, linkId: 'link-1', link, primary: true })], method: 'PATCH', path: '/applications/application-1/links/link-1' },
  { name: 'applications.links.remove', argv: ['applications', 'links', 'remove', 'application-1', '--input-json', json({ expectedRevision: 1, actor, linkId: 'link-1', rationale: 'Expired.' })], method: 'POST', path: '/applications/application-1/links/link-1/remove' },
  { name: 'applications.refreshSnapshot', argv: ['applications', 'refresh-snapshot', 'application-1', '--input-json', json({ expectedRevision: 1, actor, expectedJobFactsRevision: 2, preserveCompanyEdit: true, preserveSourceEdit: true, preserveLinkEdits: true, rationale: 'Refresh verified facts.' })], method: 'POST', path: '/applications/application-1/snapshot/refresh' },
  { name: 'applications.remove', argv: ['applications', 'remove', 'application-1', ...removal], method: 'POST', path: '/applications/application-1/remove' },
  { name: 'applications.restore', argv: ['applications', 'restore', 'application-1', ...restore], method: 'POST', path: '/applications/application-1/restore' },
  { name: 'applications.history', argv: ['applications', 'history', 'application-1'], method: 'GET', path: `/applications/application-1/history${firstPage}` },
  { name: 'applications.attempts.list', argv: ['applications', 'attempts', 'list', 'application-1'], method: 'GET', path: `/applications/application-1/attempts${firstPage}` },
  { name: 'applications.events.list', argv: ['applications', 'events', 'list', 'application-1'], method: 'GET', path: `/applications/application-1/events${firstPage}` },
]

describe('lifecycle HTTP routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(cases)('$name uses the public CLI and HTTP seam', async ({ argv, method, path }) => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Authentication required.' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCli([...argv, '--workspace', 'workspace-cross-route', '--json'])

    expect(result.exitCode).toBe(3)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://valedictorian.test/v1/workspaces/workspace-cross-route${path}`,
      expect.objectContaining({ method }),
    )
  })
})

const pagedCases: { name: string; argv: string[]; path: string }[] = [
  { name: 'captures.list', argv: ['captures', 'list'], path: '/captures' },
  { name: 'captures.history', argv: ['captures', 'history', 'capture-1'], path: '/captures/capture-1/history' },
  { name: 'jobs.list', argv: ['jobs', 'list'], path: '/jobs' },
  { name: 'jobs.history', argv: ['jobs', 'history', jobId], path: `/jobs/${jobId}/history` },
  { name: 'opportunities.list', argv: ['opportunities', 'list'], path: '/opportunities' },
  { name: 'opportunities.history', argv: ['opportunities', 'history', 'opportunity-1'], path: '/opportunities/opportunity-1/history' },
  { name: 'applications.list', argv: ['applications', 'list'], path: '/applications' },
  { name: 'applications.history', argv: ['applications', 'history', 'application-1'], path: '/applications/application-1/history' },
  { name: 'applications.attempts.list', argv: ['applications', 'attempts', 'list', 'application-1'], path: '/applications/application-1/attempts' },
  { name: 'applications.events.list', argv: ['applications', 'events', 'list', 'application-1'], path: '/applications/application-1/events' },
]

describe('lifecycle page requests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(pagedCases)('$name carries one boundary cursor per page request', async ({ argv, path }) => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
    fetchMock.mockImplementation(async () =>
      jsonResponse({ message: 'Authentication required.' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const page = (input: string) =>
      runCli([...argv, '--workspace', 'workspace-paged', '--input-json', input, '--json'])
    const forward = await page('{"limit":25,"after":"page-1-end"}')
    const backward = await page('{"limit":25,"before":"page-2-start"}')
    const both = await page('{"after":"page-1-end","before":"page-2-start"}')

    const url = `https://valedictorian.test/v1/workspaces/workspace-paged${path}`
    expect([forward.exitCode, backward.exitCode]).toEqual([3, 3])
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${url}?limit=25&after=page-1-end`, expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${url}?limit=25&before=page-2-start`, expect.objectContaining({ method: 'GET' }))
    expect(both.exitCode).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
