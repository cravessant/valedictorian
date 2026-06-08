import http from 'node:http'
import { defaultLocalCapabilities, isApplicationStatus, type JobAppClient, type ProfileUpdateInput } from 'sparxie'
import { readJsonBody, readOptionalStringField, readStringField, writeJson } from './local-server.http'
import {
  parseApplicationAttemptsQuery,
  parseApplicationEventsQuery,
  parseApplicationLinksQuery,
  parseApplicationListQuery,
  parseApplicationUpdateInput,
  parseAttemptCompleteInput,
  parseAttemptStartInput,
  parseAttemptStepInput,
  parseCreateApplicationInput,
  parseEvaluateApplicationPolicyInput,
  parseEvaluateRunWindowPolicyInput,
  parseEvaluateSourcingCandidatePolicyInput,
  parseLinkCreateInput,
  parseLinkUpdateInput,
  parsePolicyConfigPatch,
  parsePolicyEvidenceInput,
  parsePolicyEvidenceListQuery,
  parseQueueListQuery,
  parseRunCompleteInput,
  parseRunStartInput,
  parseRunStepInput,
  parseSourcingCandidateProcessInput,
  parseSourcingFindingDecisionInput,
  parseSourcingFindingCreateInput,
  parseSourcingFindingsListQuery,
  parseSourcingFindingUpdateInput,
  parseWorkflowRunsListQuery,
  parseWorkflowUpdateInput,
} from './local-server.parsers'

