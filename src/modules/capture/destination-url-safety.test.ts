import { describe, expect, it } from 'vitest'
import {
  destinationUrlMaximumLength,
  validateDestinationUrl,
  validateResolverMethod,
} from './destination-url-safety'

describe('destination URL safety', () => {
  it('accepts public HTTPS URLs and retains benign query bytes exactly', () => {
    const url = 'https://careers.acme.com/jobs/123?utm_source=job-board&ref=Capture%20List'

    expect(validateDestinationUrl(url)).toEqual({ ok: true, url })
  })

  it.each([
    ['empty', ''],
    ['surrounding whitespace', ' https://careers.acme.com/jobs/123'],
    ['malformed', 'https://'],
    ['HTTP', 'http://careers.acme.com/jobs/123'],
    ['credentials', 'https://operator:password@careers.acme.com/jobs/123'],
    ['empty userinfo delimiter', 'https://@careers.acme.com/jobs/123'],
    ['empty username and password delimiters', 'https://:@careers.acme.com/jobs/123'],
    ['backslash authority syntax', 'https:\\\\@careers.acme.com/path'],
    ['backslash path syntax', 'https://careers.acme.com\\\\jobs/email@acme.com'],
    ['fragment', 'https://careers.acme.com/jobs/123#apply'],
    ['empty fragment delimiter', 'https://careers.acme.com/jobs/123#'],
    ['localhost', 'https://localhost/jobs/123'],
    ['single-label local hostname', 'https://intranet/jobs/123'],
    ['private IPv4', 'https://10.0.0.1/jobs/123'],
    ['public IPv4', 'https://8.8.8.8/jobs/123'],
    ['IPv6', 'https://[::1]/jobs/123'],
    ['special-use suffix', 'https://careers.acme.test/jobs/123'],
    ['onion service', 'https://careers-acme.onion/jobs/123'],
    ['intermediary Jobright host', 'https://jobs.jobright.ai/jobs/123'],
    ['sensitive token query', 'https://careers.acme.com/jobs/123?access_token=secret'],
    ['signed query', 'https://careers.acme.com/jobs/123?X-Amz-Signature=secret'],
  ])('rejects %s destinations', (_name, url) => {
    expect(validateDestinationUrl(url).ok).toBe(false)
  })

  it('does not mistake path or query characters for authority delimiters', () => {
    const url = 'https://careers.acme.com/jobs/email@acme.com?ref=jobs@board%23weekly'

    expect(validateDestinationUrl(url)).toEqual({ ok: true, url })
  })

  it('enforces the destination length bound without accepting a longer value', () => {
    const prefix = 'https://careers.acme.com/jobs/'
    const url = `${prefix}${'a'.repeat(destinationUrlMaximumLength - prefix.length + 1)}`

    expect(validateDestinationUrl(url)).toMatchObject({ ok: false, code: 'too_long' })
  })

  it('requires a bounded resolver method only for automated resolution', () => {
    expect(validateResolverMethod('jobright_api_detail_apply_link').ok).toBe(true)
    expect(validateResolverMethod('manual entry')).toMatchObject({
      ok: false,
      code: 'invalid_resolver_method',
    })
  })
})
