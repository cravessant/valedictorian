import type {
  ConnectorProviderUrlResolverResult,
} from '@sparxie/valedictorian-connectors-core'
import {
  processingIssueSchema,
  type ProcessingIssue,
} from '@sparxie/sdk'

type TerminalOutcome = Extract<
  ConnectorProviderUrlResolverResult,
  { status: 'terminal' }
>

interface ResolverIdentity {
  readonly id: string
  readonly version: string
}

const destinationEvidenceKinds = new Set([
  'jobright_destination_invalid',
  'jobright_destination_missing',
  'jobright_destination_provider_internal',
])
const destinationEvidenceFields = new Set(['apply_link', 'original_url'])

export function destinationSecurityIssue(
  resolver: ResolverIdentity,
  safetyReason: string,
): ProcessingIssue {
  const invalidMethod = safetyReason === 'invalid_resolver_method'
  return issue({
    code: 'destination_security_rejected',
    action: null,
    message: invalidMethod
      ? 'The provider returned an invalid destination resolver method.'
      : 'The provider returned an unsafe destination URL.',
    details: {
      ...resolverDetails(resolver),
      safetyReason: boundedText(safetyReason),
    },
  })
}

export function terminalDestinationIssue(
  outcome: TerminalOutcome,
  resolver: ResolverIdentity,
): { status: 'action_required'; issue: ProcessingIssue } {
  const details = terminalDetails(outcome, resolver)
  if (
    outcome.reason === 'authentication_required'
    || outcome.reason === 'authentication_failed'
  ) {
    return terminal(issue({
      code: 'provider_authentication_required',
      action: 'authenticate_provider',
      message: outcome.reason === 'authentication_failed'
        ? 'Provider authentication failed.'
        : 'Provider authentication is required.',
      details,
    }))
  }
  if (outcome.reason === 'provider_record_invalid') {
    return terminal(issue({
      code: 'provider_identity_invalid',
      action: 'correct_capture',
      message: 'The provider identity is not valid.',
      details,
    }))
  }
  if (outcome.reason === 'provider_schema_changed') {
    return terminal(issue({
      code: 'destination_unsupported',
      action: 'correct_capture',
      message: 'The provider destination response schema changed.',
      details,
    }))
  }
  if (outcome.reason === 'provider_internal_destination') {
    return terminal(issue({
      code: 'destination_unsupported',
      action: 'complete_job_information',
      message: 'The provider destination points back to Jobright and was suppressed.',
      details,
    }))
  }
  if (outcome.reason === 'destination_unavailable') {
    const invalid = details.providerEvidenceKind === 'jobright_destination_invalid'
    return terminal(issue({
      code: invalid ? 'destination_unsupported' : 'destination_not_found',
      action: invalid ? 'correct_capture' : 'complete_job_information',
      message: invalid
        ? 'The provider destination candidate is malformed or unsupported.'
        : 'The provider supplied no usable destination URL.',
      details,
    }))
  }
  if (outcome.reason === 'provider_status_terminal') {
    return terminal(issue({
      code: 'destination_not_found',
      action: 'complete_job_information',
      message: 'The provider rejected the destination request.',
      details,
    }))
  }
  return terminal(issue({
    code: 'destination_not_found',
    action: 'complete_job_information',
    message: 'The provider could not supply a usable destination.',
    details,
  }))
}

function terminal(issueValue: ProcessingIssue) {
  return { status: 'action_required' as const, issue: issueValue }
}

function terminalDetails(outcome: TerminalOutcome, resolver: ResolverIdentity) {
  const evidence = knownDestinationEvidence(outcome)
  return {
    ...resolverDetails(resolver),
    providerReason: outcome.reason,
    ...(outcome.parserChanged === undefined
      ? {}
      : { parserChanged: outcome.parserChanged }),
    ...(evidence?.kind ? { providerEvidenceKind: evidence.kind } : {}),
    ...(evidence?.field ? { providerField: evidence.field } : {}),
  }
}

function knownDestinationEvidence(outcome: TerminalOutcome) {
  for (const item of outcome.evidence ?? []) {
    if (!destinationEvidenceKinds.has(item.kind) || !isRecord(item.value)) continue
    const field = item.value.field
    return {
      kind: item.kind,
      ...(typeof field === 'string' && destinationEvidenceFields.has(field)
        ? { field }
        : {}),
    }
  }
  return null
}

function resolverDetails(resolver: ResolverIdentity) {
  return {
    resolverId: boundedText(resolver.id),
    resolverVersion: boundedText(resolver.version),
  }
}

function boundedText(value: string) {
  return value.slice(0, 512)
}

function issue(input: {
  readonly code: string
  readonly action: string | null
  readonly message: string
  readonly details: Record<string, string | number | boolean | null>
}) {
  return processingIssueSchema.parse({
    stage: 'destination',
    causedBy: null,
    ...input,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
