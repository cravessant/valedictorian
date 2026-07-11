import { canonicalizeApplicationUrl, type CanonicalCandidateDestination } from 'sparxie'

export const DESTINATION_TAXONOMY_VERSION = 'deterministic-destination/v1'
const RESERVED_NAMESPACE_SEGMENTS = new Set([
  'about',
  'application',
  'apply',
  'browse',
  'companies',
  'company',
  'home',
  'job',
  'job-search',
  'jobs',
  'list',
  'lists',
  'login',
  'openings',
  'opportunities',
  'profile',
  'results',
  'search',
])
const RESERVED_PROVIDER_NAMESPACE_SEGMENTS = new Set([...RESERVED_NAMESPACE_SEGMENTS, 'careers'])
const RESERVED_JOB_SEGMENTS = new Set(RESERVED_PROVIDER_NAMESPACE_SEGMENTS)

export function classifyDeterministicDestination(value: string): CanonicalCandidateDestination | null {
  let canonical: string
  let url: URL
  try {
    canonical = canonicalizeApplicationUrl(value)
    url = new URL(canonical)
  } catch {
    return null
  }
  if (url.username || url.password || url.protocol !== 'https:' || url.port) return null

  const host = url.hostname.replace(/^www\./, '')
  const rawParts = url.pathname.split('/').filter(Boolean)
  const parts = rawParts.map(decodePathSegment)
  if (parts.some((part) => part === null)) return null
  const decodedParts = parts as string[]
  const workdayJobIndex = decodedParts.indexOf('job')
  let destinationClass: CanonicalCandidateDestination['class'] | null = null

  if (host === 'linkedin.com' && decodedParts[0] === 'jobs' && decodedParts[1] === 'view' && decodedParts.length === 3 && /\d/.test(decodedParts[2])) {
    destinationClass = 'third_party_job_posting'
  } else if (
    (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') &&
    decodedParts.length === 3 && decodedParts[1] === 'jobs' && isProviderNamespaceSegment(decodedParts[0]) && isJobSegment(decodedParts[2])
  ) {
    destinationClass = 'employer_or_ats'
  } else if (host === 'jobs.lever.co' && decodedParts.length === 2 && isProviderNamespaceSegment(decodedParts[0]) && isJobSegment(decodedParts[1])) {
    destinationClass = 'employer_or_ats'
  } else if (host === 'jobs.ashbyhq.com' && isProviderNamespaceSegment(decodedParts[0]) && isJobSegment(decodedParts[1]) && (decodedParts.length === 2 || (decodedParts.length === 3 && decodedParts[2] === 'application'))) {
    destinationClass = 'employer_or_ats'
  } else if (hasValidWorkdayHost(host) && workdayJobIndex >= 0 && workdayJobIndex < decodedParts.length - 1 && decodedParts.every((part, index) => index === workdayJobIndex || (index < workdayJobIndex ? isWorkdaySiteSegment(part) : isJobSegment(part)))) {
    destinationClass = 'employer_or_ats'
  } else if (host === 'jobs.smartrecruiters.com' && decodedParts.length === 2 && isProviderNamespaceSegment(decodedParts[0]) && isJobSegment(decodedParts[1])) {
    destinationClass = 'employer_or_ats'
  }

  return destinationClass ? { class: destinationClass, url: canonical, intermediaryUrl: null } : null
}

function isWorkdaySiteSegment(value: string | undefined) {
  if (!value) return false
  const normalized = value.toLowerCase()
  return normalized === 'careers' || normalized === 'jobs' || !RESERVED_NAMESPACE_SEGMENTS.has(normalized)
}

function isProviderNamespaceSegment(value: string | undefined) {
  return Boolean(value && !RESERVED_PROVIDER_NAMESPACE_SEGMENTS.has(value.toLowerCase()))
}

function isJobSegment(value: string | undefined) {
  return Boolean(value && !RESERVED_JOB_SEGMENTS.has(value.toLowerCase()))
}

function hasValidWorkdayHost(host: string) {
  const suffix = '.myworkdayjobs.com'
  if (!host.endsWith(suffix)) return false
  const labels = host.slice(0, -suffix.length).split('.')
  return labels.length === 2 &&
    !/^wd\d+$/.test(labels[0]) &&
    isProviderNamespaceSegment(labels[0]) &&
    /^wd\d+$/.test(labels[1])
}

function decodePathSegment(value: string): string | null {
  let decoded = value
  for (let depth = 0; depth < 5; depth += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (next.includes('/') || next.includes('\\') || next === '.' || next === '..' || hasAsciiControlCharacter(next)) return null
    if (next === decoded) return next
    decoded = next
  }
  return null
}

function hasAsciiControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 31 || codeUnit === 127) return true
  }
  return false
}
