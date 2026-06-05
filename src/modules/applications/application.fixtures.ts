import {
  applicationLinks,
  applicationScores,
  applications,
  companies,
  sources,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

const createdAt = '2026-06-04T16:00:00.000Z'

export function seedSampleApplications(database: DrizzleDatabase) {
  database
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
    .run()

  database
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
    .run()

  database
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
    .run()

  database
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
    .run()

  database
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
    .run()
}
