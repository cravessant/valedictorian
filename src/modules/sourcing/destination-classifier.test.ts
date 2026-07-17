import { describe, expect, it } from 'vitest'
import {
  classifyDeterministicDestination,
  classifyExplicitIntermediaryAlias,
  classifyProviderUrlDestination,
} from './destination-classifier'

const additionalReservedSegments = [
  'about', 'apply', 'browse', 'companies', 'job', 'job-search', 'lists', 'login',
  'openings', 'opportunities', 'results',
]
const reservedSlotCases = additionalReservedSegments.flatMap((segment) => [
  `https://boards.greenhouse.io/acme/jobs/${segment}`,
  `https://jobs.lever.co/acme/${segment}`,
  `https://jobs.ashbyhq.com/acme/${segment}`,
  `https://jobs.smartrecruiters.com/Acme/${segment}`,
  `https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/${segment}/123`,
])
const encodedReservedJobCases = ['%70rofile', '%2570rofile'].flatMap((segment) => [
  `https://boards.greenhouse.io/acme/jobs/${segment}`,
  `https://jobs.lever.co/acme/${segment}`,
  `https://jobs.ashbyhq.com/acme/${segment}`,
  `https://jobs.smartrecruiters.com/Acme/${segment}`,
  `https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/${segment}/123`,
])
const encodedLegitimateCases = [
  'https://boards.greenhouse.io/acme/jobs/profile%2Dengineer',
  'https://jobs.lever.co/acme/profile%2Dengineer',
  'https://jobs.ashbyhq.com/acme/profile%2Dengineer',
  'https://jobs.smartrecruiters.com/Acme/profile%2Dengineer',
  'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/profile%2Dengineer/123',
]
const recognizedProviderJobUrls = [
  'https://www.linkedin.com/jobs/view/123456',
  'https://boards.greenhouse.io/acme/jobs/123',
  'https://jobs.lever.co/acme/abc-123',
  'https://jobs.ashbyhq.com/acme/abc-123',
  'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
  'https://jobs.smartrecruiters.com/Acme/123-engineer',
]
const unsafeAuthorityCases = recognizedProviderJobUrls.flatMap((url) => [
  url.replace('https://', 'https://user:plain-secret@'),
  url.replace('https://', 'http://'),
  url.replace(/^(https:\/\/[^/]+)/, '$1:8443'),
])

