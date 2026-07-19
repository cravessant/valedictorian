import { describe, expect, it } from 'vitest'
import { ValedictorianHttpError, valedictorianFailureKindMessages } from 'sparxie'
import {
  sanitizedConnectorAuthErrorMessage,
  sanitizedConnectorCreateErrorMessage,
  sanitizedJobrightCredentialActionErrorMessage,
} from './connector-settings.helpers'
import { canonicalAlreadyConfiguredBody } from '../app/error-presentation'

describe('connector settings error messages', () => {
  it('reports how far credential saving progressed without exposing error content', () => {
    const sensitiveError = new Error('demo@example.com secret-password')

    expect(sanitizedJobrightCredentialActionErrorMessage('saving', sensitiveError)).toBe(
      'Credentials were not saved. The secure credential store did not accept the update. Restart the app, then try again.',
    )
    expect(sanitizedJobrightCredentialActionErrorMessage('attaching', sensitiveError)).toBe(
      'Credentials were saved securely, but the connector could not be linked to them. Select Update credentials and try again.',
    )
    expect(sanitizedJobrightCredentialActionErrorMessage('validating', sensitiveError)).toBe(
      'Credentials were saved and linked, but validation could not start. Select Validate to retry; if it fails again, restart the app.',
    )

    for (const stage of ['saving', 'attaching', 'validating'] as const) {
      const message = sanitizedJobrightCredentialActionErrorMessage(stage, sensitiveError)
      expect(message).not.toContain('demo@example.com')
      expect(message).not.toContain('secret-password')
    }
  })

  it('gives an actionable connector-service message for validation transport failures', () => {
    const error = new Error('Connector status actions are unavailable for this runtime.')

    expect(sanitizedConnectorAuthErrorMessage(error)).toBe(
      'Jobright validation could not start because the connector service is unavailable. Restart the app, then try again.',
    )
    expect(sanitizedJobrightCredentialActionErrorMessage('validating', error)).toBe(
      'Credentials were saved and linked, but validation could not start because the connector service is unavailable. Restart the app, then select Validate.',
    )
  })

  it('fail-closes forged already_configured signals and bare 409s', () => {
    expect(
      sanitizedConnectorCreateErrorMessage(
        Object.assign(new Error('duplicate credential session abc123'), { status: 409 }),
      ),
    ).toBe('The connector action was rejected. Reload connector state before trying again.')
    expect(
      sanitizedConnectorCreateErrorMessage({
        code: 'already_configured',
        status: 409,
        body: { code: 'already_configured' },
      }),
    ).toBe('The connector action was rejected. Reload connector state before trying again.')
    expect(
      sanitizedConnectorCreateErrorMessage(
        new ValedictorianHttpError({
          body: { code: 'already_configured', message: 'forged provider dump' },
          message: 'forged provider dump',
          status: 409,
        }),
      ),
    ).toBe('The connector action was rejected. Reload connector state before trying again.')
  })

  it('accepts schema-validated already_configured bodies only', () => {
    expect(
      sanitizedConnectorCreateErrorMessage(
        new ValedictorianHttpError({
          body: { ...canonicalAlreadyConfiguredBody },
          message: 'Request failed',
          status: 409,
        }),
      ),
    ).toBe(
      'Jobright is already configured. Reload connector state and manage the existing instance.',
    )
    expect(valedictorianFailureKindMessages.internal).toBeTruthy()
  })
})
