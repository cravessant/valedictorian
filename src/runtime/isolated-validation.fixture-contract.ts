import { validateDestinationUrl } from '../modules/capture/public'

export const isolatedValidationFixture = {
  captureId: '01986e01-4030-7000-8000-000000000001',
  companyId: '01986e01-4030-7000-8000-000000000003',
  timestamp: '2026-07-24T00:00:00.000Z',
  version: 'isolated-validation-fixture@1',
} as const

const longSegment = 'unbrokenfixturevalue'.repeat(18)

/**
 * A long destination URL the shared validator must reject, so Capture completion
 * keeps its dialog open and renders a status message the layout proof can measure.
 * The sensitive query key is what makes it invalid; the surrounding length is what
 * makes it a containment fixture.
 */
const rejectedValidationUrl = `https://validation-fixture.acme.com/${longSegment}?session=${longSegment}`

export const captureCompletionLongContentFixture = {
  companyDisplayName: `Validation Company ${longSegment}`,
  destinationUrl: `https://validation-fixture.acme.com/${longSegment.repeat(2)}`,
  formValue: `Form value ${longSegment}`,
  identifier: `provider-record-${longSegment}`,
  jsonEvidence: {
    externalIdentifier: `external-${longSegment}`,
    nested: { machineValue: longSegment.repeat(2) },
  },
  sourceAdapterId: `source-${longSegment.slice(0, 180)}`,
  validationUrl: rejectedValidationUrl,
  validationMessage: rejectedDestinationUrlMessage(rejectedValidationUrl),
} as const

/**
 * Derives the expected message from the validator the dialog actually calls, so a
 * change to destination validation copy cannot leave the Electron layout proof
 * waiting for text no production code produces.
 */
function rejectedDestinationUrlMessage(value: string): string {
  const result = validateDestinationUrl(value)
  if (result.ok) {
    throw new Error(
      'The Capture completion long-content fixture URL must be rejected by destination validation.',
    )
  }
  return result.message
}
