import { isActionQueueBucket, isRunStatus, isRunType, } from '@sparxie/sdk';
import { CliUsageError } from './valedictorian-cli.failures.js';
import { assertKnownOptions, parseNullableTimestampOption, parseStrictJsonValue, parseStrictNonNegativeIntegerOption, readOption, readRequiredArgument, readRequiredOption, readRequiredText, setOptionalStringOption, validateLimit, } from './valedictorian-cli.parser-options.js';
export { assertKnownOptions, readOption, readRequiredArgument, readRequiredOption, readRequiredText, } from './valedictorian-cli.parser-options.js';
export { parseConnectorConfiguration, parseConnectorObservationsList, parseConnectorRunsList, parseConnectorRunTrigger, } from './valedictorian-cli.connector-parsers.js';
export function parseActionQueueListQuery(argv) {
    const query = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--action-bucket') {
            const bucket = readRequiredArgument(argv[index + 1], '--action-bucket value');
            if (!isActionQueueBucket(bucket))
                throw new CliUsageError(`Invalid action queue bucket: ${bucket}`);
            query.actionBucket = bucket;
            index += 1;
            continue;
        }
        if (token === '--limit') {
            query.limit = parseStrictNonNegativeIntegerOption(readRequiredArgument(argv[index + 1], '--limit value'), '--limit');
            validateLimit(query.limit);
            index += 1;
            continue;
        }
        if (token === '--offset') {
            query.offset = parseStrictNonNegativeIntegerOption(readRequiredArgument(argv[index + 1], '--offset value'), '--offset');
            index += 1;
            continue;
        }
        if (token === '--json')
            continue;
        throw new CliUsageError(`Unknown option: ${token}`);
    }
    return query;
}
export function parseWorkflowRunsListQuery(argv) {
    const query = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--run-type') {
            const runType = readRequiredArgument(argv[index + 1], '--run-type value');
            if (!isRunType(runType))
                throw new CliUsageError(`Invalid run type: ${runType}`);
            query.runType = runType;
            index += 1;
            continue;
        }
        if (token === '--status') {
            const status = readRequiredArgument(argv[index + 1], '--status value');
            if (!isRunStatus(status))
                throw new CliUsageError(`Invalid run status: ${status}`);
            query.status = status;
            index += 1;
            continue;
        }
        if (token === '--source')
            query.source = readRequiredArgument(argv[++index], '--source value');
        else if (token === '--source-id')
            query.sourceId = readRequiredArgument(argv[++index], '--source-id value');
        else if (token === '--subject-application-id') {
            query.subjectApplicationId = readRequiredArgument(argv[++index], '--subject-application-id value');
        }
        else if (token === '--limit') {
            query.limit = parseStrictNonNegativeIntegerOption(readRequiredArgument(argv[++index], '--limit value'), '--limit');
            validateLimit(query.limit);
        }
        else if (token === '--offset') {
            query.offset = parseStrictNonNegativeIntegerOption(readRequiredArgument(argv[++index], '--offset value'), '--offset');
        }
        else if (token !== '--json')
            throw new CliUsageError(`Unknown option: ${token}`);
    }
    return query;
}
const workflowActorTypes = new Set(['agent', 'automation', 'system', 'user']);
export function parseRunStart(argv) {
    assertKnownOptions(argv, [
        '--actor-name', '--actor-type', '--coverage-ended-at', '--coverage-started-at',
        '--input-json', '--json', '--metadata-json', '--run-type', '--source-id', '--source-name',
        '--subject-application-id', '--summary', '--timezone',
    ]);
    const runType = readRequiredOption(argv, '--run-type');
    const actorType = readRequiredOption(argv, '--actor-type');
    if (!isRunType(runType))
        throw new CliUsageError(`Invalid run type: ${runType}`);
    if (!workflowActorTypes.has(actorType))
        throw new CliUsageError(`Invalid actorType: ${actorType}`);
    const input = {
        runType,
        actorType: actorType,
    };
    setOptionalStringOption(input, argv, '--actor-name', 'actorName');
    setOptionalStringOption(input, argv, '--source-id', 'sourceId');
    setOptionalStringOption(input, argv, '--source-name', 'sourceName');
    setOptionalStringOption(input, argv, '--subject-application-id', 'subjectApplicationId');
    setOptionalStringOption(input, argv, '--timezone', 'timezone');
    setOptionalStringOption(input, argv, '--summary', 'summary');
    const started = readOption(argv, '--coverage-started-at');
    const ended = readOption(argv, '--coverage-ended-at');
    const inputJson = readOption(argv, '--input-json');
    const metadataJson = readOption(argv, '--metadata-json');
    if (started !== undefined)
        input.coverageStartedAt = parseNullableTimestampOption(started, 'coverageStartedAt');
    if (ended !== undefined)
        input.coverageEndedAt = parseNullableTimestampOption(ended, 'coverageEndedAt');
    if (inputJson !== undefined)
        input.input = parseStrictJsonValue(inputJson, '--input-json');
    if (metadataJson !== undefined)
        input.metadata = parseStrictJsonValue(metadataJson, '--metadata-json');
    return input;
}
export function parseRunStep(workflowRunId, argv) {
    assertKnownOptions(argv, ['--actor', '--json', '--message', '--payload-json', '--type']);
    const input = {
        workflowRunId,
        type: readRequiredOption(argv, '--type'),
        message: readRequiredText(readOption(argv, '--message'), 'run step message'),
    };
    setOptionalStringOption(input, argv, '--actor', 'actor');
    const payloadJson = readOption(argv, '--payload-json');
    if (payloadJson !== undefined)
        input.payload = parseStrictJsonValue(payloadJson, '--payload-json');
    return input;
}
export function parseRunComplete(workflowRunId, argv) {
    assertKnownOptions(argv, ['--blocker', '--json', '--metadata-json', '--outcome', '--status', '--summary']);
    const input = { workflowRunId };
    const status = readOption(argv, '--status');
    if (status !== undefined) {
        if (!isRunStatus(status))
            throw new CliUsageError(`Invalid run status: ${status}`);
        input.status = status;
    }
    setOptionalStringOption(input, argv, '--outcome', 'outcome');
    setOptionalStringOption(input, argv, '--summary', 'summary');
    setOptionalStringOption(input, argv, '--blocker', 'blocker');
    const metadataJson = readOption(argv, '--metadata-json');
    if (metadataJson !== undefined)
        input.metadata = parseStrictJsonValue(metadataJson, '--metadata-json');
    return input;
}
