import { describe, expect, it } from 'vitest'
import {
  LocalSecretResolutionHttpError,
  ProfileDocumentHttpError,
  ValedictorianHttpError,
  ValedictorianProtocolError,
  ValedictorianTransportError,
  localSecretResolutionErrorBodies,
  profileDocumentErrorBodies,
  valedictorianSafeRequestFailedMessage,
} from '@sparxie/sdk'

import {
  CliOwnedFailure,
  CliUsageError,
  classifyCliFailure,
  presentCliFailure,
} from './valedictorian-cli.failures.js'

describe('classifyCliFailure', () => {
  it('classifies CliUsageError as usage exit 2', () => {
    const classified = classifyCliFailure(new CliUsageError('Missing --workspace'))
    expect(classified.exitCode).toBe(2)
    expect(classified.error.code).toBe('usage_error')
    expect(classified.error.kind).toBe('validation')
  })

  it('classifies transport errors as exit 5 without cause leakage', () => {
    const cause = new Error('ECONNREFUSED canary-host-leak')
    const classified = classifyCliFailure(new ValedictorianTransportError({ cause }))
    expect(classified.exitCode).toBe(5)
    expect(classified.error.kind).toBe('unavailable')
    expect(classified.error.code).toBe('transport_error')
    expect(JSON.stringify(classified.error)).not.toContain('canary-host-leak')
    expect(JSON.stringify(classified.error)).not.toContain('ECONNREFUSED')
  })

  it('classifies protocol errors as exit 6', () => {
    const classified = classifyCliFailure(new ValedictorianProtocolError())
    expect(classified.exitCode).toBe(6)
    expect(classified.error.kind).toBe('integrity')
    expect(classified.error.code).toBe('protocol_error')
  })

  it('retains validated profile document capability fields', () => {
    const error = new ProfileDocumentHttpError(
      {
        ...profileDocumentErrorBodies.invalid_profile_document,
        path: ['profile', 'email'],
        line: 3,
        column: 8,
      },
      422,
    )
    const classified = classifyCliFailure(error)
    expect(classified.exitCode).toBe(2)
    expect(classified.error).toMatchObject({
      code: 'invalid_profile_document',
      kind: 'validation',
      status: 422,
      path: ['profile', 'email'],
      line: 3,
      column: 8,
    })
  })

  it('maps each local-secret resolution family by validated kind', () => {
    const cases = [
      ['secret_not_found', 4, 'not_found'],
      ['local_secret_resolution_unauthorized', 3, 'authorization'],
      ['local_secret_resolution_unsupported', 4, 'conflict'],
      ['secure_storage_unavailable', 5, 'unavailable'],
    ] as const

    for (const [code, exitCode, kind] of cases) {
      const error = new LocalSecretResolutionHttpError(
        localSecretResolutionErrorBodies[code],
        { secret_not_found: 404, local_secret_resolution_unauthorized: 403,
          local_secret_resolution_unsupported: 409, secure_storage_unavailable: 503 }[code],
      )
      const classified = classifyCliFailure(error)
      expect(classified.exitCode, code).toBe(exitCode)
      expect(classified.error.code, code).toBe(code)
      expect(classified.error.kind, code).toBe(kind)
    }
  })

  it('treats unrecognized Error as internal without reflecting message', () => {
    const classified = classifyCliFailure(new Error('hostile upstream canary message'))
    expect(classified.exitCode).toBe(1)
    expect(classified.error.kind).toBe('internal')
    expect(classified.error.code).toBe('internal_error')
    expect(JSON.stringify(classified.error)).not.toContain('hostile upstream canary')
  })

  it('ignores forged Error lookalikes that mimic typed names', () => {
    const forged = Object.assign(new Error(valedictorianSafeRequestFailedMessage), {
      name: 'ValedictorianTransportError',
      status: 503,
      body: { code: 'secret_not_found', message: 'forged' },
    })
    const classified = classifyCliFailure(forged)
    expect(classified.exitCode).toBe(1)
    expect(classified.error.code).toBe('internal_error')
    expect(classified.error).not.toHaveProperty('status')
  })

  it('classifies status-only ValedictorianHttpError without trusting body.message', () => {
    const error = new ValedictorianHttpError({
      body: null,
      message: valedictorianSafeRequestFailedMessage,
      status: 429,
    })
    const classified = classifyCliFailure(error)
    expect(classified.exitCode).toBe(5)
    expect(classified.error.kind).toBe('rate_limit')
    expect(classified.error.status).toBe(429)
    expect(classified.error).not.toHaveProperty('message')
  })

  it('does not reflect arbitrary generic HttpError body.message fields', () => {
    const canary = 'hostile-generic-http-body-message-canary'
    const error = new ValedictorianHttpError({
      body: { code: 'not_found', message: canary },
      message: valedictorianSafeRequestFailedMessage,
      status: 404,
      kind: 'not_found',
    })
    const classified = classifyCliFailure(error)
    expect(classified.exitCode).toBe(4)
    expect(classified.error).toEqual({
      code: 'not_found',
      kind: 'not_found',
      status: 404,
    })
    expect(JSON.stringify(classified.error)).not.toContain(canary)
  })

  it('exposes messages only from validated concrete local-secret bodies', () => {
    const body = localSecretResolutionErrorBodies.secret_not_found
    const classified = classifyCliFailure(new LocalSecretResolutionHttpError(body, 404))
    expect(classified.exitCode).toBe(4)
    expect(classified.error.message).toBe(body.message)
  })

  it('presents CLI-owned secret failures with stable codes', () => {
    const classified = classifyCliFailure(
      new CliOwnedFailure({
        code: 'secrets_run_spawn_failed',
        kind: 'internal',
        message: 'secrets run spawn failed',
      }),
    )
    expect(classified.exitCode).toBe(1)
    expect(classified.error.code).toBe('secrets_run_spawn_failed')
  })
})

describe('presentCliFailure', () => {
  it('emits structured JSON without prose prefixes', () => {
    const presented = presentCliFailure(new ValedictorianProtocolError(), {
      asJson: true,
      operation: 'applications list',
    })
    expect(presented.text.startsWith('{')).toBe(true)
    expect(presented.text.endsWith('}\n')).toBe(true)
    expect(JSON.parse(presented.text)).toEqual({
      error: {
        code: 'protocol_error',
        kind: 'integrity',
      },
    })
    expect(presented.text).not.toContain('applications list')
  })

  it('emits human output with operation context and stable guidance', () => {
    const presented = presentCliFailure(
      new ProfileDocumentHttpError(profileDocumentErrorBodies.profile_revision_conflict, 409),
      { asJson: false, operation: 'profile update' },
    )
    expect(presented.text).toContain('profile update')
    expect(presented.text).toContain('profile_revision_conflict')
    expect(presented.text).toContain(profileDocumentErrorBodies.profile_revision_conflict.message)
    expect(presented.text).toMatch(/recovery:/i)
    expect(presented.exitCode).toBe(4)
  })
})
