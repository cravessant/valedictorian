import { buildRouteMap } from '@stricli/core';
import { makeCommand, optionFlags, toArgvWithoutWorkspace, workspaceClient, writeJson, } from './valedictorian-cli.command-runtime.js';
import { parseActionQueueListQuery } from './valedictorian-cli.parsers.js';
export function buildActionQueueRoute() {
    return buildRouteMap({
        docs: { brief: 'Inspect action queue items' },
        routes: {
            list: makeCommand({
                docs: { brief: 'List action queue items' },
                flags: optionFlags(['action-bucket', 'limit', 'offset', 'workspace']),
                run: async (context, flags) => {
                    const client = await workspaceClient(context, flags);
                    writeJson(context, await client.actionQueue.list(parseActionQueueListQuery(toArgvWithoutWorkspace(flags))));
                },
            }),
        },
    });
}
