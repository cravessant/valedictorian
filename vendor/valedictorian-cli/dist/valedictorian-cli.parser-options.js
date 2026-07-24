import { CliUsageError } from './valedictorian-cli.failures.js';
const MAX_LIST_LIMIT = 200;
export function readOption(argv, name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}
export function readRequiredOption(argv, name) {
    return readRequiredArgument(readOption(argv, name), `${name} value`);
}
export function setOptionalStringOption(target, argv, optionName, fieldName) {
    const value = readOption(argv, optionName);
    if (value !== undefined) {
        ;
        target[fieldName] = parseNullableStringOption(value, fieldName);
    }
}
export function setOptionalBooleanOption(target, argv, optionName, fieldName) {
    const value = readOption(argv, optionName);
    if (value !== undefined) {
        ;
        target[fieldName] = parseBooleanValue(value, optionName);
    }
}
export function parseNullableStringOption(value, fieldName) {
    const trimmed = value.trim();
    if (trimmed === 'null') {
        return null;
    }
    if (!trimmed) {
        throw new CliUsageError(`${fieldName} is required`);
    }
    return trimmed;
}
export function parseNullableTimestampOption(value, fieldName) {
    const trimmed = value.trim();
    if (trimmed === 'null') {
        return null;
    }
    const timestamp = trimmed === 'now' ? new Date().toISOString() : trimmed;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || Number.isNaN(new Date(timestamp).getTime())) {
        throw new CliUsageError(`Invalid ${fieldName}: ${value}`);
    }
    return timestamp;
}
export function parseNullableDateStringOption(value, fieldName) {
    const trimmed = value.trim();
    if (trimmed === 'null') {
        return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new CliUsageError(`Invalid ${fieldName}: ${value}`);
    }
    const date = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
        throw new CliUsageError(`Invalid ${fieldName}: ${value}`);
    }
    return trimmed;
}
export function parseBooleanValue(value, optionName) {
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    throw new CliUsageError(`Invalid ${optionName}: expected true or false`);
}
export function parseNumberOption(value, optionName) {
    return parseStrictNumberOption(value, optionName);
}
export function parseStrictIntegerOption(value, optionName) {
    if (!/^(0|[1-9]\d*)$/.test(value) && !/^-(0|[1-9]\d*)$/.test(value)) {
        throw new CliUsageError(`Invalid ${optionName}: ${value}`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
        throw new CliUsageError(`Invalid ${optionName}: ${value}`);
    }
    return number;
}
export function parseStrictNonNegativeIntegerOption(value, optionName) {
    if (!/^(0|[1-9]\d*)$/.test(value)) {
        throw new CliUsageError(`Invalid ${optionName}: ${value}`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new CliUsageError(`Invalid ${optionName}: ${value}`);
    }
    return number;
}
export function parseStrictNumberOption(value, optionName) {
    if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
        throw new CliUsageError(`Invalid ${optionName}: ${value}`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new CliUsageError(`Invalid ${optionName}: ${value}`);
    }
    return number;
}
export function parseStrictJsonValue(value, optionName) {
    if (value.trim().length === 0) {
        throw new CliUsageError(`${optionName} must be valid JSON`);
    }
    try {
        return JSON.parse(value);
    }
    catch {
        throw new CliUsageError(`${optionName} must be valid JSON`);
    }
}
export function parseStrictJsonObject(value, optionName) {
    const parsed = parseStrictJsonValue(value, optionName);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CliUsageError(`${optionName} must be a JSON object`);
    }
    return parsed;
}
export function parseStrictJsonArray(value, optionName) {
    const parsed = parseStrictJsonValue(value, optionName);
    if (!Array.isArray(parsed)) {
        throw new CliUsageError(`${optionName} must be a JSON array`);
    }
    return parsed;
}
export function hasFlag(argv, name) {
    return argv.includes(name);
}
export function hasTextValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
export function assertKnownOptions(argv, allowedOptions) {
    for (const token of argv) {
        if (token.startsWith('--') && !allowedOptions.includes(token)) {
            throw new CliUsageError(`Unknown option: ${token}`);
        }
    }
}
export function assertMutationPatch(input, identityFields, message) {
    const patchKeys = Object.keys(input).filter((key) => !identityFields.includes(key));
    if (patchKeys.length === 0) {
        throw new CliUsageError(message);
    }
}
export function readRequiredText(value, fieldName) {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new CliUsageError(`${fieldName} is required`);
    }
    return trimmed;
}
export function readOptionalText(value, fieldName) {
    if (value === undefined) {
        return undefined;
    }
    return readRequiredText(value, fieldName);
}
export function readRequiredArgument(value, label) {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new CliUsageError(`Missing ${label}`);
    }
    return trimmed;
}
export function validateLimit(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
        throw new CliUsageError(`Invalid --limit: must be between 1 and ${MAX_LIST_LIMIT}`);
    }
}
export function asCliUsage(operation) {
    try {
        return operation();
    }
    catch (error) {
        if (error instanceof CliUsageError)
            throw error;
        if (error instanceof Error)
            throw new CliUsageError(error.message);
        throw new CliUsageError(String(error));
    }
}
export function parseDateOption(optionName, value, boundary) {
    if (!value) {
        throw new CliUsageError(`Missing value for ${optionName}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new CliUsageError(`Invalid date for ${optionName}: ${value}`);
    }
    return parsed.toISOString();
}