export async function handleRequest({
  client,
  request,
  response,
  token,
}: {
  client: JobAppClient
  request: http.IncomingMessage
  response: http.ServerResponse
  token?: string
}) {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && requestUrl.pathname === '/v1/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/capabilities') {
      writeJson(response, 200, defaultLocalCapabilities)
      return
    }

    if (token && request.headers.authorization !== `Bearer ${token}`) {
      writeJson(response, 401, { message: 'Unauthorized' })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/applications') {
      writeJson(response, 200, await client.applications.list(parseApplicationListQuery(requestUrl)))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/queue') {
      writeJson(response, 200, await client.queue.list(parseQueueListQuery(requestUrl)))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/policy/config') {
      writeJson(response, 200, await client.policy.config.get())
      return
    }

    if (request.method === 'PATCH' && requestUrl.pathname === '/v1/policy/config') {
      writeJson(response, 200, await client.policy.config.update(parsePolicyConfigPatch(await readJsonBody(request))))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/config/reset') {
      writeJson(response, 200, await client.policy.config.reset())
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/policy/evidence') {
      writeJson(response, 200, await client.policy.evidence.list(parsePolicyEvidenceListQuery(requestUrl)))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evidence') {
      writeJson(
        response,
        200,
        await client.policy.evidence.record(parsePolicyEvidenceInput(await readJsonBody(request))),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evaluate/application') {
      writeJson(
        response,
        200,
        await client.policy.evaluate.application(
          parseEvaluateApplicationPolicyInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evaluate/sourcing-candidate') {
      writeJson(
        response,
        200,
        await client.policy.evaluate.sourcingCandidate(
          parseEvaluateSourcingCandidatePolicyInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/policy/evaluate/run-window') {
      writeJson(
        response,
        200,
        await client.policy.evaluate.runWindow(
          parseEvaluateRunWindowPolicyInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/profile') {
      writeJson(response, 200, await client.profile.get())
      return
    }

    if (request.method === 'PATCH' && requestUrl.pathname === '/v1/profile') {
      writeJson(response, 200, await client.profile.update((await readJsonBody(request)) as ProfileUpdateInput))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/profile/agent-context') {
      writeJson(response, 200, await client.profile.agentContext.get())
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/runs') {
      writeJson(response, 200, await client.runs.list(parseWorkflowRunsListQuery(requestUrl)))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/runs') {
      writeJson(response, 200, await client.runs.start(parseRunStartInput(await readJsonBody(request))))
      return
    }

    const runCompleteMatch = requestUrl.pathname.match(/^\/v1\/runs\/([^/]+)\/complete$/)

    if (request.method === 'PATCH' && runCompleteMatch) {
      writeJson(
        response,
        200,
        await client.runs.complete(
          parseRunCompleteInput(decodeURIComponent(runCompleteMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    const runStepMatch = requestUrl.pathname.match(/^\/v1\/runs\/([^/]+)\/steps$/)

    if (request.method === 'POST' && runStepMatch) {
      writeJson(
        response,
        200,
        await client.runs.step(
          parseRunStepInput(decodeURIComponent(runStepMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/sourcing/candidates/process') {
      writeJson(
        response,
        200,
        await client.sourcing.candidates.process(
          parseSourcingCandidateProcessInput(await readJsonBody(request)),
        ),
      )
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/v1/sourcing/findings') {
      writeJson(
        response,
        200,
        await client.sourcing.findings.list(parseSourcingFindingsListQuery(requestUrl)),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/sourcing/findings') {
      writeJson(
        response,
        200,
        await client.sourcing.findings.create(parseSourcingFindingCreateInput(await readJsonBody(request))),
      )
      return
    }

    const findingPromoteMatch = requestUrl.pathname.match(
      /^\/v1\/sourcing\/findings\/([^/]+)\/promote$/,
    )

    if (request.method === 'POST' && findingPromoteMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.findings.promote({
          findingId: decodeURIComponent(findingPromoteMatch[1]),
        }),
      )
      return
    }

    const findingDecisionMatch = requestUrl.pathname.match(
      /^\/v1\/sourcing\/findings\/([^/]+)\/decide$/,
    )

    if (request.method === 'POST' && findingDecisionMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.findings.decide(
          parseSourcingFindingDecisionInput(
            decodeURIComponent(findingDecisionMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const findingMatch = requestUrl.pathname.match(/^\/v1\/sourcing\/findings\/([^/]+)$/)

    if (request.method === 'PATCH' && findingMatch) {
      writeJson(
        response,
        200,
        await client.sourcing.findings.update(
          parseSourcingFindingUpdateInput(
            decodeURIComponent(findingMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/applications') {
      writeJson(
        response,
        200,
        await client.applications.create(parseCreateApplicationInput(await readJsonBody(request))),
      )
      return
    }

    const statusMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/status$/)

    if (request.method === 'PATCH' && statusMatch) {
      const body = await readJsonBody(request)
      const status = readStringField(body, 'status')

      if (!isApplicationStatus(status)) {
        writeJson(response, 400, { message: `Invalid application status: ${status}` })
        return
      }

      writeJson(
        response,
        200,
        await client.applications.updateStatus({
          applicationId: decodeURIComponent(statusMatch[1]),
          status,
          notes: readOptionalStringField(body, 'notes'),
        }),
      )
      return
    }

    const archiveMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/archive$/)

    if (request.method === 'PATCH' && archiveMatch) {
      await client.applications.archive({
        applicationId: decodeURIComponent(archiveMatch[1]),
        note: readOptionalStringField(await readJsonBody(request), 'note'),
      })
      writeJson(response, 200, { ok: true })
      return
    }

    const workflowMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/workflow$/)

    if (request.method === 'PATCH' && workflowMatch) {
      writeJson(
        response,
        200,
        await client.applications.workflow.update(
          parseWorkflowUpdateInput(
            decodeURIComponent(workflowMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const notesMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/notes$/)

    if (request.method === 'POST' && notesMatch) {
      writeJson(
        response,
        200,
        await client.applications.notes.append({
          applicationId: decodeURIComponent(notesMatch[1]),
          message: readStringField(await readJsonBody(request), 'message'),
        }),
      )
      return
    }

    const linkMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/links\/([^/]+)$/)

    if (request.method === 'PATCH' && linkMatch) {
      writeJson(
        response,
        200,
        await client.applications.links.update(
          parseLinkUpdateInput(
            decodeURIComponent(linkMatch[1]),
            decodeURIComponent(linkMatch[2]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const linksMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/links$/)

    if (request.method === 'GET' && linksMatch) {
      writeJson(
        response,
        200,
        await client.applications.links.list(
          parseApplicationLinksQuery(decodeURIComponent(linksMatch[1]), requestUrl),
        ),
      )
      return
    }

    if (request.method === 'POST' && linksMatch) {
      writeJson(
        response,
        200,
        await client.applications.links.create(
          parseLinkCreateInput(decodeURIComponent(linksMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    const eventsMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/events$/)

    if (request.method === 'GET' && eventsMatch) {
      writeJson(
        response,
        200,
        await client.applications.events.list(
          parseApplicationEventsQuery(decodeURIComponent(eventsMatch[1]), requestUrl),
        ),
      )
      return
    }

    const attemptCompleteMatch = requestUrl.pathname.match(
      /^\/v1\/applications\/([^/]+)\/attempts\/([^/]+)\/complete$/,
    )

    if (request.method === 'PATCH' && attemptCompleteMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.complete(
          parseAttemptCompleteInput(
            decodeURIComponent(attemptCompleteMatch[1]),
            decodeURIComponent(attemptCompleteMatch[2]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const attemptStepMatch = requestUrl.pathname.match(
      /^\/v1\/applications\/([^/]+)\/attempts\/([^/]+)\/steps$/,
    )

    if (request.method === 'POST' && attemptStepMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.step(
          parseAttemptStepInput(
            decodeURIComponent(attemptStepMatch[1]),
            decodeURIComponent(attemptStepMatch[2]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    const attemptsMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)\/attempts$/)

    if (request.method === 'GET' && attemptsMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.list(
          parseApplicationAttemptsQuery(decodeURIComponent(attemptsMatch[1]), requestUrl),
        ),
      )
      return
    }

    if (request.method === 'POST' && attemptsMatch) {
      writeJson(
        response,
        200,
        await client.applications.attempts.start(
          parseAttemptStartInput(decodeURIComponent(attemptsMatch[1]), await readJsonBody(request)),
        ),
      )
      return
    }

    const applicationMatch = requestUrl.pathname.match(/^\/v1\/applications\/([^/]+)$/)

    if (request.method === 'GET' && applicationMatch) {
      const applicationId = decodeURIComponent(applicationMatch[1])
      const application = await client.applications.get(applicationId)

      if (!application) {
        writeJson(response, 404, { message: `Application not found: ${applicationId}` })
        return
      }

      writeJson(response, 200, application)
      return
    }

    if (request.method === 'PATCH' && applicationMatch) {
      writeJson(
        response,
        200,
        await client.applications.update(
          parseApplicationUpdateInput(
            decodeURIComponent(applicationMatch[1]),
            await readJsonBody(request),
          ),
        ),
      )
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/scores') {
      await client.scores.record((await readJsonBody(request)) as Parameters<
        JobAppClient['scores']['record']
      >[0])
      writeJson(response, 200, { ok: true })
      return
    }

    writeJson(response, 404, { message: 'Not found' })
  } catch (error) {
    writeJson(response, 400, {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
