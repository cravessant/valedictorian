import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { handleHttpRequestError } from '@sparxie/valedictorian-local-runtime/testing/server/local-server.error-boundary'
import { LocalHttpBodyTooLargeError, LocalHttpValidationError, readJsonBody } from '@sparxie/valedictorian-local-runtime/testing/server/local-server.http'
import { parsePolicyConfigPatch } from '@sparxie/valedictorian-local-runtime/testing/server/local-server.parsers.connectors-policy'

function requestWith(body: string, headers: IncomingMessage['headers'] = {}) {
  const request = Readable.from([Buffer.from(body)]) as IncomingMessage
  request.headers = headers
  return request
}

describe('local HTTP body limits', () => {
  it('rejects a declared oversized body before parsing', async () => {
    const request = requestWith('', { 'content-length': '11' })

    await expect(readJsonBody(request, { maxBytes: 10 })).rejects.toEqual(
      expect.objectContaining({
        message: 'Request body exceeds the raw batch limit',
        statusCode: 413,
      }),
    )
  })

  it('rejects accumulated bytes with the route-specific message', async () => {
    const request = requestWith('123456')

    await expect(readJsonBody(request, {
      maxBytes: 5,
      maxBytesMessage: 'Request body exceeds the raw replay limit',
    })).rejects.toEqual(expect.objectContaining({
      message: 'Request body exceeds the raw replay limit',
      statusCode: 413,
    }))
  })

  it('rejects a declared 2MiB body before accumulation', async () => {
    const twoMiB = 2 * 1024 * 1024
    const request = requestWith('', { 'content-length': String(twoMiB) })

    await expect(readJsonBody(request, {
      maxBytes: twoMiB - 1,
      maxBytesMessage: 'The request body is too large.',
    })).rejects.toEqual(expect.objectContaining({
      name: 'LocalHttpBodyTooLargeError',
      message: 'The request body is too large.',
      statusCode: 413,
    }))
  })

  it('rejects an accumulated 2MiB body with the fixed oversized mapping', async () => {
    const twoMiB = 2 * 1024 * 1024
    const request = requestWith('x'.repeat(twoMiB))

    await expect(readJsonBody(request, {
      maxBytes: twoMiB - 1,
      maxBytesMessage: 'The request body is too large.',
    })).rejects.toEqual(expect.objectContaining({
      name: 'LocalHttpBodyTooLargeError',
      message: 'The request body is too large.',
      statusCode: 413,
    }))
  })

  it('uses a typed error so the HTTP boundary can map both limits to 413', () => {
    expect(new LocalHttpBodyTooLargeError('too large')).toMatchObject({
      name: 'LocalHttpBodyTooLargeError',
      statusCode: 413,
    })
  })

  it('maps the released replay body limit to the fixed HTTP 413 response', async () => {
    const request = requestWith('', { 'content-length': String(2 * 1024 * 1024) })
    const error = await readJsonBody(request, {
      maxBytes: 1024 * 1024,
      maxBytesMessage: 'Request body exceeds the raw replay limit',
    }).catch((caught: unknown) => caught)
    const writeHead = vi.fn()
    const end = vi.fn()
    const response = { end, writeHead } as unknown as ServerResponse
    const onRequestError = vi.fn()

    handleHttpRequestError({
      error,
      isLocalSecretResolveRoute: false,
      onRequestError,
      pathname: '/v1/workspaces/workspace-1/sourcing/raw-records/replay',
      request,
      response,
    })

    expect(error).toBeInstanceOf(LocalHttpBodyTooLargeError)
    expect(writeHead).toHaveBeenCalledWith(413, expect.objectContaining({
      'content-type': 'application/json',
    }))
    expect(end).toHaveBeenCalledWith(JSON.stringify({ message: 'The request body is too large.' }))
    expect(onRequestError).not.toHaveBeenCalled()
  })
})

describe('policy config patch parsing', () => {
  it('admits a canonical actionQueue patch', () => {
    expect(parsePolicyConfigPatch({ actionQueue: { staleLockHours: 3 } }))
      .toEqual({ actionQueue: { staleLockHours: 3 } })
  })

  it('admits a canonical multi-section patch across every leaf kind', () => {
    const patch = {
      scoring: { applyCutoff: 7 },
      manualReview: { daytimeWindow: { start: '09:00' }, nonOverridableTags: ['yc_company'] },
      officialPath: { requireEmployerDomainVerificationForHighRiskForms: false },
      sourcing: { overnightStartHour: 0, timezone: 'UTC' },
    }
    expect(parsePolicyConfigPatch(patch)).toEqual(patch)
  })

  it('rejects an unknown config field as a validation error rather than ignoring it', () => {
    expect(() => parsePolicyConfigPatch({ unknownSection: { staleLockHours: 3 } }))
      .toThrow(new LocalHttpValidationError('Unsupported policy config field: unknownSection'))
  })

  it('rejects malformed known values as validation errors rather than admitting a default reset', () => {
    // Normalization would substitute the default for each of these, reporting a successful update
    // that changed nothing — or reset a stored non-default value back to the default.
    for (const [path, patch] of [
      ['actionQueue', { actionQueue: 3 }],
      ['actionQueue.staleLockHours', { actionQueue: { staleLockHours: 'bad' } }],
      ['manualReview.daytimeWindow.start', { manualReview: { daytimeWindow: { start: '9am' } } }],
      ['manualReview.nonOverridableTags', { manualReview: { nonOverridableTags: ['bogus'] } }],
      ['sourcing.overnightStartHour', { sourcing: { overnightStartHour: 24 } }],
    ] as const) {
      expect(() => parsePolicyConfigPatch(patch))
        .toThrow(new LocalHttpValidationError(`Unsupported policy config value: ${path}`))
    }
  })

  it('translates an unsupported policy config version into a validation error, not a 500', () => {
    expect(() => parsePolicyConfigPatch({ version: 3 }))
      .toThrow(new LocalHttpValidationError('Policy config version 3 is newer than this package supports.'))
  })
})
