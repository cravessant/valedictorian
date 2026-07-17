import fs from 'node:fs'
import { buildRouteMap } from '@stricli/core'
import { type UpsertProfileSecretInput } from 'sparxie'

import {
  makeCommand,
  optionFlags,
  optionValue,
  parseProfileSecretKind,
  requiredOption,
  workspaceClient,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import { readRequiredText } from './valedictorian-cli.parsers.js'
import { runSecretsRunCommand } from './valedictorian-cli.secrets-run.js'

export function buildSecretsRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage credential secrets and local injection' },
    routes: {
      delete: makeCommand({
        docs: { brief: 'Delete a credential secret' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, key) => {
          const client = await workspaceClient(context, flags)

          await client.secrets.delete(key)
          writeJson(context, { ok: true })
        },
      }),
      list: makeCommand({
        docs: { brief: 'List credential secret summaries' },
        flags: optionFlags(['workspace']),
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          writeJson(context, await client.secrets.list())
        },
      }),
      run: makeSecretsRunCommand(),
      upsert: makeCommand({
        docs: {
          brief: 'Create or update a credential secret from a value file',
          fullDescription: 'Stores a secret value and prints only the non-secret summary.',
        },
        flags: optionFlags(['workspace'], ['kind', 'label', 'value-file']),
        positionalCount: 1,
        run: async (context, flags, key) => {
          const client = await workspaceClient(context, flags)
          const input: UpsertProfileSecretInput = {
            key,
            kind: parseProfileSecretKind(requiredOption(flags, 'kind', '--kind value')),
            label: readRequiredText(optionValue(flags, 'label'), '--label value'),
            value: fs.readFileSync(
              readRequiredText(optionValue(flags, 'value-file'), '--value-file path'),
              'utf8',
            ),
          }

          writeJson(context, await client.secrets.upsert(input))
        },
      }),
    },
  })
}

function makeSecretsRunCommand() {
  return makeCommand({
    docs: {
      brief: 'Resolve structured secret references into a local child process',
      fullDescription:
        'Requires at least one explicit injection destination. Pass the executable and argv after --.',
    },
    flags: {
      ...optionFlags(['workspace', 'stdin-secret']),
      ...variadicOptionFlags(['env', 'fd']),
    },
    positionalCount: { minimum: 0, maximum: Number.POSITIVE_INFINITY },
    run: async (context, flags, ...commandArgv) => {
      await runSecretsRunCommand(context, flags, commandArgv)
    },
  })
}

function variadicOptionFlags(names: string[]) {
  const result: Record<string, unknown> = {}

  for (const name of names) {
    result[name] = {
      brief: readableOptionName(name),
      kind: 'parsed',
      optional: true,
      parse: (input: string) => input,
      variadic: true,
    }
  }

  return result
}

function readableOptionName(name: string) {
  return name.replace(/-/g, ' ')
}
