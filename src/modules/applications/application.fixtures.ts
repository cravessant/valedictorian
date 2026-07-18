import { eq } from 'drizzle-orm'
import {
  applicationLinks,
  applicationScores,
  applications,
  companies,
  opportunities,
  sources,
  workflowRuns,
  workflowRunSteps,
} from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

const createdAt = '2026-06-04T16:00:00.000Z'
const referenceSeedCreatedAt = '2026-06-05T00:00:00.000Z'
const seedApplicationStatuses = [
  'queued',
  'in_progress',
  'ready_for_review',
  'needs_user_info',
  'submitted',
  'already_applied',
  'manual_captcha',
  'security_gate',
  'login_needed',
  'platform_error',
  'closed',
  'not_fit',
  'not_pursued',
] as const

type SeedApplicationStatus = (typeof seedApplicationStatuses)[number]
type SeedWorkMode = 'remote' | 'onsite' | 'hybrid' | 'unclear'

interface ReferenceTrackerApplication {
  id: string
  companyId: string
  companyName: string
  sourceId: string
  sourceName: string
  roleTitle: string
  roleKind: string
  term: string | null
  city: string | null
  region: string | null
  country: string
  workMode: SeedWorkMode
  locationRaw: string | null
  status: SeedApplicationStatus
  hasApplied: boolean
  currentPriorityScore: number | null
  currentPriorityBand: string | null
  notes: string | null
  linkId: string
  linkKind: string
  linkLabel: string
  linkUrl: string
  externalId: string | null
  createdAt: string
  updatedAt: string
}

