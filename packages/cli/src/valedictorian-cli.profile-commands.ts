import { buildRouteMap } from '@stricli/core'
import {
  ProfileDocumentHttpError,
  ValedictorianHttpError,
  profileDocumentErrorBodySchema,
  profileDocumentErrorStatusByCode,
  type ProfileDocument,
  type ProfileDocumentValidateResult,
  type ProfileUpdateInput,
} from 'sparxie'

import { CliUsageError } from './valedictorian-cli.failures.js'

import {
  booleanFlags,
  makeCommand,
  optionFlags,
  optionValue,
  readJsonObjectFile,
  workspaceClient,
  writeJson,
  type RawFlags,
  type ValedictorianCliContext,
} from './valedictorian-cli.command-runtime.js'
import { readRequiredText } from './valedictorian-cli.parsers.js'

export function buildProfileRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage workspace profile data' },
    routes: {
      'agent-context': makeCommand({
        docs: { brief: 'Get non-secret profile context for agents' },
        flags: optionFlags(['workspace']),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          await withProfileDocumentErrors(context, async () => {
            writeJson(context, await client.profile.agentContext.get())
          })
        },
      }),
      format: makeCommand({
        docs: { brief: 'Format the current profile document' },
        flags: optionFlags(['workspace'], ['expected-revision']),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          const expectedRevision = readRequiredText(
            optionValue(flags, 'expected-revision'),
            '--expected-revision',
          )

          await withProfileDocumentErrors(context, async () => {
            writeProfileDocument(
              context,
              await client.profile.document.format({ expectedRevision }),
            )
          })
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get the versioned profile document' },
        flags: optionFlags(['workspace']),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          await withProfileDocumentErrors(context, async () => {
            writeProfileDocument(context, await client.profile.document.get())
          })
        },
      }),
      restore: makeCommand({
        docs: {
          brief: 'Restore the profile document from backup',
          fullDescription:
            'Requires --confirm. Use --expected-revision null when restoring without a current revision.',
        },
        flags: {
          ...optionFlags(['workspace'], ['expected-revision']),
          ...booleanFlags(['confirm']),
        },
        run: async (context, flags) => {
          if (flags.confirm !== true) {
            throw new CliUsageError('profile restore requires --confirm')
          }

          const client = await workspaceClient(context, flags)
          const expectedRevision = parseRestoreExpectedRevision(flags)

          await withProfileDocumentErrors(context, async () => {
            const restored = await client.profile.document.restore({ expectedRevision })
            writeProfileRestoreResult(context, restored)
          })
        },
      }),
      update: makeCommand({
        docs: {
          brief: 'Update the versioned profile document from a JSON file',
          fullDescription:
            'Requires --expected-revision. Writes the unified public profile patch and returns the new document.',
        },
        flags: optionFlags(['workspace'], ['input-json', 'expected-revision']),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)
          const expectedRevision = readRequiredText(
            optionValue(flags, 'expected-revision'),
            '--expected-revision',
          )
          const profile = readJsonObjectFile<ProfileUpdateInput>(
            readRequiredText(optionValue(flags, 'input-json'), '--input-json path'),
            'profile update input',
          )

          await withProfileDocumentErrors(context, async () => {
            writeProfileDocument(
              context,
              await client.profile.document.update({ expectedRevision, profile }),
            )
          })
        },
      }),
      validate: makeCommand({
        docs: { brief: 'Validate the current profile document' },
        flags: optionFlags(['workspace']),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          await withProfileDocumentErrors(context, async () => {
            writeProfileValidateResult(context, await client.profile.document.validate())
          })
        },
      }),
    },
  })
}

function parseRestoreExpectedRevision(flags: RawFlags): string | null {
  const raw = readRequiredText(optionValue(flags, 'expected-revision'), '--expected-revision')
  if (raw === 'null') {
    return null
  }
  return raw
}

async function withProfileDocumentErrors(
  _context: ValedictorianCliContext,
  operation: () => Promise<void>,
) {
  try {
    await operation()
  } catch (error) {
    const documentError = asProfileDocumentCliError(error)
    if (documentError) {
      throw documentError
    }
    throw error
  }
}

function asProfileDocumentCliError(error: unknown): ProfileDocumentHttpError | null {
  if (error instanceof ProfileDocumentHttpError) {
    return error
  }

  if (!(error instanceof ValedictorianHttpError)) {
    return null
  }

  const parsed = profileDocumentErrorBodySchema.safeParse(error.body)
  if (!parsed.success) {
    return null
  }

  if (profileDocumentErrorStatusByCode[parsed.data.code] !== error.status) {
    return null
  }

  return new ProfileDocumentHttpError(parsed.data, error.status)
}

function writeProfileDocument(context: ValedictorianCliContext, document: ProfileDocument) {
  if (context.outputJson) {
    writeJson(context, document)
    return
  }

  context.process.stdout.write(`${formatProfileDocumentHuman(document)}\n`)
}

function writeProfileValidateResult(
  context: ValedictorianCliContext,
  result: ProfileDocumentValidateResult,
) {
  if (context.outputJson) {
    writeJson(context, result)
    return
  }

  context.process.stdout.write(
    `Profile document is valid (schemaVersion=${result.schemaVersion}, revision=${result.revision})\n`,
  )
}

function writeProfileRestoreResult(context: ValedictorianCliContext, document: ProfileDocument) {
  const result = {
    restored: true as const,
    schemaVersion: document.schemaVersion,
    revision: document.revision,
  }

  if (context.outputJson) {
    writeJson(context, result)
    return
  }

  context.process.stdout.write(
    `Restored profile backup document (schemaVersion=${result.schemaVersion}, revision=${result.revision})\n`,
  )
}

export function formatProfileDocumentHuman(document: ProfileDocument) {
  const lines = [
    `Profile document schemaVersion=${document.schemaVersion} revision=${document.revision}`,
  ]
  const populated = populatedPublicProfileFacts(document.profile)

  if (populated.length === 0) {
    lines.push('No populated public profile facts')
  } else {
    lines.push('Populated public profile facts:')
    for (const [key, value] of populated) {
      lines.push(`  ${key}=${formatFactValue(value)}`)
    }
  }

  return lines.join('\n')
}

function populatedPublicProfileFacts(profile: ProfileDocument['profile']) {
  const entries: Array<[string, unknown]> = []

  for (const [key, value] of Object.entries(profile)) {
    if (key === 'answers' || key === 'education') {
      if (Array.isArray(value) && value.length > 0) {
        entries.push([key, value])
      }
      continue
    }

    if (value === null || value === undefined) {
      continue
    }

    if (typeof value === 'string' && value.trim().length === 0) {
      continue
    }

    entries.push([key, value])
  }

  return entries
}

function formatFactValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}