describe('deterministic destination taxonomy', () => {
  it('keeps provider query parameters exact while ordinary classification canonicalizes tracking parameters', () => {
    const exact = 'https://jobs.lever.co/acme/job-1?utm_source=jobright&ref=a%2Bb'
    expect(classifyDeterministicDestination(exact)).toEqual({
      class: 'employer_or_ats', intermediaryUrl: null, url: 'https://jobs.lever.co/acme/job-1',
    })
    expect(classifyProviderUrlDestination(exact)).toEqual({
      class: 'employer_or_ats', intermediaryUrl: null, url: exact,
    })
  })

  it('accepts an exact provider employer URL without loosening global or intermediary classification', () => {
    const exact = 'https://careers.example.com/openings/software-engineer?source=jobright&ref=a%2Bb'
    expect(classifyProviderUrlDestination(exact)).toEqual({
      class: 'employer_or_ats', intermediaryUrl: null, url: exact,
    })
    expect(classifyDeterministicDestination(exact)).toBeNull()
    expect(classifyProviderUrlDestination('https://jobright.ai/jobs/info/123')).toBeNull()
    expect(classifyProviderUrlDestination('https://www.indeed.com/viewjob?jk=123')).toBeNull()
    expect(classifyProviderUrlDestination('https://www.linkedin.com/jobs/search/?keywords=engineer')).toBeNull()
  })

  it('canonicalizes an explicit job-specific Jobright intermediary alias', () => {
    expect(classifyExplicitIntermediaryAlias('https://www.jobright.ai/jobs/info/job-123?utm_source=test#apply')).toBe(
      'https://jobright.ai/jobs/info/job-123',
    )
  })

  it.each([
    'https://jobright.ai/jobs/search',
    'https://jobright.ai/companies/acme',
    'https://jobright.ai/jobs/info/profile',
    'https://linkedin.com/jobs/view/123',
    'http://jobright.ai/jobs/info/job-123',
  ])('rejects a generic or non-intermediary alias: %s', (url) => {
    expect(classifyExplicitIntermediaryAlias(url)).toBeNull()
  })

  it('rejects identity values above the persisted bound', () => {
    const oversized = 'x'.repeat(2_048)
    expect(classifyDeterministicDestination(`https://jobs.lever.co/acme/${oversized}`)).toBeNull()
    expect(classifyExplicitIntermediaryAlias(`https://jobright.ai/jobs/info/${oversized}`)).toBeNull()
  })

  it.each([
    ['https://www.linkedin.com/jobs/view/123456', 'third_party_job_posting'],
    ['https://boards.greenhouse.io/acme/jobs/123?gh_src=tracking', 'employer_or_ats'],
    ['https://jobs.lever.co/acme/abc-123', 'employer_or_ats'],
    ['https://jobs.ashbyhq.com/acme/abc-123', 'employer_or_ats'],
    ['https://jobs.ashbyhq.com/vantage/9bf2e2cb-97f0-4c72-83fa-31f67c813aa7/application', 'employer_or_ats'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123', 'employer_or_ats'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/Jobs/job/New-York/Engineer_R123', 'employer_or_ats'],
    ['https://acme.wd12.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123', 'employer_or_ats'],
    ['https://jobs.smartrecruiters.com/Acme/123-engineer', 'employer_or_ats'],
    ['https://boards.greenhouse.io/profile-engineering/jobs/profile-engineer', 'employer_or_ats'],
    ['https://jobs.lever.co/profile-engineering/profile-engineer', 'employer_or_ats'],
    ['https://jobs.ashbyhq.com/profile-engineering/profile-engineer', 'employer_or_ats'],
    ['https://jobs.smartrecruiters.com/profile-engineering/profile-engineer', 'employer_or_ats'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/profile-engineering/job/profile-engineer/123', 'employer_or_ats'],
    ['https://boards.greenhouse.io/results-engineering/jobs/results-engineer', 'employer_or_ats'],
    ['https://jobs.lever.co/results-engineering/results-engineer', 'employer_or_ats'],
    ['https://jobs.ashbyhq.com/results-engineering/results-engineer', 'employer_or_ats'],
    ['https://jobs.smartrecruiters.com/results-engineering/results-engineer', 'employer_or_ats'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/results-engineering/job/results-engineer/123', 'employer_or_ats'],
  ])('accepts a job-specific production-shaped URL: %s', (url, destinationClass) => {
    expect(classifyDeterministicDestination(url)).toMatchObject({ class: destinationClass })
  })

  it.each([
    'https://www.linkedin.com/jobs/search/?keywords=engineer',
    'https://www.linkedin.com/company/acme',
    'https://boards.greenhouse.io/acme',
    'https://boards.greenhouse.io/acme/jobs/profile',
    'https://boards.greenhouse.io/acme/jobs/careers',
    'https://boards.greenhouse.io/profile/jobs/user-123',
    'https://boards.greenhouse.io/careers/jobs/user-123',
    'https://jobs.lever.co/acme',
    'https://jobs.lever.co/acme/profile',
    'https://jobs.lever.co/acme/careers',
    'https://jobs.lever.co/profile/user-123',
    'https://jobs.lever.co/careers/user-123',
    'https://jobs.ashbyhq.com/acme',
    'https://jobs.ashbyhq.com/acme/profile',
    'https://jobs.ashbyhq.com/acme/careers',
    'https://jobs.ashbyhq.com/profile/user-123',
    'https://jobs.ashbyhq.com/careers/user-123',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/careers',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/search',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/application',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Engineer/search',
    'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/profile/123',
    'https://acme.wd1.myworkdayjobs.com/en-US/profile/job/user-123',
    'https://jobs.smartrecruiters.com/Acme',
    'https://jobs.smartrecruiters.com/Acme/profile',
    'https://jobs.smartrecruiters.com/Acme/careers',
    'https://jobs.smartrecruiters.com/profile/user-123',
    'https://jobs.smartrecruiters.com/careers/user-123',
    'https://profile.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://careers.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://jobs.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://search.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://application.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://wd1.wd2.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://wd1.acme.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://foo.acme.wd1.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://acme.wd1.foo.myworkdayjobs.com/en-US/Careers/job/New-York/Engineer_R123',
    'https://jobs.lever.co/acme/%E0%A4%A',
    'https://jobs.lever.co/acme/profile%2Fengineer',
    'https://jobs.lever.co/acme/profile%5Cengineer',
    'https://jobs.lever.co/acme/%2E',
    'https://jobs.lever.co/acme/%2E%2E',
    'https://jobs.lever.co/acme/%252E%252E',
    'https://jobs.lever.co/acme/%00',
    'https://jobs.lever.co/acme/%250A',
    ...encodedReservedJobCases,
    'https://www.linkedin.com/jobs/view/123/application',
    'https://boards.greenhouse.io/acme/jobs/123/application',
    'https://jobs.lever.co/acme/job-1/apply',
    'https://jobs.ashbyhq.com/acme/search',
    'https://jobs.ashbyhq.com/acme/job-1/search',
    'https://jobs.smartrecruiters.com/Acme/123-engineer/apply',
    'https://jobright.ai/jobs/info/123',
    'https://careers.example.com/jobs/123',
    'not a url',
  ])('rejects a generic, intermediary, arbitrary, or malformed URL: %s', (url) => {
    expect(classifyDeterministicDestination(url)).toBeNull()
  })

  it.each(reservedSlotCases)('rejects an exact reserved tenant/job control segment: %s', (url) => {
    expect(classifyDeterministicDestination(url)).toBeNull()
  })

  it.each(encodedLegitimateCases)('preserves a safely encoded legitimate job identifier: %s', (url) => {
    expect(classifyDeterministicDestination(url)).toEqual({
      class: 'employer_or_ats', intermediaryUrl: null, url,
    })
  })

  it.each(unsafeAuthorityCases)('rejects credentials, non-HTTPS, or a non-default port before provider path matching: %s', (url) => {
    expect(classifyDeterministicDestination(url)).toBeNull()
  })

  it('accepts HTTPS on the explicit default port and emits its canonical form', () => {
    expect(classifyDeterministicDestination('https://jobs.lever.co:443/acme/job-1')).toEqual({
      class: 'employer_or_ats', intermediaryUrl: null, url: 'https://jobs.lever.co/acme/job-1',
    })
  })
})
