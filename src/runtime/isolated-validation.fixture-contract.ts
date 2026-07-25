export const isolatedValidationFixture = {
  captureId: '01986e01-4030-7000-8000-000000000001',
  companyId: '01986e01-4030-7000-8000-000000000003',
  timestamp: '2026-07-24T00:00:00.000Z',
  version: 'isolated-validation-fixture@1',
} as const

const longSegment = 'unbrokenfixturevalue'.repeat(18)

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
  validationUrl: `https://validation-fixture.acme.com/${longSegment}?${longSegment}`,
  validationMessage: 'Use a public https destination URL without credentials, sensitive query parameters, or a fragment. The URL will be submitted exactly as entered.',
} as const
