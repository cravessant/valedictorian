import { describe, expect, it } from 'vitest'
import {
  ConnectorScheduleHttpError,
  ValedictorianHttpError,
  ValedictorianProtocolError,
  ValedictorianTransportError,
  connectorScheduleErrorBodies,
  valedictorianFailureKindMessages,
} from '@sparxie/sdk'
import {
  canonicalAlreadyConfiguredBody,
  classifyErrorPresentation,
  isCanonicalAlreadyConfigured,
  ownedLoadFailure,
} from './error-presentation'

describe('classifyErrorPresentation', () => {
  it('maps typed failure semantics and operation context to one presentation surface each', () => {
    expect(
      classifyErrorPresentation(new Error('client field required'), {
        scope: 'field',
        trigger: 'client_validation',
      }),
    ).toMatchObject({
      surface: 'field',
      message: 'This field is invalid.',
      retryable: false,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'validation_error', message: 'The request is invalid.' },
          kind: 'validation',
          message: 'The request is invalid.',
          status: 400,
        }),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      surface: 'form',
      message: 'The request is invalid.',
      retryable: false,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'not_found',
          message: valedictorianFailureKindMessages.not_found,
          status: 404,
        }),
        { scope: 'page', trigger: 'action', operationId: 'promote:finding-1' },
      ),
    ).toMatchObject({
      surface: 'action_toast',
      message: valedictorianFailureKindMessages.not_found,
      operationId: 'promote:finding-1',
      retryable: false,
    })

    expect(
      classifyErrorPresentation(new ValedictorianTransportError(), {
        scope: 'section',
        trigger: 'load',
      }),
    ).toMatchObject({
      surface: 'global',
      message: valedictorianFailureKindMessages.unavailable,
      retryable: true,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'unavailable',
          message: valedictorianFailureKindMessages.unavailable,
          status: 503,
        }),
        { scope: 'section', trigger: 'refresh', hasStaleData: true },
      ),
    ).toMatchObject({
      surface: 'stale_refresh',
      message: valedictorianFailureKindMessages.unavailable,
      retryable: true,
    })

    expect(
      classifyErrorPresentation(new ValedictorianTransportError(), {
        scope: 'global',
        trigger: 'load',
      }),
    ).toMatchObject({
      surface: 'global',
      message: valedictorianFailureKindMessages.unavailable,
      retryable: true,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'authentication',
          message: valedictorianFailureKindMessages.authentication,
          status: 401,
        }),
        { scope: 'section', trigger: 'auth' },
      ),
    ).toMatchObject({
      surface: 'authentication',
      message: valedictorianFailureKindMessages.authentication,
      retryable: false,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'authentication',
          message: valedictorianFailureKindMessages.authentication,
          status: 401,
        }),
        { scope: 'page', trigger: 'load' },
      ),
    ).toMatchObject({
      surface: 'authentication',
      message: valedictorianFailureKindMessages.authentication,
      retryable: true,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'ok', message: 'Normalization finished with failures.' },
          message: 'Normalization finished with failures.',
          status: 200,
        }),
        { scope: 'background', trigger: 'background' },
      ),
    ).toMatchObject({
      surface: 'background',
      message: valedictorianFailureKindMessages.internal,
      retryable: false,
    })
    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'ok', message: 'Normalization finished with failures.' },
          message: 'Normalization finished with failures.',
          status: 200,
        }),
        { scope: 'background', trigger: 'background' },
      ).message,
    ).not.toContain('Normalization finished')

    const cancelled = new DOMException('Aborted', 'AbortError')
    expect(
      classifyErrorPresentation(cancelled, {
        scope: 'page',
        trigger: 'cancel',
      }),
    ).toMatchObject({
      surface: 'none',
      message: '',
      retryable: false,
    })
    expect(
      ownedLoadFailure(classifyErrorPresentation(cancelled, {
        scope: 'page',
        trigger: 'load',
      })),
    ).toBeNull()
    expect(
      ownedLoadFailure({
        message: 'Applications could not be loaded.',
        retryable: true,
        surface: 'scoped_load',
        title: 'Load failed',
      }),
    ).toMatchObject({
      surface: 'scoped_load',
      message: 'Applications could not be loaded.',
    })

    expect(
      classifyErrorPresentation(new Error('ENOENT /secret/path stack'), {
        scope: 'page',
        trigger: 'action',
        operationId: 'action:unknown',
      }),
    ).toMatchObject({
      surface: 'action_toast',
      message: valedictorianFailureKindMessages.internal,
      retryable: false,
    })
    expect(
      classifyErrorPresentation(new Error('ENOENT /secret/path stack'), {
        scope: 'page',
        trigger: 'action',
      }).message,
    ).not.toContain('ENOENT')

    expect(
      classifyErrorPresentation(
        new ConnectorScheduleHttpError(
          connectorScheduleErrorBodies.stale_schedule_revision,
          409,
        ),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      surface: 'form',
      message: connectorScheduleErrorBodies.stale_schedule_revision.message,
      retryable: true,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          message: 'Request failed',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      surface: 'form',
      message: valedictorianFailureKindMessages.internal,
      retryable: false,
    })
    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          message: 'Request failed',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ).message,
    ).not.toMatch(/already configured/i)

    expect(
      classifyErrorPresentation(new ValedictorianProtocolError(), {
        scope: 'page',
        trigger: 'load',
      }),
    ).toMatchObject({
      surface: 'scoped_load',
      message: valedictorianFailureKindMessages.internal,
      retryable: true,
    })
  })

  it('never renders arbitrary HTTP Error.message or infers already_configured from bare 409', () => {
    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'validation',
          message: 'SQL dump /tmp/secret.db leaked internals',
          status: 400,
        }),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      surface: 'form',
      message: valedictorianFailureKindMessages.validation,
    })
    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'validation',
          message: 'SQL dump /tmp/secret.db leaked internals',
          status: 400,
        }),
        { scope: 'form', trigger: 'save' },
      ).message,
    ).not.toContain('SQL dump')

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'conflict', message: 'revision collided on row 9' },
          message: 'revision collided on row 9',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      surface: 'form',
      message: valedictorianFailureKindMessages.internal,
      retryable: false,
    })
    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'conflict', message: 'revision collided on row 9' },
          message: 'revision collided on row 9',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ).message,
    ).not.toMatch(/revision collided|already configured/i)

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'already_configured', message: 'ignored provider dump' },
          message: 'ignored provider dump',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      surface: 'form',
      message: valedictorianFailureKindMessages.internal,
      retryable: false,
    })
    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'already_configured', message: 'ignored provider dump' },
          message: 'ignored provider dump',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ).message,
    ).not.toMatch(/already configured/i)

    expect(
      classifyErrorPresentation(
        { code: 'already_configured', status: 409, message: 'forged plain object' },
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      message: valedictorianFailureKindMessages.internal,
    })
    expect(
      classifyErrorPresentation(
        Object.assign(new Error('duplicate session abc'), { status: 409 }),
        { scope: 'form', trigger: 'save' },
      ).message,
    ).not.toMatch(/already configured/i)

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: {
            code: 'already_configured',
            message: 'This connector is already configured. Manage the existing instance.',
          },
          message: 'Request failed',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      message: 'This connector is already configured.',
      retryable: false,
    })
  })

  it('requires ValedictorianHttpError status 409 plus exact canonical body for already_configured', () => {
    expect(
      isCanonicalAlreadyConfigured(
        new ValedictorianHttpError({
          body: { ...canonicalAlreadyConfiguredBody },
          message: 'Request failed',
          status: 409,
        }),
      ),
    ).toBe(true)

    expect(
      isCanonicalAlreadyConfigured(
        new ValedictorianHttpError({
          body: { ...canonicalAlreadyConfiguredBody },
          kind: 'authentication',
          message: 'auth dump',
          status: 401,
        }),
      ),
    ).toBe(false)

    expect(
      isCanonicalAlreadyConfigured(
        new ValedictorianHttpError({
          body: { ...canonicalAlreadyConfiguredBody },
          kind: 'internal',
          message: 'server dump',
          status: 500,
        }),
      ),
    ).toBe(false)

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { ...canonicalAlreadyConfiguredBody },
          kind: 'authentication',
          message: 'auth dump',
          status: 401,
        }),
        { scope: 'form', trigger: 'save' },
      ).message,
    ).not.toMatch(/already configured/i)

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { ...canonicalAlreadyConfiguredBody },
          kind: 'internal',
          message: 'server dump',
          status: 500,
        }),
        { scope: 'form', trigger: 'save' },
      ).message,
    ).not.toMatch(/already configured/i)

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          message: 'Request failed',
          status: 409,
        }),
        { scope: 'form', trigger: 'save' },
      ),
    ).toMatchObject({
      message: valedictorianFailureKindMessages.internal,
      retryable: false,
    })
    expect(
      isCanonicalAlreadyConfigured(
        new ValedictorianHttpError({
          body: null,
          message: 'Request failed',
          status: 409,
        }),
      ),
    ).toBe(false)
  })
})

