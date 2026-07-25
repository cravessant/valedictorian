import type {
  CaptureCompletionDetailV2,
  ProcessingIssue,
} from '@sparxie/sdk'

type DestinationIssue = ProcessingIssue & { readonly stage: 'destination' }

/**
 * The only diagnostic detail keys this panel may surface. Issue details are an
 * open server-authored record, so anything outside this list — rejected
 * destination URLs, provider payloads, credentials — is never rendered.
 */
const SAFE_DETAIL_KEYS = [
  'resolverId',
  'resolverVersion',
  'providerReason',
  'providerEvidenceKind',
  'providerField',
  'parserChanged',
  'safetyReason',
] as const

interface Props {
  readonly destination: CaptureCompletionDetailV2['destination']
  readonly issue: ProcessingIssue | null
}

export function CaptureDestinationOutcome({ destination, issue }: Props) {
  // Only a destination-stage issue explains a destination outcome. Promotion
  // and information issues have their own recovery surfaces and must never be
  // relabelled as destination resolution.
  const destinationIssue = issue && isDestinationIssue(issue) ? issue : null
  if (!destinationIssue && !destination.providerStatus) return null
  return (
    <section
      aria-label="Destination resolution outcome"
      className="min-w-0 rounded-md border border-primary/35 bg-muted/45 px-4 py-3"
    >
      <p className="text-xs font-medium tracking-wide text-primary">
        DESTINATION RESOLUTION
      </p>
      {destination.providerStatus ? (
        <p className="mt-2 break-words text-sm">
          Provider status: <span className="font-medium">{destination.providerStatus}</span>.
          The resolved destination remains usable.
        </p>
      ) : null}
      {destinationIssue ? <ResolutionIssue issue={destinationIssue} /> : null}
    </section>
  )
}

function isDestinationIssue(issue: ProcessingIssue): issue is DestinationIssue {
  return issue.stage === 'destination'
}

function ResolutionIssue({ issue }: { readonly issue: DestinationIssue }) {
  return (
    <div className="mt-2 min-w-0 space-y-2">
      <p className="break-words text-sm">{issue.message}</p>
      <dl className="grid min-w-0 gap-x-3 gap-y-1 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
        <Diagnostic label="Code" value={issue.code} />
        {issue.action ? <Diagnostic label="Action" value={issue.action} /> : null}
        {safeDetails(issue.details).map(([key, value]) => (
          <Diagnostic key={key} label={diagnosticLabel(key)} value={value} />
        ))}
      </dl>
    </div>
  )
}

function safeDetails(details: ProcessingIssue['details']) {
  return SAFE_DETAIL_KEYS.flatMap((key) => (
    key in details ? [[key, details[key]] as const] : []
  ))
}

function Diagnostic({
  label,
  value,
}: {
  readonly label: string
  readonly value: string | number | boolean | null
}) {
  return (
    <>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono">{value === null ? 'null' : String(value)}</dd>
    </>
  )
}

function diagnosticLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}
