import { buildRouteMap } from '@stricli/core'

import {
  booleanFlags,
  createWorkspace,
  listWorkspaces,
  makeCommand,
  openWorkspace,
  writeJson,
} from './valedictorian-cli.command-runtime.js'

export function buildWorkspacesRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage local workspaces' },
    routes: {
      create: makeCommand({
        docs: { brief: 'Create a workspace at a path' },
        positionalCount: 1,
        run: async (context, _flags, workspacePath) => {
          writeJson(context, await createWorkspace(context, workspacePath))
        },
      }),
      list: makeCommand({
        docs: { brief: 'List registered workspaces' },
        run: async (context) => {
          writeJson(context, await listWorkspaces(context))
        },
      }),
      open: makeCommand({
        docs: { brief: 'Open a folder as a workspace' },
        flags: booleanFlags(['rekey']),
        positionalCount: 1,
        run: async (context, flags, workspacePath) => {
          writeJson(context, await openWorkspace(context, workspacePath, flags.rekey === true))
        },
      }),
    },
  })
}
