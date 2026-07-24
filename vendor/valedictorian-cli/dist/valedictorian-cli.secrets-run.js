import { createSecretReference, LocalSecretResolutionHttpError, localSecretResolutionErrorBodies, localSecretResolutionErrorBodySchema, localSecretResolutionErrorStatusByCode, parseSecretReferenceUri, ValedictorianHttpError, ValedictorianProtocolError, ValedictorianTransportError, } from '@sparxie/sdk';
import { optionValue, workspaceClient, } from './valedictorian-cli.command-runtime.js';
import { CliOwnedFailure, CliUsageError } from './valedictorian-cli.failures.js';
import { parseStrictNonNegativeIntegerOption } from './valedictorian-cli.parser-options.js';
import { readRequiredText } from './valedictorian-cli.parsers.js';
import { redactExactValues } from './valedictorian-cli.secrets-redact.js';
import { defaultSecretsRunSpawn, } from './valedictorian-cli.secrets-run-spawn.js';
export async function runSecretsRunCommand(context, flags, commandArgv) {
    const resolvedValues = [];
    let spawnRequest;
    let injectedEnvNames = [];
    let phase = 'local';
    try {
        const plan = parseSecretsRunPlan(flags, commandArgv, {
            argvEscapeSuffix: context.argvEscapeSuffix,
        });
        const workspaceSelector = requireWorkspaceSelector(flags);
        phase = 'remote';
        const capabilities = await context.client.capabilities.get();
        if (!capabilities.localSecretResolution) {
            throw new LocalSecretResolutionHttpError(localSecretResolutionErrorBodies.local_secret_resolution_unsupported, localSecretResolutionErrorStatusByCode.local_secret_resolution_unsupported);
        }
        const workspace = await workspaceClient(context, {
            ...flags,
            workspace: workspaceSelector,
        });
        const resolvedByUri = new Map();
        for (const referenceUri of plan.uniqueReferenceUris) {
            const resolved = await workspace.secrets.local.resolve({
                reference: createSecretReference(parseSecretReferenceUri(referenceUri)),
                purpose: { kind: 'subprocess_injection' },
            });
            resolvedByUri.set(referenceUri, resolved.value);
            resolvedValues.push(resolved.value);
        }
        spawnRequest = buildSpawnRequest(plan, resolvedByUri, context.env);
        injectedEnvNames = plan.injections
            .filter((injection) => injection.kind === 'env')
            .map((injection) => injection.name);
        resolvedByUri.clear();
        phase = 'spawn';
        assertSpawnableEnvironment(spawnRequest.env);
        const spawn = context.secretsRunSpawn ?? defaultSecretsRunSpawn;
        const result = await spawn(spawnRequest);
        context.process.exitCode = result.exitCode;
    }
    catch (error) {
        throw redactAndRethrowError(error, resolvedValues, phase);
    }
    finally {
        if (spawnRequest) {
            scrubSpawnRequest(spawnRequest, injectedEnvNames);
        }
        for (let index = 0; index < resolvedValues.length; index += 1) {
            resolvedValues[index] = '';
        }
        resolvedValues.length = 0;
        injectedEnvNames = [];
        spawnRequest = undefined;
    }
}
function scrubSpawnRequest(request, injectedEnvNames) {
    for (const name of injectedEnvNames) {
        delete request.env[name];
    }
    if (request.stdin !== 'ignore') {
        request.stdin.value = '';
    }
    request.fdValues.clear();
}
function requireWorkspaceSelector(flags) {
    return readRequiredText(optionValue(flags, 'workspace'), '--workspace');
}
function buildSpawnRequest(plan, resolvedByUri, parentEnv) {
    const env = { ...definedEnv(parentEnv) };
    const fdValues = new Map();
    let stdin = 'ignore';
    for (const injection of plan.injections) {
        const value = resolvedByUri.get(injection.referenceUri);
        if (value === undefined) {
            throw new CliUsageError(`secrets run missing resolved value for ${injection.referenceUri}`);
        }
        if (injection.kind === 'env') {
            removeCaseInsensitiveEnvKeys(env, injection.name);
            env[injection.name] = value;
            continue;
        }
        if (injection.kind === 'fd') {
            fdValues.set(injection.fd, value);
            continue;
        }
        stdin = { value };
    }
    return {
        executable: plan.executable,
        argv: plan.argv,
        env,
        shell: false,
        stdin,
        fdValues,
    };
}
function removeCaseInsensitiveEnvKeys(env, name) {
    const target = name.toLowerCase();
    for (const existing of Object.keys(env)) {
        if (existing.toLowerCase() === target) {
            delete env[existing];
        }
    }
}
class SecretsRunOwnedError extends CliOwnedFailure {
}
function assertSpawnableEnvironment(env) {
    for (const value of Object.values(env)) {
        if (typeof value === 'string' && value.includes('\0')) {
            throw Object.assign(new Error('secrets run environment value contains a NUL byte'), {
                code: 'EINVAL',
            });
        }
    }
}
function redactAndRethrowError(error, resolvedValues, phase) {
    if (error instanceof CliOwnedFailure) {
        throw error;
    }
    if (error instanceof CliUsageError) {
        throw new CliOwnedFailure({
            code: 'secrets_run_invalid_usage',
            kind: 'validation',
            message: error.message,
        });
    }
    if (phase === 'spawn') {
        throw new SecretsRunOwnedError({
            code: 'secrets_run_spawn_failed',
            kind: 'internal',
            message: 'secrets run spawn failed',
        });
    }
    const typed = asLocalSecretResolutionError(error);
    if (typed) {
        throw typed;
    }
    if (phase === 'remote') {
        if (error instanceof ValedictorianTransportError
            || error instanceof ValedictorianProtocolError
            || error instanceof ValedictorianHttpError) {
            throw error;
        }
        throw new SecretsRunOwnedError({
            code: 'secrets_run_remote_failed',
            kind: 'unavailable',
            message: 'Remote secrets run request failed',
        });
    }
    const message = redactExactValues(error instanceof Error ? error.message : String(error), resolvedValues);
    throw new CliOwnedFailure({
        code: 'secrets_run_invalid_usage',
        kind: 'validation',
        message,
    });
}
function asLocalSecretResolutionError(error) {
    if (!(error instanceof ValedictorianHttpError)) {
        return null;
    }
    const parsed = localSecretResolutionErrorBodySchema.safeParse(error.body);
    if (!parsed.success) {
        return null;
    }
    if (localSecretResolutionErrorStatusByCode[parsed.data.code] !== error.status) {
        return null;
    }
    if (error instanceof LocalSecretResolutionHttpError) {
        return error;
    }
    return new LocalSecretResolutionHttpError(parsed.data, error.status);
}
export function parseSecretsRunPlan(flags, commandArgv, options = {}) {
    const injections = [];
    const envNames = new Set();
    const fdNumbers = new Set();
    const stdinRaw = optionValue(flags, 'stdin-secret');
    if (stdinRaw !== undefined) {
        if (Array.isArray(flags['stdin-secret'])) {
            throw new CliUsageError('secrets run accepts at most one --stdin-secret');
        }
        const referenceUri = readRequiredSecretUri(stdinRaw, '--stdin-secret');
        injections.push({
            kind: 'stdin',
            referenceUri,
            reference: createSecretReference(parseSecretReferenceUri(referenceUri)),
        });
    }
    for (const assignment of readStringList(flags.env)) {
        const parsed = parseNamedAssignment(assignment, '--env');
        const portableName = requirePortableEnvironmentName(parsed.name);
        const duplicateKey = portableName.toLowerCase();
        if (envNames.has(duplicateKey)) {
            throw new CliUsageError(`secrets run duplicate environment name: ${parsed.name}`);
        }
        envNames.add(duplicateKey);
        injections.push({
            kind: 'env',
            name: portableName,
            referenceUri: parsed.referenceUri,
            reference: createSecretReference(parseSecretReferenceUri(parsed.referenceUri)),
        });
    }
    for (const assignment of readStringList(flags.fd)) {
        const parsed = parseFdAssignment(assignment);
        if (fdNumbers.has(parsed.fd)) {
            throw new CliUsageError(`secrets run duplicate file descriptor: ${parsed.fd}`);
        }
        fdNumbers.add(parsed.fd);
        injections.push({
            kind: 'fd',
            fd: parsed.fd,
            referenceUri: parsed.referenceUri,
            reference: createSecretReference(parseSecretReferenceUri(parsed.referenceUri)),
        });
    }
    if (injections.length === 0) {
        throw new CliUsageError('secrets run requires at least one injection destination (--env, --fd, or --stdin-secret)');
    }
    requireExactEscapeSuffix(commandArgv, options.argvEscapeSuffix);
    if (commandArgv.length === 0) {
        throw new CliUsageError('secrets run requires an executable after --');
    }
    const [executable, ...argv] = commandArgv;
    if (executable === undefined || executable.length === 0) {
        throw new CliUsageError('secrets run requires a nonempty executable after --');
    }
    const uniqueReferenceUris = [...new Set(injections.map((item) => item.referenceUri))];
    return {
        executable,
        argv,
        injections,
        uniqueReferenceUris,
    };
}
function requireExactEscapeSuffix(commandArgv, argvEscapeSuffix) {
    if (argvEscapeSuffix == null) {
        throw new CliUsageError('secrets run requires an executable after --');
    }
    if (commandArgv.length !== argvEscapeSuffix.length ||
        commandArgv.some((token, index) => token !== argvEscapeSuffix[index])) {
        throw new CliUsageError('secrets run requires the child executable and argv immediately after -- with no positional tokens before the escape marker');
    }
}
function readStringList(value) {
    if (value === undefined) {
        return [];
    }
    if (Array.isArray(value)) {
        return value.map(String);
    }
    return [String(value)];
}
function parseNamedAssignment(assignment, flagName) {
    const separator = assignment.indexOf('=');
    if (separator <= 0) {
        throw new CliUsageError(`${flagName} requires NAME=secret://key assignment`);
    }
    const name = assignment.slice(0, separator);
    const referenceUri = assignment.slice(separator + 1);
    if (!name || !referenceUri) {
        throw new CliUsageError(`${flagName} requires NAME=secret://key assignment`);
    }
    return {
        name,
        referenceUri: readRequiredSecretUri(referenceUri, flagName),
    };
}
const PORTABLE_ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function requirePortableEnvironmentName(name) {
    if (!PORTABLE_ENVIRONMENT_NAME.test(name)) {
        throw new CliUsageError('secrets run environment names must be portable ([A-Za-z_][A-Za-z0-9_]*)');
    }
    return name;
}
const SECRETS_RUN_MIN_DEDICATED_FD = 3;
const SECRETS_RUN_MAX_DEDICATED_FD = 255;
function parseFdAssignment(assignment) {
    const separator = assignment.indexOf('=');
    if (separator <= 0) {
        throw new CliUsageError(`--fd requires N=secret://key assignment where N is an integer ${SECRETS_RUN_MIN_DEDICATED_FD}..${SECRETS_RUN_MAX_DEDICATED_FD}`);
    }
    const fdRaw = assignment.slice(0, separator);
    const referenceUri = assignment.slice(separator + 1);
    if (!/^[0-9]+$/.test(fdRaw)) {
        throw new CliUsageError(`--fd requires N=secret://key assignment where N is an integer ${SECRETS_RUN_MIN_DEDICATED_FD}..${SECRETS_RUN_MAX_DEDICATED_FD}`);
    }
    const fd = parseStrictNonNegativeIntegerOption(fdRaw, '--fd');
    if (!Number.isInteger(fd) ||
        fd < SECRETS_RUN_MIN_DEDICATED_FD ||
        fd > SECRETS_RUN_MAX_DEDICATED_FD) {
        throw new CliUsageError(`secrets run file descriptors must be integers ${SECRETS_RUN_MIN_DEDICATED_FD}..${SECRETS_RUN_MAX_DEDICATED_FD}`);
    }
    return {
        fd,
        referenceUri: readRequiredSecretUri(referenceUri, '--fd'),
    };
}
function readRequiredSecretUri(value, label) {
    try {
        parseSecretReferenceUri(value);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CliUsageError(`malformed secret reference for ${label}: ${detail}`);
    }
    return value;
}
function definedEnv(env) {
    const output = {};
    for (const [name, value] of Object.entries(env)) {
        if (value !== undefined) {
            output[name] = value;
        }
    }
    return output;
}
