import { buildRouteMap } from '@stricli/core'
import { isApplicationStatus } from 'sparxie'

import {
  booleanFlags,
  makeCommand,
  optionFlags,
  optionValue,
  toArgvWithoutWorkspace,
  workspaceClient,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import {
  parseApplicationAttemptsQuery,
  parseApplicationEventsQuery,
  parseApplicationListQuery,
  parseAttemptComplete,
  parseAttemptStart,
  parseAttemptStep,
  parseCreateApplication,
  parseCreateApplicationLink,
  parseUpdateApplication,
  parseUpdateApplicationLink,
  parseWorkflowUpdate,
  readOptionalText,
  readRequiredText,
} from './valedictorian-cli.parsers.js'

export function buildApplicationsRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage applications' },
    routes: {
      archive: makeCommand({
        docs: { brief: 'Archive an application' },
        flags: optionFlags(['note', 'workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          await client.applications.archive({
            applicationId,
            note: readOptionalText(optionValue(flags, 'note'), 'archive note'),
          })

          writeJson(context, { ok: true })
        },
      }),
      attempts: buildApplicationAttemptsRoute(),
      create: makeCommand({
        docs: { brief: 'Create an application' },
        flags: {
          ...optionFlags([
            'city',
            'current-resume-variant',
            'has-applied',
            'initial-note',
            'location-raw',
            'primary-external-id',
            'primary-kind',
            'primary-label',
            'primary-url',
            'region',
            'source-external-id',
            'source-kind',
            'source-label',
            'source-link-url',
            'start-date',
            'term',
            'terms-json',
            'workspace',
            'end-date',
          ]),
          ...optionFlags([], [
            'company-name',
            'country',
            'role-kind',
            'role-title',
            'source-name',
            'status',
            'work-mode',
          ]),
        },
        run: async (context, flags) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.create(parseCreateApplication(toArgvWithoutWorkspace(flags))),
          )
        },
      }),
      events: makeCommand({
        docs: { brief: 'List application events' },
        flags: optionFlags(['limit', 'offset', 'workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.events.list(
              parseApplicationEventsQuery(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      get: makeCommand({
        docs: { brief: 'Get application details' },
        flags: optionFlags(['workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)
          const applicationDetail = await client.applications.get(applicationId)

          if (!applicationDetail) {
            throw new Error(`Application not found: ${applicationId}`)
          }

          writeJson(context, applicationDetail)
        },
      }),
      link: buildApplicationLinksRoute(),
      list: makeCommand({
        docs: { brief: 'List applications' },
        flags: optionFlags([
          'company',
          'created-from',
          'created-to',
          'has-applied',
          'limit',
          'max-score',
          'min-score',
          'name',
          'offset',
          'priority-band',
          'role',
          'search',
          'sort',
          'source',
          'status',
          'updated-from',
          'updated-to',
          'work-mode',
          'workspace',
        ]),
        run: async (context, flags) => {
          const query = parseApplicationListQuery(toArgvWithoutWorkspace(flags))
          const client = await workspaceClient(context, flags)

          writeJson(context, await client.applications.list(query))
        },
      }),
      note: makeCommand({
        docs: { brief: 'Append an application note' },
        flags: optionFlags(['workspace'], ['message']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.notes.append({
              applicationId,
              message: readRequiredText(optionValue(flags, 'message'), 'note message'),
            }),
          )
        },
      }),
      status: makeCommand({
        docs: { brief: 'Update application status' },
        flags: optionFlags(['notes', 'workspace']),
        positionalCount: 2,
        run: async (context, flags, applicationId, status) => {
          if (!isApplicationStatus(status)) {
            throw new Error(`Invalid application status: ${status}`)
          }

          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.updateStatus({
              applicationId,
              status,
              notes: optionValue(flags, 'notes'),
            }),
          )
        },
      }),
      update: makeCommand({
        docs: { brief: 'Update application metadata' },
        flags: optionFlags([
          'city',
          'country',
          'current-resume-variant',
          'has-applied',
          'location-raw',
          'region',
          'role-kind',
          'role-title',
          'start-date',
          'term',
          'terms-json',
          'work-mode',
          'workspace',
          'end-date',
        ]),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.update(
              parseUpdateApplication(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      workflow: makeCommand({
        docs: { brief: 'Update application workflow state' },
        flags: optionFlags([
          'blocker-reason',
          'hold-started-at',
          'lock-started-at',
          'manual-review-kind',
          'missing-user-info',
          'workspace',
        ]),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.workflow.update(
              parseWorkflowUpdate(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
    },
  })
}

function buildApplicationLinksRoute() {
  return buildRouteMap({
    docs: { brief: 'Manage application links' },
    routes: {
      add: makeCommand({
        docs: { brief: 'Add an application link' },
        flags: {
          ...optionFlags(['external-id', 'workspace']),
          ...optionFlags([], ['kind', 'label', 'url']),
          ...booleanFlags(['primary']),
        },
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.links.create(
              parseCreateApplicationLink(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      update: makeCommand({
        docs: { brief: 'Update an application link' },
        flags: {
          ...optionFlags(['archived', 'external-id', 'kind', 'label', 'url', 'workspace']),
          ...booleanFlags(['archive', 'primary']),
        },
        positionalCount: 2,
        run: async (context, flags, applicationId, linkId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.links.update(
              parseUpdateApplicationLink(applicationId, linkId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
    },
  })
}

function buildApplicationAttemptsRoute() {
  return buildRouteMap({
    docs: { brief: 'Track application attempts' },
    routes: {
      complete: makeCommand({
        docs: { brief: 'Complete an application attempt' },
        flags: optionFlags(
          [
            'blocker-reason',
            'confirmation-text',
            'confirmation-url',
            'hold-started-at',
            'manual-review-kind',
            'missing-user-info',
            'stop-reason',
            'summary',
            'workspace',
          ],
          ['outcome'],
        ),
        positionalCount: 2,
        run: async (context, flags, applicationId, attemptId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.complete(
              parseAttemptComplete(applicationId, attemptId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      list: makeCommand({
        docs: { brief: 'List application attempts' },
        flags: optionFlags(['limit', 'offset', 'workspace']),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.list(
              parseApplicationAttemptsQuery(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      start: makeCommand({
        docs: { brief: 'Start an application attempt' },
        flags: optionFlags(
          ['actor-name', 'entry-url', 'resume-artifact-path', 'resume-variant', 'summary', 'workspace'],
          ['actor-type'],
        ),
        positionalCount: 1,
        run: async (context, flags, applicationId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.start(
              parseAttemptStart(applicationId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
      step: makeCommand({
        docs: { brief: 'Record an application attempt step' },
        flags: optionFlags(['actor', 'payload-json', 'workspace'], ['message', 'type']),
        positionalCount: 2,
        run: async (context, flags, applicationId, attemptId) => {
          const client = await workspaceClient(context, flags)

          writeJson(
            context,
            await client.applications.attempts.step(
              parseAttemptStep(applicationId, attemptId, toArgvWithoutWorkspace(flags)),
            ),
          )
        },
      }),
    },
  })
}