export async function seedSampleApplications(database: PgliteDatabase) {
  await database
    .insert(companies)
    .values([
      {
        id: 'company-astranis',
        name: 'Astranis Space Technologies',
        normalizedName: 'astranis space technologies',
        websiteUrl: 'https://jobs.example.test/remediated/3b584e866326a6d1',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      {
        id: 'company-versant',
        name: 'Versant Media',
        normalizedName: 'versant media',
        websiteUrl: 'https://jobs.example.test/remediated/3d3842a361412418',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      {
        id: 'company-jobster',
        name: 'Jobster',
        normalizedName: 'jobster',
        websiteUrl: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
    ])
    .onConflictDoNothing()

  await database
    .insert(sources)
    .values([
      {
        id: 'source-linkedin',
        name: 'LinkedIn',
        accountHint: 'Profile 2 / candidate+f47504101f5f@example.test',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      {
        id: 'source-jobright',
        name: 'Jobright',
        accountHint: 'Profile 2 / candidate+f47504101f5f@example.test',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
    ])
    .onConflictDoNothing()

  await database
    .insert(applications)
    .values([
      {
        id: 'application-astranis-backend',
        companyId: 'company-astranis',
        sourceId: 'source-linkedin',
        roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
        roleKind: 'internship',
        term: 'Fall 2026 internship',
        city: 'San Francisco',
        region: 'CA',
        country: 'US',
        workMode: 'onsite',
        locationRaw: 'San Francisco, CA / Onsite',
        status: 'needs_user_info',
        hasApplied: false,
        currentPriorityScore: 8,
        currentPriorityBand: 'high',
        currentResumeVariant: 'bachelor_dec_2027',
        notes: 'Needs Fall 2026 availability answers before submission.',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      {
        id: 'application-versant-platform',
        companyId: 'company-versant',
        sourceId: 'source-linkedin',
        roleTitle: 'Academic Year Internships: Platform Engineering',
        roleKind: 'internship',
        term: 'Sep. 14 2026-Apr. 16 2027',
        city: 'Universal City',
        region: 'CA',
        country: 'US',
        workMode: 'remote',
        locationRaw: 'Universal City, CA / Remote',
        status: 'queued',
        hasApplied: false,
        currentPriorityScore: 6,
        currentPriorityBand: 'medium',
        currentResumeVariant: 'bachelor_dec_2027',
        notes: 'Remote paid platform-engineering sample row.',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      {
        id: 'application-jobster-analytics',
        companyId: 'company-jobster',
        sourceId: 'source-jobright',
        roleTitle: 'Business Analytics Intern - Studentjob.ch',
        roleKind: 'internship',
        term: 'Internship',
        city: 'Bellevue',
        region: 'WA',
        country: 'US',
        workMode: 'onsite',
        locationRaw: 'Bellevue, WA / Onsite',
        status: 'not_fit',
        hasApplied: false,
        currentPriorityScore: 3,
        currentPriorityBand: 'skip',
        currentResumeVariant: null,
        notes: 'Below cutoff because the role is analytics rather than target SWE.',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
    ])
    .onConflictDoNothing()

  await database
    .insert(applicationLinks)
    .values([
      {
        id: 'link-astranis-official',
        applicationId: 'application-astranis-backend',
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
        externalId: '4681183006',
        isPrimary: true,
        discoveredAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      {
        id: 'link-versant-official',
        applicationId: 'application-versant-platform',
        kind: 'official',
        label: 'official',
        url: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
        externalId: '744000126408107',
        isPrimary: true,
        discoveredAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      {
        id: 'link-jobster-source',
        applicationId: 'application-jobster-analytics',
        kind: 'source',
        label: 'source',
        url: 'https://jobs.example.test/remediated/8f573a16eeabe767',
        externalId: '6a2169a6338c01230511dfd7',
        isPrimary: true,
        discoveredAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
    ])
    .onConflictDoNothing()

  await database
    .insert(applicationScores)
    .values([
      {
        id: 'score-astranis-backend',
        applicationId: 'application-astranis-backend',
        score: 8,
        band: 'high',
        roleRelevance: 4,
        careerSignal: 3,
        cityWorkMode: 1,
        compensationLogistics: 0,
        penaltiesJson: '[]',
        rationale: 'Strong backend software internship at a respected space technology company.',
        rubricVersion: '2026-06-04',
        createdAt,
      },
      {
        id: 'score-versant-platform',
        applicationId: 'application-versant-platform',
        score: 6,
        band: 'medium',
        roleRelevance: 3,
        careerSignal: 1,
        cityWorkMode: 2,
        compensationLogistics: 1,
        penaltiesJson: '[-1]',
        rationale: 'Paid remote platform engineering role with academic-year logistics.',
        rubricVersion: '2026-06-04',
        createdAt,
      },
      {
        id: 'score-jobster-analytics',
        applicationId: 'application-jobster-analytics',
        score: 3,
        band: 'skip',
        roleRelevance: 1,
        careerSignal: 0,
        cityWorkMode: 1,
        compensationLogistics: 1,
        penaltiesJson: '[-2]',
        rationale: 'Business analytics scope is below the current SWE automation cutoff.',
        rubricVersion: '2026-06-04',
        createdAt,
      },
    ])
    .onConflictDoNothing()

  await seedSampleApplicationAttempts(database)
}

export async function seedReferenceTrackerApplications(
  database: PgliteDatabase,
  trackerMarkdown: string,
) {
  const trackerApplications = parseReferenceTrackerApplications(trackerMarkdown)

  if (trackerApplications.length === 0) {
    await seedSampleApplications(database)
    await seedSampleSourcingFindings(database)
    return
  }

  const companiesById = new Map(
    trackerApplications.map((application) => [
      application.companyId,
      {
        id: application.companyId,
        name: application.companyName,
        normalizedName: normalizeName(application.companyName),
        websiteUrl: null,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        deletedAt: null,
      },
    ]),
  )
  const sourcesById = new Map(
    trackerApplications.map((application) => [
      application.sourceId,
      {
        id: application.sourceId,
        name: application.sourceName,
        accountHint: application.sourceName === 'Reference Tracker' ? null : 'Imported from Reference/TRACKER.md',
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        deletedAt: null,
      },
    ]),
  )

  await database.insert(companies).values([...companiesById.values()])
  await database.insert(sources).values([...sourcesById.values()])
  await database
    .insert(applications)
    .values(
      trackerApplications.map((application) => ({
        id: application.id,
        companyId: application.companyId,
        sourceId: application.sourceId,
        roleTitle: application.roleTitle,
        roleKind: application.roleKind,
        term: application.term,
        city: application.city,
        region: application.region,
        country: application.country,
        workMode: application.workMode,
        locationRaw: application.locationRaw,
        status: application.status,
        hasApplied: application.hasApplied,
        currentPriorityScore: application.currentPriorityScore,
        currentPriorityBand: application.currentPriorityBand,
        currentResumeVariant: null,
        notes: application.notes,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        deletedAt: null,
      })),
    )
  await database
    .insert(applicationLinks)
    .values(
      trackerApplications.map((application) => ({
        id: application.linkId,
        applicationId: application.id,
        kind: application.linkKind,
        label: application.linkLabel,
        url: application.linkUrl,
        externalId: application.externalId,
        isPrimary: true,
        discoveredAt: application.createdAt,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        deletedAt: null,
      })),
    )

  const scoredApplications = trackerApplications.filter(
    (application) => application.currentPriorityScore !== null,
  )
  if (scoredApplications.length > 0) {
    await database
      .insert(applicationScores)
      .values(
        scoredApplications.map((application) => ({
          id: `score-${application.id}`,
          applicationId: application.id,
          score: application.currentPriorityScore ?? 0,
          band: application.currentPriorityBand ?? scoreBand(application.currentPriorityScore),
          roleRelevance: 0,
          careerSignal: 0,
          cityWorkMode: 0,
          compensationLogistics: 0,
          penaltiesJson: '[]',
          rationale: application.notes ?? 'Imported from Reference/TRACKER.md.',
          rubricVersion: 'reference-tracker-import',
          createdAt: application.createdAt,
        })),
      )
  }

  await seedSampleApplicationAttempts(database)
  await seedSampleSourcingFindings(database)
}

export async function seedSampleSourcingFindings(database: PgliteDatabase) {
  if ((await database.select().from(opportunities).limit(1))[0]) {
    return
  }

  await ensureSeedSource(database)

  const runId = 'workflow-run-sourcing-sample-linkedin'
  const [existingRun] = await database.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)

  if (!existingRun) {
    await database
      .insert(workflowRuns)
      .values({
        id: runId,
        runType: 'sourcing',
        status: 'completed',
        actorType: 'agent',
        actorName: 'codex',
        sourceId: 'source-linkedin',
        subjectApplicationId: null,
        startedAt: '2026-06-05T14:00:00.000Z',
        completedAt: '2026-06-05T14:24:00.000Z',
        coverageStartedAt: '2026-06-05T14:00:00.000Z',
        coverageEndedAt: '2026-06-05T14:24:00.000Z',
        timezone: 'America/Denver',
        inputJson: JSON.stringify({
          query: 'software engineering intern remote backend',
          source: 'LinkedIn',
        }),
        summary: 'Seeded sourcing run for UI review.',
        outcome: 'full_coverage',
        blocker: null,
        metadataJson: '{}',
        createdAt: referenceSeedCreatedAt,
        updatedAt: referenceSeedCreatedAt,
        deletedAt: null,
      })

    await database
      .insert(workflowRunSteps)
      .values([
        {
          id: 'workflow-run-step-sourcing-sample-started',
          workflowRunId: runId,
          sequence: 1,
          type: 'run_started',
          message: 'Started seeded LinkedIn sourcing run.',
          payloadJson: '{}',
          actor: 'agent:codex',
          createdAt: '2026-06-05T14:00:00.000Z',
        },
        {
          id: 'workflow-run-step-sourcing-sample-frontier',
          workflowRunId: runId,
          sequence: 2,
          type: 'frontier_reached',
          message: 'Reached remote/backend internship search frontier.',
          payloadJson: '{}',
          actor: 'agent:codex',
          createdAt: '2026-06-05T14:12:00.000Z',
        },
        {
          id: 'workflow-run-step-sourcing-sample-completed',
          workflowRunId: runId,
          sequence: 3,
          type: 'run_completed',
          message: 'Completed seeded sourcing run.',
          payloadJson: '{}',
          actor: 'agent:codex',
          createdAt: '2026-06-05T14:24:00.000Z',
        },
      ])
  }

  await database
    .insert(opportunities)
    .values([
      {
        id: 'sourcing-finding-delta-labs',
        workflowRunId: runId,
        sourceId: 'source-linkedin',
        companyName: 'Delta Labs',
        roleTitle: 'Software Engineering Intern',
        roleKind: 'internship',
        term: 'Fall 2026',
        city: null,
        region: null,
        country: 'US',
        workMode: 'remote',
        locationRaw: 'Remote',
        officialUrl: 'https://jobs.example.com/delta/software-engineering-intern',
        sourceUrl: 'https://jobs.example.test/remediated/800beadad8d8fe56',
        postedAge: '2d',
        priorityScore: 7,
        priorityBand: 'high',
        fitNotes: 'Good backend internship fit; ready for review and promotion.',
        duplicateNotes: null,
        blocker: null,
        mergeStatus: 'new',
        applicationId: null,
        mergeNotes: null,
        discoveredAt: '2026-06-05T14:08:00.000Z',
        createdAt: referenceSeedCreatedAt,
        updatedAt: referenceSeedCreatedAt,
        deletedAt: null,
      },
      {
        id: 'sourcing-finding-northstar-robotics',
        workflowRunId: runId,
        sourceId: 'source-linkedin',
        companyName: 'Northstar Robotics',
        roleTitle: 'Automation Analyst Intern',
        roleKind: 'internship',
        term: 'Summer 2026',
        city: 'Denver',
        region: 'CO',
        country: 'US',
        workMode: 'hybrid',
        locationRaw: 'Denver, CO / Hybrid',
        officialUrl: 'https://jobs.example.com/northstar/automation-analyst-intern',
        sourceUrl: 'https://jobs.example.test/remediated/483e57cd96b4f928',
        postedAge: '5d',
        priorityScore: 4,
        priorityBand: 'skip',
        fitNotes: 'Adjacent automation role, but not enough SWE signal.',
        duplicateNotes: null,
        blocker: null,
        mergeStatus: 'below_cutoff',
        applicationId: null,
        mergeNotes: 'Below current sourcing cutoff.',
        discoveredAt: '2026-06-05T14:14:00.000Z',
        createdAt: referenceSeedCreatedAt,
        updatedAt: referenceSeedCreatedAt,
        deletedAt: null,
      },
      {
        id: 'sourcing-finding-summit-cloud',
        workflowRunId: runId,
        sourceId: 'source-linkedin',
        companyName: 'Summit Cloud',
        roleTitle: 'Platform Engineering Intern',
        roleKind: 'internship',
        term: 'Academic Year 2026',
        city: 'Boulder',
        region: 'CO',
        country: 'US',
        workMode: 'onsite',
        locationRaw: 'Boulder, CO / Onsite',
        officialUrl: null,
        sourceUrl: 'https://jobs.example.test/remediated/9e6343f97fe98207',
        postedAge: '1w',
        priorityScore: 6,
        priorityBand: 'medium',
        fitNotes: 'Solid platform signal, but official posting is missing.',
        duplicateNotes: null,
        blocker: 'Official application URL not found.',
        mergeStatus: 'blocked',
        applicationId: null,
        mergeNotes: 'Needs official URL before promotion.',
        discoveredAt: '2026-06-05T14:19:00.000Z',
        createdAt: referenceSeedCreatedAt,
        updatedAt: referenceSeedCreatedAt,
        deletedAt: null,
      },
    ])
}

export async function seedSampleApplicationAttempts(database: PgliteDatabase) {
  const applicationId = await selectAstranisAttemptSeedApplicationId(database)

  if (!applicationId) {
    return
  }

  const runId = 'workflow-run-application-attempt-astranis-verification'
  const [existingRun] = await database.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)

  if (existingRun) {
    return
  }

  await database
    .insert(workflowRuns)
    .values({
      id: runId,
      runType: 'application_attempt',
      status: 'completed',
      actorType: 'agent',
      actorName: 'codex',
      sourceId: null,
      subjectApplicationId: applicationId,
      startedAt: '2026-06-04T16:00:00.000Z',
      completedAt: '2026-06-04T16:05:00.000Z',
      coverageStartedAt: null,
      coverageEndedAt: null,
      timezone: 'America/Denver',
      inputJson: JSON.stringify({
        entryUrl: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
        applicationId,
      }),
      summary: 'Needs exact Fall 2026 availability answers.',
      outcome: 'needs_user_info',
      blocker: null,
      metadataJson: JSON.stringify({
        entryUrl: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
        resumeVariant: 'bachelor_dec_2027',
        resumeArtifactPath: 'tailored_resumes/astranis/backend-fall-2026.pdf',
        stopReason: 'missing_user_info',
        confirmationUrl: null,
        confirmationText: null,
      }),
      createdAt,
      updatedAt: '2026-06-04T16:05:00.000Z',
      deletedAt: null,
    })

  await database
    .insert(workflowRunSteps)
    .values([
      {
        id: 'workflow-run-step-astranis-attempt-started',
        workflowRunId: runId,
        sequence: 1,
        type: 'attempt_started',
        message: 'Started Astranis Greenhouse application.',
        payloadJson: JSON.stringify({
          entryUrl: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
        }),
        actor: 'agent:codex',
        createdAt: '2026-06-04T16:00:00.000Z',
      },
      {
        id: 'workflow-run-step-astranis-resume-uploaded',
        workflowRunId: runId,
        sequence: 2,
        type: 'resume_uploaded',
        message: 'Uploaded tailored resume.',
        payloadJson: JSON.stringify({
          resumeVariant: 'bachelor_dec_2027',
          resumeArtifactPath: 'tailored_resumes/astranis/backend-fall-2026.pdf',
        }),
        actor: 'agent:codex',
        createdAt: '2026-06-04T16:02:00.000Z',
      },
      {
        id: 'workflow-run-step-astranis-verification-receipt',
        workflowRunId: runId,
        sequence: 3,
        type: 'verification_receipt',
        message: 'Final review failed because Fall availability answers are still missing.',
        payloadJson: JSON.stringify({
          version: 1,
          scope: 'final_review',
          status: 'failed',
          verified: ['resume_attachment', 'contact_info', 'education', 'work_authorization'],
          unresolved: [
            'Fall 2026 exact start date',
            'Fall 2026 exact end date',
            'Astranis onsite 5 days/week availability',
          ],
          evidence:
            'Application was reviewed up to the submit boundary; availability answers were still missing.',
        }),
        actor: 'agent:codex',
        createdAt: '2026-06-04T16:04:00.000Z',
      },
      {
        id: 'workflow-run-step-astranis-attempt-completed',
        workflowRunId: runId,
        sequence: 4,
        type: 'attempt_completed',
        message: 'Stopped before submission to request Fall availability details.',
        payloadJson: JSON.stringify({
          outcome: 'needs_user_info',
          missingUserInfo:
            'Fall 2026 start date, end date, and onsite 5 days/week availability.',
        }),
        actor: 'agent:codex',
        createdAt: '2026-06-04T16:05:00.000Z',
      },
    ])
}

async function selectAstranisAttemptSeedApplicationId(database: PgliteDatabase) {
  const application = (await database
    .select({
      id: applications.id,
      companyName: companies.name,
      roleTitle: applications.roleTitle,
      status: applications.status,
    })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id)))
    .find(
      (row) =>
        row.companyName === 'Astranis Space Technologies' &&
        row.roleTitle === 'Software Engineer- Backend Intern (Fall 2026)' &&
        row.status === 'needs_user_info',
    )

  return application?.id ?? null
}

async function ensureSeedSource(database: PgliteDatabase) {
  if ((await database.select().from(sources).where(eq(sources.id, 'source-linkedin')).limit(1))[0]) {
    return
  }

  await database
    .insert(sources)
    .values({
      id: 'source-linkedin',
      name: 'LinkedIn',
      accountHint: 'Seeded sourcing sample',
      createdAt: referenceSeedCreatedAt,
      updatedAt: referenceSeedCreatedAt,
      deletedAt: null,
    })
}

export function parseReferenceTrackerApplications(markdown: string): ReferenceTrackerApplication[] {
  const seenIds = new Map<string, number>()

  return markdown
    .split(/\r?\n/)
    .map((line) => parseTrackerLine(line, seenIds))
    .filter((application): application is ReferenceTrackerApplication => application !== null)
}

function parseTrackerLine(
  line: string,
  seenIds: Map<string, number>,
): ReferenceTrackerApplication | null {
  if (!line.startsWith('| ')) {
    return null
  }

  const cells = line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim())

  if (cells.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) {
    return null
  }

  const [date, companyName, roleTitle, locationRaw, term, linkCell, appliedCell, appliedDate] =
    cells
  const rawStatus = cells[8]
  const note = cells.slice(9).join(' | ').trim()

  if (companyName === 'CompanyName' || roleTitle === 'Role Title') {
    return null
  }

  const idBase = slugify(`${date}-${companyName}-${roleTitle}`)
  const seenCount = seenIds.get(idBase) ?? 0
  seenIds.set(idBase, seenCount + 1)
  const id = seenCount === 0 ? `application-${idBase}` : `application-${idBase}-${seenCount + 1}`
  const companyId = `company-${slugify(companyName)}`
  const sourceName = deriveSourceName(companyName, linkCell, note)
  const sourceId = `source-${slugify(sourceName)}`
  const link = parseMarkdownLink(linkCell)
  const score = parsePriorityScore(note)
  const status = normalizeTrackerStatus(rawStatus, appliedCell)
  const originalStatusNote = isApplicationStatus(rawStatus) ? null : `Original tracker status: ${rawStatus}`
  const notes = [originalStatusNote, note].filter(Boolean).join('\n')
  const location = parseLocation(locationRaw)

  return {
    id,
    companyId,
    companyName,
    sourceId,
    sourceName,
    roleTitle,
    roleKind: deriveRoleKind(term, roleTitle),
    term: term || null,
    ...location,
    status,
    hasApplied: appliedCell.toLowerCase() === 'y' || Boolean(appliedDate),
    currentPriorityScore: score,
    currentPriorityBand: score === null ? null : scoreBand(score, note),
    notes: notes || null,
    linkId: `link-${idBase}${seenCount === 0 ? '' : `-${seenCount + 1}`}`,
    linkKind: link.label === 'official' || link.label === 'link' ? 'official' : 'source',
    linkLabel: link.label,
    linkUrl: link.url,
    externalId: deriveExternalId(link.url),
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: referenceSeedCreatedAt,
  }
}

function parseMarkdownLink(value: string) {
  const match = value.match(/^\[([^\]]+)\]\((.+)\)$/)
  if (match) {
    return {
      label: match[1],
      url: match[2],
    }
  }

  return {
    label: 'source',
    url: value || 'about:blank',
  }
}

function parsePriorityScore(notes: string) {
  const match = notes.match(/Priority score:\s*(?:(?:high|medium|skip|low)\/)?(\d{1,2})/i)
  if (!match) {
    return null
  }

  const score = Number.parseInt(match[1], 10)
  return Number.isFinite(score) ? score : null
}

function scoreBand(score: number | null, notes = '') {
  const explicitBand = notes.match(/Priority score:\s*(high|medium|skip|low)\//i)?.[1]?.toLowerCase()
  if (explicitBand) {
    return explicitBand
  }

  if (score === null) {
    return 'unknown'
  }

  if (score >= 7) {
    return 'high'
  }

  if (score >= 6) {
    return 'medium'
  }

  return 'skip'
}

function normalizeTrackerStatus(rawStatus: string, appliedCell: string): SeedApplicationStatus {
  if (isApplicationStatus(rawStatus)) {
    return rawStatus
  }

  const normalized = rawStatus.trim().toLowerCase()
  if (normalized === 'rejected' || normalized === 'withdrew') {
    return 'closed'
  }

  if (normalized === 'todo') {
    return 'queued'
  }

  if (appliedCell.toLowerCase() === 'y') {
    return 'submitted'
  }

  return 'not_pursued'
}

function deriveSourceName(companyName: string, linkCell: string, notes: string) {
  const sourceMatch = notes.match(/Source:\s*(?:\[([^\]]+)\]|([A-Za-z][A-Za-z ]+))/)
  const noteSource = sourceMatch?.[1] ?? sourceMatch?.[2]
  if (noteSource) {
    return noteSource.trim()
  }

  if (['LinkedIn', 'Jobright', 'Handshake'].includes(companyName)) {
    return companyName
  }

  const url = parseMarkdownLink(linkCell).url.toLowerCase()
  if (url.includes('linkedin.com')) {
    return 'LinkedIn'
  }
  if (url.includes('jobright.ai')) {
    return 'Jobright'
  }
  if (url.includes('joinhandshake.com')) {
    return 'Handshake'
  }

  return 'Reference Tracker'
}

function deriveRoleKind(term: string, roleTitle: string) {
  const value = `${term} ${roleTitle}`.toLowerCase()
  if (value.includes('intern')) {
    return 'internship'
  }

  if (value.includes('new grad')) {
    return 'new_grad'
  }

  return 'full_time'
}

function parseLocation(locationRaw: string) {
  const lowerLocation = locationRaw.toLowerCase()
  const workMode: SeedWorkMode = lowerLocation.includes('remote')
    ? 'remote'
    : lowerLocation.includes('hybrid')
      ? 'hybrid'
      : lowerLocation.includes('onsite') || lowerLocation.includes('on-site')
        ? 'onsite'
        : 'unclear'

  const locationWithoutMode = locationRaw
    .replace(/\s*\/\s*(remote|onsite|on-site|hybrid)\s*$/i, '')
    .trim()
  const [cityPart, regionPart] = locationWithoutMode.split(',').map((part) => part.trim())

  return {
    city: cityPart && !['remote', 'united states'].includes(cityPart.toLowerCase()) ? cityPart : null,
    region: regionPart || null,
    country: 'US',
    workMode,
    locationRaw: locationRaw || null,
  }
}

function deriveExternalId(url: string) {
  const match = url.match(/(?:jobs|job|careers|view|info|gh_jid|jr_id)[=/]([A-Za-z0-9-]+)/)
  return match?.[1] ?? null
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120) || 'unknown'
  )
}

function isApplicationStatus(value: string): value is SeedApplicationStatus {
  return (seedApplicationStatuses as readonly string[]).includes(value)
}
