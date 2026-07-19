import { describe, expect, it } from 'vitest'
import type { CanonicalCandidateField, JsonValue } from 'sparxie'
import { isValidCanonicalFieldValue } from './normalization.orchestrator'

describe('canonical normalization field contract', () => {
  it.each([
    ['employmentType', 'banana'],
    ['compensation', { minimum: 100, maximum: 10, currency: 'USD', interval: 'year', raw: '$100-$10' }],
    ['postedAt', { value: 'not-a-date', precision: 'date', raw: 'not-a-date' }],
    ['companyName', ' Acme '],
    ['roleTitle', ' Intern '],
    ['providerJobId', ' provider-1 '],
    ['canonicalIdentity', { kind: 'provider_job', value: ' identity-1 ' }],
    ['sourceUrl', ' HTTPS://Example.COM:443/jobs/1#fragment '],
    ['compensation', { minimum: 10, maximum: 20, currency: 'usd', interval: 'hour', raw: '$10-$20' }],
    ['canonicalIdentity', { kind: 'destination_url', value: 'https://jobs.lever.co/acme/job-1', extra: 'undeclared' }],
    ['destinationUrl', { class: 'employer_or_ats', url: 'https://jobs.lever.co/acme/job-1', intermediaryUrl: null, extra: 'undeclared' }],
    ['location', { raw: 'New York, NY', city: null, region: null, country: null, extra: 'undeclared' }],
  ] satisfies Array<[CanonicalCandidateField, JsonValue]>)
  ('rejects out-of-contract canonical field values for %s', (field, value) => {
    expect(isValidCanonicalFieldValue(field, value)).toBe(false)
  })

  it.each([
    ['employmentType', 'internship'],
    ['compensation', { raw: '$10-$20', interval: 'hour', currency: 'USD', maximum: 20, minimum: 10 }],
  ] satisfies Array<[CanonicalCandidateField, JsonValue]>)
  ('accepts bounded canonical field values for %s', (field, value) => {
    expect(isValidCanonicalFieldValue(field, value)).toBe(true)
  })
})
