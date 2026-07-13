import { describe, expect, it } from 'vitest'
import {
  isSafeHttpUrl,
  sanitizeRawEvidence,
  sanitizeRawFacts,
} from './raw-detail-sanitization'

describe('raw sourcing detail sanitization', () => {
  it('omits signed URL, JWT, and AWS credential forms across values and identifiers', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlLXZhbHVlIn0.c2lnbmF0dXJlLXZhbHVl'
    const oversizedQuery = `https://jobs.example.test/platform?${Array.from(
      { length: 129 }, (_, index) => `field${index}=value`,
    ).join('&')}`
    expect(sanitizeRawFacts({
      safeProse: 'Apply through the ordinary employer job page.',
      safeUrl: 'https://jobs.example.test/platform?department=engineering#role',
      safeSigProse: 'The design team uses signal processing.',
      safeSigUrl: 'https://jobs.example.test/platform?design=platform&signal=strong',
      safeLongHostnameUrl: 'https://engineering.department.companyname/jobs/platform',
      signedSig: 'https://jobs.example.test/platform?sig=private-value',
      signedRequestSig: 'https://jobs.example.test/platform?requestSig=private-value',
      signedAwsSig: 'https://jobs.example.test/platform?awsSig=private-value',
      signedXAmzSig: 'https://jobs.example.test/platform?xAmzSig=private-value',
      signedSignature: 'https://jobs.example.test/platform?Signature=private-value',
      signedAmz: 'https://jobs.example.test/platform?X-Amz-Signature=private-value',
      amzCredential: 'https://jobs.example.test/platform?x-amz-credential=private-value',
      amzToken: 'https://jobs.example.test/platform?X_AMZ_SECURITY_TOKEN=private-value',
      encodedClaim: jwt,
      JWT: 'jwt-field-value',
      awsAssignment: 'AWS_ACCESS_KEY_ID=AKIAPRIVATEVALUE0000',
      camelAssignment: 'xAmzCredential=private-value',
      SIG: 'identifier-secret',
      requestSig: 'identifier-secret',
      awsSig: 'identifier-secret',
      xAmzSig: 'identifier-secret',
      requestSignature: 'identifier-secret',
      xAmzSignature: 'identifier-secret',
      X_AMZ_CREDENTIAL: 'identifier-secret',
      'x-amz-security-token': 'identifier-secret',
      AwsAccessKeyId: 'identifier-secret',
    })).toEqual({
      safeProse: 'Apply through the ordinary employer job page.',
      safeUrl: 'https://jobs.example.test/platform?department=engineering#role',
      safeSigProse: 'The design team uses signal processing.',
      safeSigUrl: 'https://jobs.example.test/platform?design=platform&signal=strong',
      safeLongHostnameUrl: 'https://engineering.department.companyname/jobs/platform',
    })
    expect(sanitizeRawEvidence([
      { kind: 'provider', label: 'Safe evidence', value: 'Ordinary public evidence.' },
      { kind: 'provider', label: 'requestSig', value: 'identifier-secret' },
      { kind: 'awsSig', label: 'Provider evidence', value: 'identifier-secret' },
      { kind: 'provider', label: 'xAmzSig', value: 'identifier-secret' },
      { kind: 'provider', label: 'requestSignature', value: 'identifier-secret' },
      { kind: 'xAmzCredential', label: 'Provider evidence', value: 'identifier-secret' },
      { kind: 'provider', label: 'AWS_ACCESS_KEY_ID', value: 'identifier-secret' },
      { kind: 'provider', label: 'jwtClaims', value: 'identifier-secret' },
      { kind: 'provider', label: 'Provider evidence', value: jwt },
    ])).toEqual([
      { kind: 'provider', label: 'Safe evidence', value: 'Ordinary public evidence.' },
    ])
    expect(isSafeHttpUrl(oversizedQuery)).toBe(false)
    expect(isSafeHttpUrl('https://jobs.example.test/platform?design=platform&signal=strong'))
      .toBe(true)
  })

  it('omits embedded credentials and unsafe URL credential material while preserving safe content', () => {
    expect(sanitizeRawFacts({
      note: 'Authorization: Bearer private-value',
      request: 'Cookie: session=private-value',
      hint: 'password=private-value',
      metadata: 'access_token=private-value',
      safeProse: 'This listing is open to remote applicants.',
      safeUrl: 'https://jobs.example.test/platform?department=engineering#role',
      userinfoUrl: 'https://user:private-value@jobs.example.test/platform',
      querySecretUrl: 'https://jobs.example.test/platform?token=private-value',
      hashSecretUrl: 'https://jobs.example.test/platform#authorization=private-value',
    })).toEqual({
      safeProse: 'This listing is open to remote applicants.',
      safeUrl: 'https://jobs.example.test/platform?department=engineering#role',
    })
    expect(isSafeHttpUrl('https://user:private-value@jobs.example.test/platform')).toBe(false)
    expect(isSafeHttpUrl('https://jobs.example.test/platform?token=private-value')).toBe(false)
    expect(isSafeHttpUrl('https://jobs.example.test/platform#authorization=private-value')).toBe(false)
    expect(isSafeHttpUrl('https://jobs.example.test/platform?department=engineering#role')).toBe(true)
    expect(sanitizeRawEvidence([
      { kind: 'provider', label: 'Safe note', value: 'Cookie: session=private-value' },
      { kind: 'provider', label: 'Safe note', value: 'Ordinary provider evidence.' },
    ])).toEqual([
      { kind: 'provider', label: 'Safe note', value: 'Ordinary provider evidence.' },
    ])
  })

  it('scans bounded URL tokens embedded in prose and covers secret, credential, and auth assignments', () => {
    expect(sanitizeRawFacts({
      embeddedUserInfo: 'see https://user:private-value@jobs.example.test/platform',
      embeddedUnsafeScheme: 'open javascript:private-value',
      secretAssignment: 'note secret=private-value',
      credentialAssignment: 'credential=private-value',
      authAssignment: 'auth=private-value',
      secretHash: 'https://jobs.example.test/platform#secret=private-value',
      safeProse: 'Note: ordinary safe prose.',
      safeProseUrl: 'Apply at https://jobs.example.test/platform today.',
    })).toEqual({
      safeProse: 'Note: ordinary safe prose.',
      safeProseUrl: 'Apply at https://jobs.example.test/platform today.',
    })
    expect(isSafeHttpUrl('https://jobs.example.test/platform#secret=private-value'))
      .toBe(false)
  })

  it('rejects quoted and compound sensitive assignments through bounded nested URL decoding', () => {
    const doublyEncoded = 'https://jobs.example.test/redirect?next=https%253A%252F%252Fjobs.example.test%252Frole%2523authToken%253Dprivate-value'
    expect(sanitizeRawFacts({
      first: '{"auth":"private-value"}',
      second: 'clientSecret=private-value',
      third: 'secretKey=private-value',
      fourth: 'credentialId=private-value',
      fifth: 'authToken=private-value',
      sixth: 'see //user:private-value@jobs.example.test/role',
      seventh: 'https://jobs.example.test/role#clientSecret=private-value',
      eighth: doublyEncoded,
      safeProse: 'Apply through the employer site.',
      safeUrl: 'https://jobs.example.test/role#team=platform',
      safeEmbeddedUrl: 'Apply at https://jobs.example.test/role#team=platform today.',
    })).toEqual({
      safeProse: 'Apply through the employer site.',
      safeUrl: 'https://jobs.example.test/role#team=platform',
      safeEmbeddedUrl: 'Apply at https://jobs.example.test/role#team=platform today.',
    })
    expect(isSafeHttpUrl(doublyEncoded)).toBe(false)
    expect(isSafeHttpUrl('https://jobs.example.test/role#authToken=private-value'))
      .toBe(false)
  })
})
