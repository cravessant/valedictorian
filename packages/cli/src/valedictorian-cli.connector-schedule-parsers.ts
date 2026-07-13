import {
  upsertConnectorScheduleInputSchema,
  type UpsertConnectorScheduleInput,
} from 'sparxie'
import {
  assertKnownOptions,
  readRequiredOption,
} from './valedictorian-cli.parser-options.js'

export function parseConnectorScheduleUpsert(
  connectorInstanceId: string,
  argv: string[],
): UpsertConnectorScheduleInput {
  assertKnownOptions(argv, [
    '--cadence-json',
    '--expected-revision',
    '--json',
    '--state',
    '--timezone',
  ])
  const expectedRevision = readRequiredOption(argv, '--expected-revision')

  return upsertConnectorScheduleInputSchema.parse({
    connectorInstanceId,
    expectedRevision: expectedRevision === 'null' ? null : expectedRevision,
    state: readRequiredOption(argv, '--state'),
    cadence: JSON.parse(readRequiredOption(argv, '--cadence-json')) as unknown,
    timezone: readRequiredOption(argv, '--timezone'),
  })
}
