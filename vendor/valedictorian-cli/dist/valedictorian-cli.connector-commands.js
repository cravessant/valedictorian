import { buildRouteMap } from '@stricli/core';
import { booleanFlags, makeCommand, optionFlags, toArgvWithoutWorkspace, workspaceConnectorClient, writeJson, } from './valedictorian-cli.command-runtime.js';
import { parseConnectorConfiguration, parseConnectorObservationsList, parseConnectorRunsList, parseConnectorRunTrigger, } from './valedictorian-cli.connector-parsers.js';
import { parseConnectorScheduleUpsert } from './valedictorian-cli.connector-schedule-parsers.js';
export function buildConnectorsRoute() {
    return buildRouteMap({
        docs: { brief: 'Configure and advance continuous connector synchronization' },
        routes: {
            configure: makeCommand({
                docs: { brief: 'Configure continuous connector synchronization' },
                flags: optionFlags([
                    'connector-version',
                    'display-name',
                    'earliest-backfill-date',
                    'enabled',
                    'filters-json',
                    'workspace',
                ]),
                positionalCount: 1,
                run: async (context, flags, connectorInstanceId) => {
                    const connectorClient = await workspaceConnectorClient(context, flags);
                    writeJson(context, await connectorClient.update(parseConnectorConfiguration(connectorInstanceId, toArgvWithoutWorkspace(flags))));
                },
            }),
            status: makeCommand({
                docs: { brief: 'Show connector synchronization status' },
                flags: optionFlags(['workspace']),
                positionalCount: 1,
                run: async (context, flags, connectorInstanceId) => {
                    const connectorClient = await workspaceConnectorClient(context, flags);
                    writeJson(context, await connectorClient.inspect(connectorInstanceId));
                },
            }),
            list: makeCommand({
                docs: { brief: 'List connector instances' },
                flags: optionFlags(['workspace']),
                run: async (context, flags) => {
                    const connectorClient = await workspaceConnectorClient(context, flags);
                    writeJson(context, await connectorClient.list());
                },
            }),
            observations: buildRouteMap({
                docs: { brief: 'Inspect connector observations' },
                routes: {
                    list: makeCommand({
                        docs: { brief: 'List connector observations' },
                        flags: optionFlags(['connector-run-id', 'limit', 'offset', 'workspace']),
                        positionalCount: 1,
                        run: async (context, flags, connectorInstanceId) => {
                            const connectorClient = await workspaceConnectorClient(context, flags);
                            writeJson(context, await connectorClient.observations.list(parseConnectorObservationsList(connectorInstanceId, toArgvWithoutWorkspace(flags))));
                        },
                    }),
                },
            }),
            runs: buildRouteMap({
                docs: { brief: 'Inspect connector runs' },
                routes: {
                    list: makeCommand({
                        docs: { brief: 'List connector runs' },
                        flags: optionFlags(['limit', 'mode', 'offset', 'status', 'workspace']),
                        positionalCount: 1,
                        run: async (context, flags, connectorInstanceId) => {
                            const connectorClient = await workspaceConnectorClient(context, flags);
                            writeJson(context, await connectorClient.runs.list(parseConnectorRunsList(connectorInstanceId, toArgvWithoutWorkspace(flags))));
                        },
                    }),
                },
            }),
            schedules: buildRouteMap({
                docs: { brief: 'Manage connector schedule policy' },
                routes: {
                    get: makeCommand({
                        docs: { brief: 'Get connector schedule policy' },
                        flags: optionFlags(['workspace']),
                        positionalCount: 1,
                        run: async (context, flags, connectorInstanceId) => {
                            const connectorClient = await workspaceConnectorClient(context, flags);
                            writeJson(context, await connectorClient.schedules.get(connectorInstanceId));
                        },
                    }),
                    upsert: makeCommand({
                        docs: { brief: 'Create or update connector schedule policy' },
                        flags: optionFlags(['workspace'], ['cadence-json', 'expected-revision', 'state', 'timezone']),
                        positionalCount: 1,
                        run: async (context, flags, connectorInstanceId) => {
                            const connectorClient = await workspaceConnectorClient(context, flags);
                            writeJson(context, await connectorClient.schedules.upsert(parseConnectorScheduleUpsert(connectorInstanceId, toArgvWithoutWorkspace(flags))));
                        },
                    }),
                },
            }),
            trigger: makeCommand({
                docs: { brief: 'Advance continuous connector synchronization' },
                flags: {
                    ...optionFlags([
                        'filter-signature',
                        'filters-json',
                        'mode',
                        'reason',
                        'workspace',
                    ]),
                    ...booleanFlags(['dry-run']),
                },
                positionalCount: 1,
                run: async (context, flags, connectorInstanceId) => {
                    const connectorClient = await workspaceConnectorClient(context, flags);
                    writeJson(context, await connectorClient.runs.trigger(parseConnectorRunTrigger(connectorInstanceId, toArgvWithoutWorkspace(flags))));
                },
            }),
        },
    });
}
