import { describe, expect, it } from 'vitest'
import {
  mapProviderUrlResolverResult,
  validateProviderUrlResolverResult,
} from './provider-url-resolution.outcome'

const work = {
  acquisitionToken: 'claim-one',
  attempt: 1,
  captureEvidenceVersionId: 'capture-version-one',
  connectorInstanceId: 'jobright-one',
  executionScopeId: 'scope-one',
  horizonAt: '2026-07-17T12:00:00.000Z',
  inputHash: 'sha256:provider-one',
  intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
  maxAttempts: 3,
  providerRecordId: 'jobright.public:provider-one',
  resolverId: 'jobright.provider-url',
  resolverVersion: 'jobright-provider-url@1',
  retryWorkId: 'work-one',
  serverMinimumDelayMs: null,
}

describe('provider URL resolver outcome mapping', () => {
  it('rejects malformed, oversized, and cyclic trusted resolver results before redaction', () => {
    expect(validateProviderUrlResolverResult({
      status: 'resolved', url: 'not a URL', method: 'provider_detail', evidence: [],
    })).toBe(false)
    expect(validateProviderUrlResolverResult({
      status: 'terminal', reason: 'x'.repeat(513), evidence: [],
    })).toBe(false)
    expect(validateProviderUrlResolverResult({
      status: 'resolved', url: 'https://jobs.lever.co/acme/job-1', method: 'x'.repeat(257), evidence: [],
    })).toBe(false)
    expect(validateProviderUrlResolverResult({
      status: 'terminal', reason: 'bad', evidence: Array.from({ length: 51 }, (_, index) => ({ kind: `evidence-${index}` })),
    })).toBe(false)
    const cyclic: Record<string, unknown> = { kind: 'cycle' }
    cyclic.value = cyclic
    expect(validateProviderUrlResolverResult({
      status: 'terminal', reason: 'bad', evidence: [cyclic],
    })).toBe(false)
  })

  it('preserves the returned URL query and original intermediary evidence', () => {
    const outcome = mapProviderUrlResolverResult(work, {
      status: 'resolved',
      url: 'https://jobs.lever.co/example/opening-1?utm_source=jobright&ref=a%2Bb',
      method: 'jobright_api_detail',
      evidence: [{ kind: 'jobright_api_detail', value: { providerRecordId: 'provider-one' } }],
    }, {
      nowEpochMs: () => Date.parse('2026-07-16T12:00:00.000Z'),
      random: () => 0,
    })

    expect(outcome).toEqual({
      resolverId: 'jobright.provider-url',
      resolverVersion: 'jobright-provider-url@1',
      field: 'destinationUrl',
      inputHash: 'sha256:provider-one',
      status: 'resolved',
      value: {
        class: 'employer_or_ats',
        intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
        url: 'https://jobs.lever.co/example/opening-1?utm_source=jobright&ref=a%2Bb',
      },
      confidence: 1,
      evidence: expect.arrayContaining([
        expect.objectContaining({
          kind: 'provider_url_intermediary',
          value: 'https://jobright.ai/jobs/info/provider-one',
        }),
      ]),
    })
  })

  it('normalizes optional resolver evidence values before persistence', () => {
    const outcome = mapProviderUrlResolverResult(work, {
      status: 'resolved',
      url: 'https://jobs.lever.co/example/opening-1',
      method: 'jobright_api_detail',
      evidence: [{ kind: 'jobright_response_received' }],
    }, {
      nowEpochMs: () => Date.parse('2026-07-16T12:00:00.000Z'),
      random: () => 0,
    })

    expect(outcome).toMatchObject({
      status: 'resolved',
      evidence: expect.arrayContaining([
        { kind: 'jobright_response_received', value: null },
      ]),
    })
  })

  it('preserves terminal evidence as bounded blocked-field provenance', () => {
    const outcome = mapProviderUrlResolverResult(work, {
      status: 'terminal',
      reason: 'jobright_auth_required',
      evidence: [{ kind: 'jobright_auth_state' }],
    }, {
      nowEpochMs: () => Date.parse('2026-07-16T12:00:00.000Z'),
      random: () => 0,
    })

    expect(outcome).toMatchObject({
      status: 'blocked',
      reason: 'jobright_auth_required',
      evidence: [{ kind: 'jobright_auth_state', value: null }],
    })
  })

  it('uses sanitized Retry-After as the shared bounded backoff minimum', () => {
    const outcome = mapProviderUrlResolverResult(work, {
      status: 'retryable',
      reason: 'jobright_rate_limited',
      retryReason: 'rate_limit',
      serverMinimumDelayMs: 120_000,
    }, {
      nowEpochMs: () => Date.parse('2026-07-16T12:00:00.000Z'),
      random: () => 0,
    })

    expect(outcome).toMatchObject({
      status: 'retry',
      retry: {
        attempt: 1,
        computedDelayMs: 120_001,
        nextAttemptAt: '2026-07-16T12:02:00.001Z',
        reason: 'rate_limit',
        serverMinimumDelayMs: 120_000,
        state: 'scheduled',
      },
    })
  })

  it('exhausts only the affected operation at the attempt limit', () => {
    const outcome = mapProviderUrlResolverResult({ ...work, attempt: 3 }, {
      status: 'retryable',
      reason: 'jobright_upstream_failed',
      retryReason: 'server_failure',
    }, {
      nowEpochMs: () => Date.parse('2026-07-16T12:00:00.000Z'),
      random: () => 0,
    })

    expect(outcome).toMatchObject({
      status: 'exhausted',
      retry: {
        attempt: 3,
        nextAttemptAt: null,
        reason: 'server_failure',
        state: 'exhausted',
      },
    })
  })
})
