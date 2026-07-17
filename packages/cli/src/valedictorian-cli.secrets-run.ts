import {
  createSecretReference,
  LocalSecretResolutionHttpError,
  localSecretResolutionErrorBodies,
  localSecretResolutionErrorBodySchema,
  localSecretResolutionErrorStatusByCode,
  parseSecretReferenceUri,
  ValedictorianHttpError,
  type SecretReference,
} from 'sparxie'

import {
  optionValue,
  workspaceClient,
  type RawFlags,
  type ValedictorianCliContext,
} from './valedictorian-cli.command-runtime.js'
import { readRequiredText } from './valedictorian-cli.parsers.js'
import { redactExactValues } from './valedictorian-cli.secrets-redact.js'
import {
  defaultSecretsRunSpawn,
  type SecretsRunSpawnAdapter,
  type SecretsRunSpawnRequest,
} from './valedictorian-cli.secrets-run-spawn.js'

export interface SecretsRunEnvInjection {
  readonly kind: 'env'
  readonly name: string
  readonly referenceUri: string
  readonly reference: SecretReference
}

export interface SecretsRunFdInjection {
  readonly kind: 'fd'
  readonly fd: number
  readonly referenceUri: string
  readonly reference: SecretReference
}

export interface SecretsRunStdinInjection {
  readonly kind: 'stdin'
  readonly referenceUri: string
  readonly reference: SecretReference
}

export type SecretsRunInjection =
  | SecretsRunEnvInjection
  | SecretsRunFdInjection
  | SecretsRunStdinInjection

export interface SecretsRunPlan {
  readonly executable: string
  readonly argv: readonly string[]
  readonly injections: readonly SecretsRunInjection[]
  readonly uniqueReferenceUris: readonly string[]
}

export async function runSecretsRunCommand(
  context: ValedictorianCliContext,
  flags: RawFlags,
  commandArgv: readonly string[],
): Promise<void> {
  const asJson = context.outputJson === true
  const resolvedValues: string[] = []
  let spawnRequest: SecretsRunSpawnRequest | undefined
  let injectedEnvNames: string[] = []
  let phase: 'local' | 'remote' | 'spawn' = 'local'

  try {
    const plan = parseSecretsRunPlan(flags, commandArgv, {
      argvEscapeSuffix: context.argvEscapeSuffix,
    })
    const workspaceSelector = requireWorkspaceSelector(flags)

    phase = 'remote'
    const capabilities = await context.client.capabilities.get()
    if (!capabilities.localSecretResolution) {
      throw formatSecretsRunError(
        localSecretResolutionErrorBodies.local_secret_resolution_unsupported,
        asJson,
      )
    }

    const workspace = await workspaceClient(context, {
      ...flags,
      workspace: workspaceSelector,
    })
    const resolvedByUri = new Map<string, string>()

    for (const referenceUri of plan.uniqueReferenceUris) {
      const resolved = await workspace.secrets.local.resolve({
        reference: createSecretReference(parseSecretReferenceUri(referenceUri)),
        purpose: { kind: 'subprocess_injection' },
      })
      resolvedByUri.set(referenceUri, resolved.value)
      resolvedValues.push(resolved.value)
    }

    spawnRequest = buildSpawnRequest(plan, resolvedByUri, context.env)
    injectedEnvNames = plan.injections
      .filter((injection): injection is SecretsRunEnvInjection => injection.kind === 'env')
      .map((injection) => injection.name)
    resolvedByUri.clear()

    phase = 'spawn'
    assertSpawnableEnvironment(spawnRequest.env)
    const spawn = context.secretsRunSpawn ?? defaultSecretsRunSpawn
    const result = await spawn(spawnRequest)
    context.process.exitCode = result.exitCode
  } catch (error) {
    throw redactAndFormatError(error, resolvedValues, asJson, phase)
  } finally {
    if (spawnRequest) {
      scrubSpawnRequest(spawnRequest, injectedEnvNames)
    }
    for (let index = 0; index < resolvedValues.length; index += 1) {
      resolvedValues[index] = ''
    }
    resolvedValues.length = 0
    injectedEnvNames = []
    spawnRequest = undefined
  }
}

function scrubSpawnRequest(
  request: SecretsRunSpawnRequest,
  injectedEnvNames: readonly string[],
): void {
  for (const name of injectedEnvNames) {
    delete request.env[name]
  }
  if (request.stdin !== 'ignore') {
    request.stdin.value = ''
  }
  request.fdValues.clear()
}

function requireWorkspaceSelector(flags: RawFlags): string {
  return readRequiredText(optionValue(flags, 'workspace'), '--workspace')
}

