import type {
  CanonicalSourceCandidate,
  FieldResolutionOutcome,
  RawSourceNormalizationResult,
  RawSourceProjectionResult,
} from 'sparxie'
import { formatTimestamp } from '../../app/format'
import {
  isSafeDisplayString,
  isSafeHttpUrl,
  sanitizeDisplayText,
  sanitizeRawFacts,
} from './raw-detail-sanitization'

export function RawNormalizationOutcomes({
  normalization,
  onOpenFinding,
  projection,
}: {
  normalization: RawSourceNormalizationResult | null
  onOpenFinding?: (findingId: string) => void
  projection: RawSourceProjectionResult
}) {
  return (
    <div className="mt-6 space-y-6">
      {normalization ? (
        <>
          <section aria-label="Job normalization resolver outcomes" className="space-y-3">
            <div>
              <h3 className="font-semibold">Job normalization resolver outcomes</h3>
              <p className="text-xs text-muted-foreground">
                Owned by normalization resolvers · canonical schema {safeText(normalization.canonicalSchemaVersion)}
              </p>
            </div>
            {normalization.attempts.map((attempt) => (
              <article key={attempt.id} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">
                  {safeText(attempt.resolver.id)}@{safeText(attempt.resolver.version)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatStatus(attempt.status)} · {attempt.resolver.capabilities.map(safeText).join(', ')} · {safeText(attempt.resolver.costClass)} cost
                </p>
              </article>
            ))}
            <div className="grid gap-2">
              {normalization.fieldOutcomes.map((outcome, index) => (
                <FieldOutcome key={`${outcome.resolverId}-${outcome.field}-${index}`} outcome={outcome} />
              ))}
            </div>
          </section>
          <GateOutcome normalization={normalization} />
        </>
      ) : (
        <section aria-label="Job normalization resolver outcomes" className="rounded-md border border-border p-3">
          <h3 className="font-semibold">Job normalization resolver outcomes</h3>
          <p className="text-sm text-muted-foreground">Job normalization has not started for this evidence version.</p>
        </section>
      )}
      <ProjectionOutcome
        candidate={normalization?.canonicalCandidate ?? null}
        projection={projection}
        onOpenFinding={onOpenFinding}
      />
    </div>
  )
}

function FieldOutcome({ outcome }: { outcome: FieldResolutionOutcome }) {
  return (
    <article className="rounded-md border border-border bg-background/40 p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-medium">{formatField(outcome.field)}</span>
        <span>{formatStatus(outcome.status)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {safeText(outcome.resolverId)}@{safeText(outcome.resolverVersion)}
      </p>
      {'reason' in outcome ? <p className="mt-1">{safeText(outcome.reason)}</p> : null}
      {'value' in outcome ? <p className="mt-1">{formatSafeValue(outcome.value)}</p> : null}
      {'values' in outcome ? <p className="mt-1">{formatSafeValue(outcome.values)}</p> : null}
    </article>
  )
}

function GateOutcome({ normalization }: { normalization: RawSourceNormalizationResult }) {
  const gate = normalization.gate
  return (
    <section aria-label="Opportunity admission gate" className="space-y-2 rounded-md border border-border p-3">
      <div>
        <h3 className="font-semibold">Opportunity admission gate</h3>
        <p className="text-xs text-muted-foreground">Owned by the Opportunity admission gate</p>
      </div>
      {gate ? (
        <>
          <p className="font-medium">{formatStatus(gate.status)}</p>
          <p>{safeText(gate.reason ?? 'No additional gate reason.')}</p>
          <p className="text-sm">Missing: {formatFieldList(gate.missingFields)}</p>
          <p className="text-sm">Conflicting: {formatFieldList(gate.conflictingFields)}</p>
          <p className="text-xs text-muted-foreground">Policy {safeText(gate.policyVersion)}</p>
        </>
      ) : <p className="text-sm text-muted-foreground">Not evaluated</p>}
    </section>
  )
}

function ProjectionOutcome({
  candidate,
  onOpenFinding,
  projection,
}: {
  candidate: CanonicalSourceCandidate | null
  onOpenFinding?: (findingId: string) => void
  projection: RawSourceProjectionResult
}) {
  return (
    <section aria-label="Job fact version and Opportunity projection" className="space-y-2 rounded-md border border-border p-3">
      <h3 className="font-semibold">Job fact version and Opportunity projection</h3>
      <p className="text-xs text-muted-foreground">Owned by Opportunity projection</p>
      {candidate ? <CanonicalCandidateDetail candidate={candidate} /> : <p>No Job fact version</p>}
      <ProjectionReceipt projection={projection} />
      {projection.status === 'projected' && isSafeDisplayString(projection.finding.id)
        && onOpenFinding ? (
        <button
          className="rounded-md border border-border px-3 py-2 text-sm"
          onClick={() => onOpenFinding(projection.finding.id)}
          type="button"
        >
          Open Opportunity {projection.finding.id}
        </button>
      ) : null}
    </section>
  )
}

function CanonicalCandidateDetail({ candidate }: { candidate: CanonicalSourceCandidate }) {
  return (
    <div className="space-y-2">
      <p>Job fact version {safeText(candidate.id)}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <CandidateFact label="Company" value={safeText(candidate.companyName)} />
        <CandidateFact label="Role" value={safeText(candidate.roleTitle)} />
        <CandidateFact label="Employment type" value={formatStatus(candidate.employmentType)} />
        <CandidateFact label="Seniority" value={formatStatus(candidate.seniority)} />
        <CandidateFact label="Work mode" value={formatStatus(candidate.workMode)} />
        <CandidateFact label="Location" value={formatLocation(candidate)} />
        <CandidateFact label="Compensation" value={formatCompensation(candidate)} />
        <CandidateFact label="Posted" value={formatPostedAt(candidate)} />
        <CandidateFact
          label="Provider job"
          value={candidate.providerJobId ? safeText(candidate.providerJobId) : 'Not provided'}
        />
        <CandidateFact
          label="Canonical identity"
          value={`${formatStatus(candidate.canonicalIdentity.kind)} · ${safeText(candidate.canonicalIdentity.value)}`}
        />
        <CandidateFact label="Job" value={safeText(candidate.sourceEntityId)} />
        <CandidateFact label="Capture evidence version" value={safeText(candidate.rawRevisionId)} />
        <CandidateFact label="Schema" value={safeText(candidate.schemaVersion)} />
        <CandidateFact label="Observed" value={formatTimestamp(candidate.observedAt)} />
        <CandidateFact
          label="Destination class"
          value={candidate.destination ? formatStatus(candidate.destination.class) : 'Not provided'}
        />
      </dl>
      <div className="flex flex-wrap gap-3 text-sm">
        {candidate.destination?.url && isSafeHttpUrl(candidate.destination.url) ? (
          <a className="text-primary underline" href={candidate.destination.url} rel="noreferrer" target="_blank">
            Open canonical destination
          </a>
        ) : null}
        {candidate.destination?.intermediaryUrl
          && isSafeHttpUrl(candidate.destination.intermediaryUrl) ? (
            <a className="text-primary underline" href={candidate.destination.intermediaryUrl} rel="noreferrer" target="_blank">
              Open intermediary source
            </a>
          ) : null}
        {candidate.sourceUrl && isSafeHttpUrl(candidate.sourceUrl) ? (
          <a className="text-primary underline" href={candidate.sourceUrl} rel="noreferrer" target="_blank">
            Open source listing
          </a>
        ) : null}
      </div>
    </div>
  )
}

function CandidateFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>{' '}
      <dd>{value}</dd>
    </div>
  )
}

