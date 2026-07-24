import { buildRouteMap } from '@stricli/core';
import { applicationTechnicalListInputSchema, createApplicationInputSchema, createPursuitLinkInputSchema, lifecycleApplicationHistoryInputSchema, lifecycleApplicationListInputSchema, refreshApplicationSnapshotInputSchema, removalInputSchema, removePursuitLinkInputSchema, restoreInputSchema, updateApplicationCompanyInputSchema, updateApplicationSourceInputSchema, updatePursuitApplicationStatusInputSchema, updatePursuitLinkInputSchema, } from '@sparxie/sdk';
import { makeCommand, optionFlags, workspaceClient, writeJson, } from './valedictorian-cli.command-runtime.js';
import { CliOwnedFailure } from './valedictorian-cli.failures.js';
import { actorOptionalFlags, historyInputFlags, inputJsonFlags, listInputFlags, parseContractInput, parseRemovalInput, parseRestoreInput, removalRequiredFlags, restoreRequiredFlags, } from './valedictorian-cli.lifecycle-input.js';
export function buildApplicationsRoute() {
    return buildRouteMap({
        docs: { brief: 'Manage pursuit applications' },
        routes: {
            list: makeCommand({
                docs: { brief: 'List applications' },
                flags: optionFlags(listInputFlags),
                run: async (context, flags) => {
                    const client = await workspaceClient(context, flags);
                    const input = parseContractInput(flags, lifecycleApplicationListInputSchema, {
                        optional: true,
                    });
                    writeJson(context, await client.applications.list(input));
                },
            }),
            get: makeCommand({
                docs: { brief: 'Get an application' },
                flags: optionFlags(['workspace']),
                positionalCount: 1,
                run: async (context, flags, applicationId) => {
                    const resource = await (await workspaceClient(context, flags)).applications.get(applicationId);
                    if (!resource)
                        throw applicationNotFound(applicationId);
                    writeJson(context, resource);
                },
            }),
            create: inputMutation('Create an application', createApplicationInputSchema, (client, input) => client.applications.create(input)),
            'update-status': identifiedMutation('Update application status', updatePursuitApplicationStatusInputSchema, (client, input) => client.applications.updateStatus(input)),
            'update-company': identifiedMutation('Update application company', updateApplicationCompanyInputSchema, (client, input) => client.applications.updateCompany(input)),
            'update-source': identifiedMutation('Update application source', updateApplicationSourceInputSchema, (client, input) => client.applications.updateSource(input)),
            links: buildLinksRoute(),
            'refresh-snapshot': identifiedMutation('Refresh an application job snapshot', refreshApplicationSnapshotInputSchema, (client, input) => client.applications.refreshSnapshot(input)),
            remove: makeCommand({
                docs: { brief: 'Remove an application using an explicit dependent-resource choice' },
                flags: optionFlags(actorOptionalFlags, removalRequiredFlags),
                positionalCount: 1,
                run: async (context, flags, applicationId) => {
                    const client = await workspaceClient(context, flags);
                    writeJson(context, await client.applications.remove(parseRemovalInput(flags, removalInputSchema, applicationId)));
                },
            }),
            restore: makeCommand({
                docs: { brief: 'Restore an application' },
                flags: optionFlags(actorOptionalFlags, restoreRequiredFlags),
                positionalCount: 1,
                run: async (context, flags, applicationId) => {
                    const client = await workspaceClient(context, flags);
                    writeJson(context, await client.applications.restore(parseRestoreInput(flags, restoreInputSchema, applicationId)));
                },
            }),
            history: makeCommand({
                docs: { brief: 'List application history' },
                flags: optionFlags(historyInputFlags),
                positionalCount: 1,
                run: async (context, flags, applicationId) => {
                    const client = await workspaceClient(context, flags);
                    const input = parseContractInput(flags, lifecycleApplicationHistoryInputSchema, {
                        id: ['id', applicationId],
                        optional: true,
                    });
                    writeJson(context, await client.applications.history(input));
                },
            }),
            attempts: technicalListGroup('application attempts', (client, input) => client.applications.attempts.list(input)),
            events: technicalListGroup('application events', (client, input) => client.applications.events.list(input)),
        },
    });
}
function buildLinksRoute() {
    return buildRouteMap({
        docs: { brief: 'Manage application links' },
        routes: {
            create: identifiedMutation('Create an application link', createPursuitLinkInputSchema, (client, input) => client.applications.links.create(input)),
            update: identifiedMutation('Update an application link', updatePursuitLinkInputSchema, (client, input) => client.applications.links.update(input)),
            remove: identifiedMutation('Remove an application link', removePursuitLinkInputSchema, (client, input) => client.applications.links.remove(input)),
        },
    });
}
function inputMutation(brief, schema, operation) {
    return makeCommand({
        docs: { brief },
        flags: optionFlags([], inputJsonFlags),
        run: async (context, flags) => {
            const client = await workspaceClient(context, flags);
            writeJson(context, await operation(client, parseContractInput(flags, schema)));
        },
    });
}
function identifiedMutation(brief, schema, operation) {
    return makeCommand({
        docs: { brief },
        flags: optionFlags([], inputJsonFlags),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
            const client = await workspaceClient(context, flags);
            const input = parseContractInput(flags, schema, { id: ['applicationId', applicationId] });
            writeJson(context, await operation(client, input));
        },
    });
}
function technicalListGroup(resource, operation) {
    return buildRouteMap({
        docs: { brief: `Inspect ${resource}` },
        routes: {
            list: makeCommand({
                docs: { brief: `List ${resource}` },
                flags: optionFlags(listInputFlags),
                positionalCount: 1,
                run: async (context, flags, applicationId) => {
                    const client = await workspaceClient(context, flags);
                    const input = parseContractInput(flags, applicationTechnicalListInputSchema, {
                        id: ['applicationId', applicationId],
                        optional: true,
                    });
                    writeJson(context, await operation(client, input));
                },
            }),
        },
    });
}
function applicationNotFound(id) {
    return new CliOwnedFailure({
        code: 'application_not_found',
        kind: 'not_found',
        status: 404,
        message: `Application not found: ${id}`,
    });
}