function buildSpawnRequest(
  plan: SecretsRunPlan,
  resolvedByUri: ReadonlyMap<string, string>,
  parentEnv: Record<string, string | undefined>,
): SecretsRunSpawnRequest {
  const env: NodeJS.ProcessEnv = { ...definedEnv(parentEnv) }
  const fdValues = new Map<number, string>()
  let stdin: SecretsRunSpawnRequest['stdin'] = 'ignore'

  for (const injection of plan.injections) {
    const value = resolvedByUri.get(injection.referenceUri)
    if (value === undefined) {
      throw new Error(`secrets run missing resolved value for ${injection.referenceUri}`)
    }

    if (injection.kind === 'env') {
      removeCaseInsensitiveEnvKeys(env, injection.name)
      env[injection.name] = value
      continue
    }

    if (injection.kind === 'fd') {
      fdValues.set(injection.fd, value)
      continue
    }

    stdin = { value }
  }

  return {
    executable: plan.executable,
    argv: plan.argv,
    env,
    shell: false,
    stdin,
    fdValues,
  }
}

function removeCaseInsensitiveEnvKeys(env: NodeJS.ProcessEnv, name: string): void {
  const target = name.toLowerCase()
  for (const existing of Object.keys(env)) {
    if (existing.toLowerCase() === target) {
      delete env[existing]
    }
  }
}

class SecretsRunFormattedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsRunFormattedError'
  }
}

function assertSpawnableEnvironment(env: NodeJS.ProcessEnv): void {
  for (const value of Object.values(env)) {
    if (typeof value === 'string' && value.includes('\0')) {
      throw Object.assign(new Error('secrets run environment value contains a NUL byte'), {
        code: 'EINVAL',
      })
    }
  }
}

function redactAndFormatError(
  error: unknown,
  resolvedValues: readonly string[],
  asJson: boolean,
  phase: 'local' | 'remote' | 'spawn',
): Error {
  if (error instanceof SecretsRunFormattedError) {
    return error
  }

  if (phase === 'spawn') {
    return formatWrapperOwnedError(
      { code: 'secrets_run_spawn_failed', message: spawnPhaseDiagnosticMessage(error) },
      asJson,
    )
  }

  const typed = asLocalSecretResolutionError(error)
  if (typed) {
    return formatSecretsRunError(typed.body, asJson)
  }

  const message = redactExactValues(
    error instanceof Error ? error.message : String(error),
    resolvedValues,
  )

  if (phase === 'local') {
    return formatWrapperOwnedError(
      { code: 'secrets_run_invalid_usage', message },
      asJson,
    )
  }

  return formatWrapperOwnedError(
    {
      code: 'secrets_run_remote_failed',
      message: 'Remote secrets run request failed',
    },
    asJson,
  )
}

function spawnPhaseDiagnosticMessage(_error: unknown): string {
  return 'secrets run spawn failed'
}

function formatWrapperOwnedError(
  body: { code: string; message: string },
  asJson: boolean,
): Error {
  if (asJson) {
    return new SecretsRunFormattedError(JSON.stringify(body, null, 2))
  }
  return new SecretsRunFormattedError(body.message)
}

function asLocalSecretResolutionError(error: unknown): LocalSecretResolutionHttpError | null {
  if (!(error instanceof ValedictorianHttpError)) {
    return null
  }

  const parsed = localSecretResolutionErrorBodySchema.safeParse(error.body)
  if (!parsed.success) {
    return null
  }

  if (localSecretResolutionErrorStatusByCode[parsed.data.code] !== error.status) {
    return null
  }

  if (error instanceof LocalSecretResolutionHttpError) {
    return error
  }

  return new LocalSecretResolutionHttpError(parsed.data, error.status)
}

function formatSecretsRunError(
  body: { code: string; message: string },
  asJson: boolean,
): Error {
  if (asJson) {
    return new SecretsRunFormattedError(JSON.stringify(body, null, 2))
  }
  return new SecretsRunFormattedError(`${body.code}: ${body.message}`)
}