function formatLocation(candidate: CanonicalSourceCandidate) {
  if (!candidate.location) return 'Not provided'
  const structured = [candidate.location.city, candidate.location.region, candidate.location.country]
    .filter((value): value is string => Boolean(value))
    .map(safeText)
  if (structured.length > 0) return structured.join(', ')
  return candidate.location.raw ? safeText(candidate.location.raw) : 'Not provided'
}

function formatCompensation(candidate: CanonicalSourceCandidate) {
  const compensation = candidate.compensation
  if (!compensation) return 'Not provided'
  const range = [compensation.minimum, compensation.maximum]
    .filter((value): value is number => value !== null)
    .map((value) => value.toLocaleString('en-US'))
    .join('–')
  if (range) {
    const currency = compensation.currency ? `${safeText(compensation.currency)} ` : ''
    return `${currency}${range} per ${formatStatus(compensation.interval).toLowerCase()}`
  }
  return compensation.raw ? safeText(compensation.raw) : 'Not provided'
}

function formatPostedAt(candidate: CanonicalSourceCandidate) {
  if (!candidate.postedAt.value) {
    return candidate.postedAt.raw ? safeText(candidate.postedAt.raw) : 'Unknown'
  }
  return `${safeText(candidate.postedAt.value)} · ${formatStatus(candidate.postedAt.precision)}`
}

function ProjectionReceipt({ projection }: { projection: RawSourceProjectionResult }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Opportunity projection receipt for evidence version {safeText(projection.rawRevisionId)}
      </p>
      <ProjectionReceiptStatus projection={projection} />
    </div>
  )
}

function ProjectionReceiptStatus({ projection }: { projection: RawSourceProjectionResult }) {
  if (projection.status === 'projected') {
    return (
      <div className="text-sm">
        <p>Projected to Opportunity {safeText(projection.finding.id)}</p>
        <p>Opportunity outcome {formatStatus(projection.finding.mergeStatus)}</p>
        {projection.finding.mergedApplicationId ? (
          <p>Application {safeText(projection.finding.mergedApplicationId)}</p>
        ) : null}
      </div>
    )
  }
  if (projection.status === 'failed') {
    return (
      <div className="text-sm">
        <p>Projection failed · {formatStatus(projection.failure.code)}</p>
        <p>{projection.failure.retryable ? 'Retryable' : 'Not retryable'}</p>
      </div>
    )
  }
  if (projection.status === 'pending') return <p>Projection pending</p>
  if (projection.normalizationStatus === null) {
    return <p>No Job normalization or Opportunity projection recorded for this evidence version</p>
  }
  return (
    <p>
      Not eligible for Opportunity projection · Job normalization {formatStatus(projection.normalizationStatus)}
      {projection.gateStatus ? ` · Gate ${formatStatus(projection.gateStatus)}` : ''}
    </p>
  )
}

function formatFieldList(fields: readonly string[]) {
  return fields.length > 0 ? fields.map(formatField).join(', ') : 'None'
}

function formatField(value: string) {
  const label = value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    .replace(/\burl\b/g, 'URL')
  return label.replace(/^./, (letter) => letter.toUpperCase())
}

function formatStatus(value: string) {
  const label = value.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatSafeValue(value: unknown) {
  const sanitized = sanitizeRawFacts(value as never)
  return sanitized === undefined ? 'Unsafe value omitted' : (
    typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized)
  )
}

function safeText(value: string) {
  return sanitizeDisplayText(value)
}
