import { assertKnownOptions, hasFlag, parseNullableStringOption, parseStrictJsonObject, parseStrictNonNegativeIntegerOption, readOption, setOptionalStringOption, validateLimit, } from './valedictorian-cli.parser-options.js';
import { connectorRunsListInputSchema, } from '@sparxie/sdk';
import { CliUsageError } from './valedictorian-cli.failures.js';
const connectorRunModes = new Set(['manual']);
export function parseConnectorConfiguration(connectorInstanceId, argv) {
    assertKnownOptions(argv, [
        '--connector-version',
        '--display-name',
        '--earliest-backfill-date',
        '--enabled',
        '--filters-json',
        '--json',
    ]);
    const input = { connectorInstanceId };
    const enabled = readOption(argv, '--enabled');
    const earliestBackfillDate = readOption(argv, '--earliest-backfill-date');
    const filtersJson = readOption(argv, '--filters-json');
    setOptionalStringOption(input, argv, '--connector-version', 'connectorVersion');
    setOptionalStringOption(input, argv, '--display-name', 'displayName');
    if (enabled !== undefined) {
        if (enabled !== 'true' && enabled !== 'false') {
            throw new CliUsageError('Invalid --enabled: expected true or false');
        }
        input.enabled = enabled === 'true';
    }
    if (earliestBackfillDate !== undefined) {
        input.earliestBackfillDate = parseDateOnly(earliestBackfillDate);
    }
    if (filtersJson !== undefined) {
        input.filters = parseJsonObject(filtersJson, '--filters-json');
    }
    if (Object.keys(input).length === 1) {
        throw new CliUsageError('Connector configuration requires at least one field');
    }
    return input;
}
function parseDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new CliUsageError(`Invalid --earliest-backfill-date: ${value}`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new CliUsageError(`Invalid --earliest-backfill-date: ${value}`);
    }
    return value;
}
function parseJsonObject(value, option) {
    return parseStrictJsonObject(value, option);
}
export function parseConnectorRunTrigger(connectorInstanceId, argv) {
    assertKnownOptions(argv, [
        '--dry-run',
        '--filter-signature',
        '--filters-json',
        '--json',
        '--mode',
        '--reason',
    ]);
    const input = { connectorInstanceId };
    const mode = readOption(argv, '--mode');
    if (mode !== undefined) {
        if (!connectorRunModes.has(mode)) {
            throw new CliUsageError(`Invalid connector run mode: ${mode}`);
        }
        input.mode = mode;
    }
    const filterSignature = readOption(argv, '--filter-signature');
    const filtersJson = readOption(argv, '--filters-json');
    const reason = readOption(argv, '--reason');
    if (filterSignature !== undefined) {
        input.filterSignature = parseNullableStringOption(filterSignature, 'filterSignature');
    }
    if (filtersJson !== undefined) {
        input.filters = parseJsonObject(filtersJson, '--filters-json');
    }
    if (reason !== undefined) {
        input.reason = parseNullableStringOption(reason, 'reason');
    }
    if (hasFlag(argv, '--dry-run')) {
        input.dryRun = true;
    }
    return input;
}
export function parseConnectorRunsList(connectorInstanceId, argv) {
    assertKnownOptions(argv, ['--json', '--limit', '--mode', '--offset', '--status']);
    const input = { connectorInstanceId };
    const limit = readOption(argv, '--limit');
    const offset = readOption(argv, '--offset');
    setOptionalStringOption(input, argv, '--status', 'status');
    setOptionalStringOption(input, argv, '--mode', 'mode');
    if (limit !== undefined) {
        input.limit = parseStrictNonNegativeIntegerOption(limit, '--limit');
        validateLimit(input.limit);
    }
    if (offset !== undefined) {
        input.offset = parseStrictNonNegativeIntegerOption(offset, '--offset');
    }
    return connectorRunsListInputSchema.parse(input);
}
export function parseConnectorObservationsList(connectorInstanceId, argv) {
    assertKnownOptions(argv, ['--connector-run-id', '--json', '--limit', '--offset']);
    const input = { connectorInstanceId };
    const limit = readOption(argv, '--limit');
    const offset = readOption(argv, '--offset');
    setOptionalStringOption(input, argv, '--connector-run-id', 'connectorRunId');
    if (limit !== undefined) {
        input.limit = parseStrictNonNegativeIntegerOption(limit, '--limit');
        validateLimit(input.limit);
    }
    if (offset !== undefined) {
        input.offset = parseStrictNonNegativeIntegerOption(offset, '--offset');
    }
    return input;
}