export function parseSecretsRunPlan(
  flags: RawFlags,
  commandArgv: readonly string[],
  options: { argvEscapeSuffix?: readonly string[] | null } = {},
): SecretsRunPlan {
  const injections: SecretsRunInjection[] = []
  const envNames = new Set<string>()
  const fdNumbers = new Set<number>()

  const stdinRaw = optionValue(flags, 'stdin-secret')
  if (stdinRaw !== undefined) {
    if (Array.isArray(flags['stdin-secret'])) {
      throw new Error('secrets run accepts at most one --stdin-secret')
    }
    const referenceUri = readRequiredSecretUri(stdinRaw, '--stdin-secret')
    injections.push({
      kind: 'stdin',
      referenceUri,
      reference: createSecretReference(parseSecretReferenceUri(referenceUri)),
    })
  }

  for (const assignment of readStringList(flags.env)) {
    const parsed = parseNamedAssignment(assignment, '--env')
    const portableName = requirePortableEnvironmentName(parsed.name)
    const duplicateKey = portableName.toLowerCase()
    if (envNames.has(duplicateKey)) {
      throw new Error(`secrets run duplicate environment name: ${parsed.name}`)
    }
    envNames.add(duplicateKey)
    injections.push({
      kind: 'env',
      name: portableName,
      referenceUri: parsed.referenceUri,
      reference: createSecretReference(parseSecretReferenceUri(parsed.referenceUri)),
    })
  }

  for (const assignment of readStringList(flags.fd)) {
    const parsed = parseFdAssignment(assignment)
    if (fdNumbers.has(parsed.fd)) {
      throw new Error(`secrets run duplicate file descriptor: ${parsed.fd}`)
    }
    fdNumbers.add(parsed.fd)
    injections.push({
      kind: 'fd',
      fd: parsed.fd,
      referenceUri: parsed.referenceUri,
      reference: createSecretReference(parseSecretReferenceUri(parsed.referenceUri)),
    })
  }

  if (injections.length === 0) {
    throw new Error(
      'secrets run requires at least one injection destination (--env, --fd, or --stdin-secret)',
    )
  }

  requireExactEscapeSuffix(commandArgv, options.argvEscapeSuffix)

  if (commandArgv.length === 0) {
    throw new Error('secrets run requires an executable after --')
  }

  const [executable, ...argv] = commandArgv
  if (executable === undefined || executable.length === 0) {
    throw new Error('secrets run requires a nonempty executable after --')
  }

  const uniqueReferenceUris = [...new Set(injections.map((item) => item.referenceUri))]

  return {
    executable,
    argv,
    injections,
    uniqueReferenceUris,
  }
}

function requireExactEscapeSuffix(
  commandArgv: readonly string[],
  argvEscapeSuffix: readonly string[] | null | undefined,
): void {
  if (argvEscapeSuffix == null) {
    throw new Error('secrets run requires an executable after --')
  }

  if (
    commandArgv.length !== argvEscapeSuffix.length ||
    commandArgv.some((token, index) => token !== argvEscapeSuffix[index])
  ) {
    throw new Error(
      'secrets run requires the child executable and argv immediately after -- with no positional tokens before the escape marker',
    )
  }
}

function readStringList(value: unknown): string[] {
  if (value === undefined) {
    return []
  }
  if (Array.isArray(value)) {
    return value.map(String)
  }
  return [String(value)]
}

function parseNamedAssignment(assignment: string, flagName: string) {
  const separator = assignment.indexOf('=')
  if (separator <= 0) {
    throw new Error(`${flagName} requires NAME=secret://key assignment`)
  }

  const name = assignment.slice(0, separator)
  const referenceUri = assignment.slice(separator + 1)
  if (!name || !referenceUri) {
    throw new Error(`${flagName} requires NAME=secret://key assignment`)
  }

  return {
    name,
    referenceUri: readRequiredSecretUri(referenceUri, flagName),
  }
}

const PORTABLE_ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function requirePortableEnvironmentName(name: string): string {
  if (!PORTABLE_ENVIRONMENT_NAME.test(name)) {
    throw new Error(
      'secrets run environment names must be portable ([A-Za-z_][A-Za-z0-9_]*)',
    )
  }
  return name
}

const SECRETS_RUN_MIN_DEDICATED_FD = 3
const SECRETS_RUN_MAX_DEDICATED_FD = 255

function parseFdAssignment(assignment: string) {
  const separator = assignment.indexOf('=')
  if (separator <= 0) {
    throw new Error(
      `--fd requires N=secret://key assignment where N is an integer ${SECRETS_RUN_MIN_DEDICATED_FD}..${SECRETS_RUN_MAX_DEDICATED_FD}`,
    )
  }

  const fdRaw = assignment.slice(0, separator)
  const referenceUri = assignment.slice(separator + 1)
  if (!/^[0-9]+$/.test(fdRaw)) {
    throw new Error(
      `--fd requires N=secret://key assignment where N is an integer ${SECRETS_RUN_MIN_DEDICATED_FD}..${SECRETS_RUN_MAX_DEDICATED_FD}`,
    )
  }

  const fd = Number(fdRaw)
  if (
    !Number.isInteger(fd) ||
    fd < SECRETS_RUN_MIN_DEDICATED_FD ||
    fd > SECRETS_RUN_MAX_DEDICATED_FD
  ) {
    throw new Error(
      `secrets run file descriptors must be integers ${SECRETS_RUN_MIN_DEDICATED_FD}..${SECRETS_RUN_MAX_DEDICATED_FD}`,
    )
  }

  return {
    fd,
    referenceUri: readRequiredSecretUri(referenceUri, '--fd'),
  }
}

function readRequiredSecretUri(value: string, label: string): string {
  try {
    parseSecretReferenceUri(value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`malformed secret reference for ${label}: ${detail}`)
  }
  return value
}

function definedEnv(env: Record<string, string | undefined>) {
  const output: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      output[name] = value
    }
  }
  return output
}

export type { SecretsRunSpawnAdapter }
