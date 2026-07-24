import fs from 'node:fs';
import { buildCommand, } from '@stricli/core';
import { parseValedictorianContractValue, profileSecretKinds, workspaceListItemSchema, workspaceListResultSchema, } from '@sparxie/sdk';
import { CliOwnedFailure, CliUsageError, presentCliFailure, } from './valedictorian-cli.failures.js';
import { formatHumanOutput } from './valedictorian-cli.output.js';
import { parseStrictIntegerOption, parseStrictJsonObject, } from './valedictorian-cli.parser-options.js';
import { readRequiredText } from './valedictorian-cli.parsers.js';
import { requestValedictorianJson } from './valedictorian-cli.request.js';
import { isLocalApiUrl, readLocalWorkspaceList } from './valedictorian-cli.workspaces.js';
export { mapStricliExitCode } from './valedictorian-cli.failures.js';
const stringParser = (input) => input;
const jsonFlag = {
    brief: 'Output as JSON.',
    kind: 'boolean',
    optional: true,
};
export function makeCommand({ docs, flags = {}, positionalCount = 0, run, }) {
    const positionalBounds = typeof positionalCount === 'number'
        ? positionalCount > 0
            ? { minimum: positionalCount, maximum: positionalCount }
            : null
        : {
            minimum: positionalCount.minimum,
            ...(positionalCount.maximum === undefined ||
                !Number.isFinite(positionalCount.maximum)
                ? {}
                : { maximum: positionalCount.maximum }),
        };
    const parameters = {
        flags: {
            json: jsonFlag,
            ...flags,
        },
        ...(positionalBounds
            ? {
                positional: {
                    kind: 'array',
                    ...positionalBounds,
                    parameter: {
                        brief: 'Command argument',
                        parse: stringParser,
                        placeholder: 'argument',
                    },
                },
            }
            : {}),
    };
    return buildCommand({
        docs,
        parameters,
        func: async function command(flags, ...args) {
            this.outputJson = flags.json === true;
            try {
                await run(this, flags, ...args);
            }
            catch (error) {
                const presented = presentCliFailure(error, {
                    asJson: this.outputJson === true,
                    operation: docs.brief,
                });
                this.process.stderr.write(presented.text);
                this.process.exitCode = presented.exitCode;
            }
        },
    });
}
export function optionFlags(optional = [], required = []) {
    const result = {};
    for (const name of optional) {
        result[name] = {
            brief: readableOptionName(name),
            kind: 'parsed',
            optional: true,
            parse: stringParser,
        };
    }
    for (const name of required) {
        result[name] = {
            brief: readableOptionName(name),
            kind: 'parsed',
            parse: stringParser,
        };
    }
    return result;
}
export function booleanFlags(names) {
    const result = {};
    for (const name of names) {
        result[name] = {
            brief: readableOptionName(name),
            kind: 'boolean',
            optional: true,
        };
    }
    return result;
}
function toArgv(flags) {
    const argv = [];
    for (const [name, value] of Object.entries(flags)) {
        if (name === 'json' || value === undefined || value === false) {
            continue;
        }
        const option = `--${name}`;
        if (value === true) {
            argv.push(option);
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                argv.push(option, String(item));
            }
            continue;
        }
        argv.push(option, String(value));
    }
    return argv;
}
export function toArgvWithoutWorkspace(flags) {
    const { workspace: _workspace, ...rest } = flags;
    return toArgv(rest);
}
export async function workspaceClient(context, flags) {
    return (await workspaceClientWithId(context, flags)).client;
}
export async function workspaceClientWithId(context, flags) {
    const workspaceId = await resolveWorkspaceId(context, readRequiredText(optionValue(flags, 'workspace'), '--workspace'));
    return { client: context.client.forWorkspace(workspaceId), workspaceId };
}
export async function workspaceConnectorClient(context, flags) {
    return (await workspaceClient(context, flags)).connectors;
}
async function resolveWorkspaceId(context, selector) {
    if (looksLikeWorkspaceId(selector)) {
        return selector;
    }
    const result = (await listWorkspaces(context));
    const workspaces = Array.isArray(result.items) ? result.items : [];
    const idMatch = workspaces.find((workspace) => workspace.id === selector);
    if (idMatch) {
        return idMatch.id;
    }
    const exactNameMatches = workspaces.filter((workspace) => workspace.name === selector);
    if (exactNameMatches.length === 1) {
        return exactNameMatches[0].id;
    }
    if (exactNameMatches.length > 1) {
        throw new CliUsageError(formatAmbiguousWorkspaceError(selector, exactNameMatches));
    }
    const lowerSelector = selector.toLocaleLowerCase();
    const caseInsensitiveMatches = workspaces.filter((workspace) => workspace.name.toLocaleLowerCase() === lowerSelector);
    if (caseInsensitiveMatches.length === 1) {
        return caseInsensitiveMatches[0].id;
    }
    if (caseInsensitiveMatches.length > 1) {
        throw new CliUsageError(formatAmbiguousWorkspaceError(selector, caseInsensitiveMatches));
    }
    throw new CliOwnedFailure({
        code: 'workspace_not_found',
        kind: 'not_found',
        message: `Workspace not found: ${selector}`,
    });
}
function looksLikeWorkspaceId(selector) {
    return (/^workspace[-_]/i.test(selector) ||
        /^ws[-_]/i.test(selector) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selector));
}
function formatAmbiguousWorkspaceError(selector, workspaces) {
    return `Workspace name is ambiguous: ${selector}. Rerun with an id: ${workspaces
        .map((workspace) => `${workspace.name} (${workspace.id})`)
        .join(', ')}`;
}
export async function listWorkspaces(context) {
    try {
        return parseValedictorianContractValue(workspaceListResultSchema, await requestJson(context, '/v1/workspaces'));
    }
    catch (error) {
        const localWorkspaces = isLocalApiUrl(context.apiBaseUrl)
            ? readLocalWorkspaceList(context.env)
            : null;
        if (localWorkspaces) {
            return localWorkspaces;
        }
        throw error;
    }
}
export async function openWorkspace(context, path, rekey) {
    const input = rekey ? { path, rekey } : { path };
    return parseValedictorianContractValue(workspaceListItemSchema, await requestJson(context, '/v1/workspaces/open', {
        body: input,
        method: 'POST',
    }));
}
export async function createWorkspace(context, path) {
    return parseValedictorianContractValue(workspaceListItemSchema, await requestJson(context, '/v1/workspaces/create', {
        body: { path },
        method: 'POST',
    }));
}
async function requestJson(context, path, options = {}) {
    return requestValedictorianJson({
        apiBaseUrl: context.apiBaseUrl,
        apiToken: context.apiToken,
        path,
        body: options.body,
        method: options.method,
        errorSurface: 'workspace',
    });
}
export function optionValue(flags, name) {
    const value = flags[name];
    return typeof value === 'string' ? value : undefined;
}
export function requiredOption(flags, name, label) {
    return readRequiredText(optionValue(flags, name), label);
}
export function parseProfileSecretKind(value) {
    if (profileSecretKinds.includes(value)) {
        return value;
    }
    throw new CliUsageError(`Invalid profile secret kind: ${value}`);
}
export function readJsonObjectFile(path, label) {
    let text;
    try {
        text = fs.readFileSync(path, 'utf8');
    }
    catch {
        throw new CliUsageError(`${label} could not be read`);
    }
    return parseStrictJsonObject(text, label);
}
export function writeJson(context, value, pretty = true, humanOutputOptions) {
    if (isTypedConflictResult(value)) {
        context.process.exitCode = 4;
    }
    if (context.outputJson) {
        context.process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
        return;
    }
    context.process.stdout.write(formatHumanOutput(value, humanOutputOptions));
}
function isTypedConflictResult(value) {
    if (typeof value !== 'object' || value === null || !('status' in value))
        return false;
    const status = value.status;
    if (status === 'duplicate_blocked' || status === 'company_assignment_blocked')
        return true;
    if (status !== 'blocked')
        return false;
    return 'blocker' in value || 'failure' in value;
}
export function normalizeArgv(argv) {
    const normalized = argv[0] === '--' ? argv.slice(1) : [...argv];
    const leadingFlags = [];
    let index = 0;
    while (index < normalized.length) {
        const token = normalized[index];
        if (token === '--json') {
            leadingFlags.push(token);
            index += 1;
            continue;
        }
        if (token === '--workspace') {
            const value = normalized[index + 1];
            if (value === undefined || value.startsWith('--')) {
                return normalized;
            }
            leadingFlags.push(token, value);
            index += 2;
            continue;
        }
        break;
    }
    if (leadingFlags.length > 0) {
        return normalizeLeadingFlags(normalized.slice(index), leadingFlags);
    }
    if (normalized[0] !== '--json') {
        return normalized;
    }
    const withoutGlobalJson = normalized.slice(1);
    if (withoutGlobalJson.length === 0 ||
        withoutGlobalJson[0] === '--help' ||
        withoutGlobalJson[0] === '-h' ||
        withoutGlobalJson[0] === '--version' ||
        withoutGlobalJson[0] === '-v' ||
        withoutGlobalJson.includes('--json')) {
        return withoutGlobalJson;
    }
    return insertBeforeEscape(withoutGlobalJson, ['--json']);
}
/** Exact tokens after the first `--`, or `null` when the marker is absent. */
export function readArgvEscapeSuffix(argv) {
    const escapeIndex = argv.indexOf('--');
    if (escapeIndex === -1) {
        return null;
    }
    return argv.slice(escapeIndex + 1);
}
function normalizeLeadingFlags(argv, leadingFlags) {
    let result = [...argv];
    const commandTokens = tokensBeforeEscape(result);
    const hasGlobalJson = leadingFlags.includes('--json');
    const globalWorkspaceIndex = leadingFlags.indexOf('--workspace');
    const flagsToInsert = [];
    if (hasGlobalJson &&
        result.length > 0 &&
        !isHelpOrVersion(result) &&
        !commandTokens.includes('--json')) {
        flagsToInsert.push('--json');
    }
    if (globalWorkspaceIndex >= 0 &&
        shouldForwardGlobalWorkspace(result) &&
        !commandTokens.includes('--workspace')) {
        flagsToInsert.push('--workspace', leadingFlags[globalWorkspaceIndex + 1]);
    }
    if (flagsToInsert.length === 0) {
        return result;
    }
    return insertBeforeEscape(result, flagsToInsert);
}
function tokensBeforeEscape(argv) {
    const escapeIndex = argv.indexOf('--');
    return escapeIndex === -1 ? argv : argv.slice(0, escapeIndex);
}
function insertBeforeEscape(argv, flags) {
    const escapeIndex = argv.indexOf('--');
    if (escapeIndex === -1) {
        return [...argv, ...flags];
    }
    return [...argv.slice(0, escapeIndex), ...flags, ...argv.slice(escapeIndex)];
}
function isHelpOrVersion(argv) {
    return (argv.length === 0 ||
        argv[0] === '--help' ||
        argv[0] === '-h' ||
        argv[0] === '--version' ||
        argv[0] === '-v');
}
function shouldForwardGlobalWorkspace(argv) {
    if (isHelpOrVersion(argv)) {
        return false;
    }
    return argv[0] !== 'workspaces' && argv[0] !== 'examples';
}
export function parseTimeoutMs(value) {
    if (value === undefined) {
        return 3000;
    }
    const timeoutMs = parseStrictIntegerOption(value, '--timeout-ms');
    if (timeoutMs <= 0) {
        throw new CliUsageError(`Invalid --timeout-ms value: ${value}`);
    }
    return timeoutMs;
}
function readableOptionName(name) {
    return name.replace(/-/g, ' ');
}
export function definedEnv(env) {
    const output = {};
    for (const [name, value] of Object.entries(env)) {
        if (value !== undefined) {
            output[name] = value;
        }
    }
    return output;
}
export async function readPackageVersion() {
    try {
        const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        return packageJson.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
