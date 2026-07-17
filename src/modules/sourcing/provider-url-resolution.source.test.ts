import { describe, expect, it, vi } from 'vitest'
import { createProviderUrlResolutionWorkSource } from './provider-url-resolution.source'

describe('provider URL resolution scheduled work', () => {
  it('claims one due operation once across concurrent scheduler drains', async () => {
    let claimed = false
    const execute = vi.fn(async () => undefined)
    const claimDue = vi.fn(async () => {
      if (claimed) return null
      claimed = true
      return {
        acquisitionToken: 'claim-one',
        attempt: 1,
        captureEvidenceVersionId: 'capture-version-one',
        connectorInstanceId: 'jobright-one',
        executionScopeId: 'scope-one',
        inputHash: 'sha256:provider-one',
        horizonAt: '2026-07-17T12:00:00.000Z',
        intermediaryUrl: 'https://jobright.ai/jobs/info/provider-one',
        maxAttempts: 3,
        providerRecordId: 'jobright.public:provider-one',
        resolverId: 'jobright.provider-url',
        resolverVersion: 'jobright-provider-url@1',
        serverMinimumDelayMs: null,
        retryWorkId: 'work-one',
      }
    })
    const options = {
      claimDue,
      execute,
      nextDueAt: () => '2026-07-16T12:00:00.000Z',
      now: () => new Date('2026-07-16T12:00:00.000Z'),
    }
    const first = createProviderUrlResolutionWorkSource(options)
    const second = createProviderUrlResolutionWorkSource(options)

    await Promise.all([first.runDue(), second.runDue()])

    expect(claimDue).toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      acquisitionToken: 'claim-one',
      retryWorkId: 'work-one',
    }), undefined)
  })
})