describe('classifyErrorPresentation load retryability', () => {
  it('preserves typed non-retryable load failures instead of hardcoding retryable', () => {
    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'not_found',
          message: valedictorianFailureKindMessages.not_found,
          status: 404,
        }),
        { scope: 'page', trigger: 'load' },
      ),
    ).toMatchObject({
      surface: 'scoped_load',
      retryable: false,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: { code: 'validation_error', message: 'The request is invalid.' },
          kind: 'validation',
          message: 'The request is invalid.',
          status: 400,
        }),
        { scope: 'section', trigger: 'load' },
      ),
    ).toMatchObject({
      surface: 'scoped_load',
      retryable: false,
    })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'not_found',
          message: valedictorianFailureKindMessages.not_found,
          status: 404,
        }),
        { scope: 'section', trigger: 'refresh', hasStaleData: true },
      ),
    ).toMatchObject({
      surface: 'stale_refresh',
      retryable: false,
    })
  })

  it('keeps retryable true for transport, rate-limit, unavailable, protocol, and fetch TypeError loads', () => {
    expect(
      classifyErrorPresentation(new ValedictorianTransportError(), {
        scope: 'page',
        trigger: 'load',
      }),
    ).toMatchObject({ surface: 'global', retryable: true })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'rate_limit',
          message: valedictorianFailureKindMessages.rate_limit,
          status: 429,
        }),
        { scope: 'page', trigger: 'load' },
      ),
    ).toMatchObject({ surface: 'scoped_load', retryable: true })

    expect(
      classifyErrorPresentation(
        new ValedictorianHttpError({
          body: null,
          kind: 'unavailable',
          message: valedictorianFailureKindMessages.unavailable,
          status: 503,
        }),
        { scope: 'section', trigger: 'refresh', hasStaleData: true },
      ),
    ).toMatchObject({ surface: 'stale_refresh', retryable: true })

    expect(
      classifyErrorPresentation(new ValedictorianProtocolError(), {
        scope: 'page',
        trigger: 'load',
      }),
    ).toMatchObject({ surface: 'scoped_load', retryable: true })

    expect(
      classifyErrorPresentation(new TypeError('fetch failed'), {
        scope: 'page',
        trigger: 'load',
      }),
    ).toMatchObject({ surface: 'scoped_load', retryable: true })
  })
})
