import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { X } from 'lucide-react'
import { InvalidPersistedRawDetailHttpError } from 'sparxie'
import type {
  JsonObject,
  RawSourceNormalizationResult,
  RawSourceProjectionResult,
  RawSourceRecord,
  RawSourceRecordSummary,
} from 'sparxie'
import { formatTimestamp } from '../../app/format'
import type { RawRecordsReadApi } from './raw-normalization.types'
import {
  sanitizeDisplayText,
  sanitizeRawEvidence,
  sanitizeRawFacts,
} from './raw-detail-sanitization'
import { RawNormalizationOutcomes } from './RawNormalizationOutcomes'

type RawDetailIssue =
  | 'candidate_identity'
  | 'normalization_revision'
  | 'normalization_unavailable'
  | 'projection_revision'
type RawDetailLoadError = 'backend_unavailable' | 'invalid_detail' | 'load_failed'

export function RawNormalizationDetail({
  api,
  onClose,
  onOpenFinding,
  summary,
}: {
  api: RawRecordsReadApi
  onClose: () => void
  onOpenFinding?: (findingId: string) => void
  summary: RawSourceRecordSummary
}) {
  const [record, setRecord] = useState<RawSourceRecord | null>(null)
  const [normalization, setNormalization] = useState<RawSourceNormalizationResult | null>(null)
  const [projection, setProjection] = useState<RawSourceProjectionResult | null>(null)
  const [detailIssue, setDetailIssue] = useState<RawDetailIssue | null>(null)
  const [error, setError] = useState<RawDetailLoadError | null>(null)

  useEffect(() => {
    let cancelled = false
    setRecord(null)
    setNormalization(null)
    setProjection(null)
    setDetailIssue(null)
    setError(null)
    void Promise.allSettled([api.get(summary.id), api.getNormalization(summary.id)])
      .then(async ([recordResult, normalizationResult]) => {
        if (cancelled) return
        if (recordResult.status === 'rejected') throw recordResult.reason
        const nextRecord = recordResult.value
        const nextNormalization = normalizationResult.status === 'fulfilled'
          ? normalizationResult.value ?? null
          : null
        const nextProjection = await api.getProjection(nextRecord.latestRevision.id)
        if (!cancelled) {
          setProjection(nextProjection)
          setRecord(nextRecord)
          setNormalization(nextNormalization)
          setDetailIssue(getRawDetailIssue(nextRecord, nextNormalization, nextProjection))
          setError(null)
        }
      }).catch((reason: unknown) => {
        if (!cancelled) {
          setProjection(null)
          setRecord(null)
          setNormalization(null)
          setDetailIssue(null)
          setError(classifyRawDetailLoadError(reason))
        }
      })
    return () => { cancelled = true }
  }, [api, summary])

  const title = `Raw record ${sanitizeDisplayText(summary.id)}`

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88vh] w-full max-w-3xl translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-border px-5 py-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <Button type="button" variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-5 py-4">
            {!record && !error ? <p role="status">Loading raw record detail...</p> : null}
            {error ? <RawDetailLoadFailure error={error} /> : null}
            {record ? <RawRecordDetail record={record} /> : null}
            {record && projection && detailIssue ? <RawDetailConflict issue={detailIssue} /> : null}
            {record && projection && !detailIssue ? (
              <RawNormalizationOutcomes
                normalization={normalization}
                projection={projection}
                onOpenFinding={onOpenFinding}
              />
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function RawDetailLoadFailure({ error }: { error: RawDetailLoadError }) {
  return (
    <p role="alert">
      {error === 'invalid_detail'
        ? 'Raw record detail is invalid and cannot be displayed.'
        : error === 'backend_unavailable'
          ? 'Raw record detail is unavailable because the backend could not be reached.'
          : 'Raw record detail could not be loaded.'}
    </p>
  )
}

function classifyRawDetailLoadError(error: unknown): RawDetailLoadError {
  if (error instanceof InvalidPersistedRawDetailHttpError) return 'invalid_detail'
  return error instanceof TypeError ? 'backend_unavailable' : 'load_failed'
}

function RawDetailConflict({ issue }: { issue: RawDetailIssue }) {
  return (
    <section
      aria-label="Raw normalization detail conflict"
      className="mt-6 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
      role="alert"
    >
      {issue === 'normalization_revision'
        ? 'Exact normalization detail unavailable because the returned normalization does not match the fetched raw revision.'
        : issue === 'candidate_identity'
          ? 'Exact candidate detail unavailable because normalization and projection candidate identities conflict.'
          : issue === 'projection_revision'
            ? 'Exact projection detail unavailable because the returned projection does not match the fetched raw revision.'
            : 'Exact normalization detail unavailable for the fetched raw revision.'}
    </section>
  )
}

function getRawDetailIssue(
  record: RawSourceRecord,
  normalization: RawSourceNormalizationResult | null,
  projection: RawSourceProjectionResult,
): RawDetailIssue | null {
  const rawRevisionId = record.latestRevision.id
  if (projection.rawRecordId !== record.id || projection.rawRevisionId !== rawRevisionId) {
    return 'projection_revision'
  }
  if (!normalization) {
    return projection.normalizationStatus === null ? null : 'normalization_unavailable'
  }
  const candidate = normalization.canonicalCandidate
  if (
    normalization.rawRecordId !== record.id
    || normalization.rawRevisionId !== rawRevisionId
    || (candidate !== null && (
      candidate.rawRecordId !== record.id || candidate.rawRevisionId !== rawRevisionId
    ))
  ) return 'normalization_revision'
  return (candidate?.id ?? null) === projection.canonicalCandidateId
    ? null
    : 'candidate_identity'
}

function RawRecordDetail({ record }: { record: RawSourceRecord }) {
  const revision = record.latestRevision
  const payload = useMemo(
    () => sanitizeRawFacts(revision.payload ?? undefined) as JsonObject | undefined,
    [revision.payload],
  )
  const evidence = useMemo(() => sanitizeRawEvidence(revision.evidence), [revision.evidence])
  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-labelledby="latest-revision-facts">
        <h3 id="latest-revision-facts" className="font-semibold">Latest revision facts</h3>
        <p className="text-xs text-muted-foreground">
          Revision {revision.revision} · {sanitizeDisplayText(revision.id)} · captured by{' '}
          {sanitizeDisplayText(revision.adapter.id)}@{sanitizeDisplayText(revision.adapter.version)}
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Fact label="Title" value={payload?.title} missing="Missing title" />
          <Fact label="Company" value={payload?.company} missing="Missing company" />
          <Fact label="Location" value={payload?.location} missing="Missing location" />
          <Fact label="Description" value={payload?.description} missing="Missing description" />
        </dl>
        {payload ? (
          <pre className="overflow-auto rounded-md border border-border bg-background p-3 text-xs">
            {JSON.stringify(payload, null, 2)}
          </pre>
        ) : <p className="text-sm text-muted-foreground">No safe raw payload facts.</p>}
        {evidence.length > 0 ? (
          <ul aria-label="Sanitized raw evidence" className="space-y-1 text-sm">
            {evidence.map((item, index) => (
              <li key={`${item.kind}-${item.label}-${index}`}>
                {item.label}: {formatValue(item.value)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <CaptureProvenance record={record} />
      <OccurrenceLineage record={record} />
    </div>
  )
}

function CaptureProvenance({ record }: { record: RawSourceRecord }) {
  const revision = record.latestRevision
  const origin = record.reportedOrigin
  return (
    <section aria-label="Capture provenance" className="space-y-2">
      <h3 className="font-semibold">Capture provenance</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <ProvenanceFact
          label="Adapter"
          value={[revision.adapter.id, revision.adapter.kind, revision.adapter.version]
            .map(technicalValue).join(' · ')}
        />
        <ProvenanceFact
          label="Reported origin"
          value={origin
            ? [origin.name, origin.kind, origin.providerId, origin.url]
                .map(technicalValue).join(' · ')
            : 'Unavailable'}
        />
        <ProvenanceFact
          label="Provider identity"
          value={[revision.providerRecordId, revision.providerSchema]
            .map(technicalValue).join(' · ')}
        />
        {record.occurrences.map((occurrence) => (
          <ProvenanceFact
            key={occurrence.id}
            label={`Capture ${technicalValue(occurrence.id)}`}
            value={occurrence.capture
              ? [
                  occurrence.capture.connectorInstanceId,
                  occurrence.capture.connectorRunId,
                  occurrence.capture.executionScopeId,
                ].map(technicalValue).join(' · ')
              : 'Not connector-captured'}
          />
        ))}
      </dl>
    </section>
  )
}

function ProvenanceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  )
}

function technicalValue(value: string | null | undefined) {
  if (!value) return 'Unavailable'
  const sanitized = sanitizeDisplayText(value)
  return sanitized.length <= 512 ? sanitized : 'Detail omitted'
}

function Fact({ label, missing, value }: { label: string; missing: string; value: unknown }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? missing : formatValue(value)}</dd>
    </div>
  )
}

function OccurrenceLineage({ record }: { record: RawSourceRecord }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">Occurrence and revision lineage</h3>
      <p className="text-xs text-muted-foreground">
        Historical payloads are not returned by this read; occurrence rows preserve their immutable revision identifiers.
      </p>
      <Table aria-label="Occurrence and revision lineage">
        <TableHeader><TableRow>
          <TableHead>Occurrence</TableHead><TableHead>Revision</TableHead>
          <TableHead>Received</TableHead><TableHead>Connector run</TableHead>
        </TableRow></TableHeader>
        <TableBody>{record.occurrences.map((occurrence) => (
          <TableRow key={occurrence.id}>
            <TableCell>{sanitizeDisplayText(occurrence.id)}</TableCell>
            <TableCell>{sanitizeDisplayText(occurrence.rawRevisionId)}</TableCell>
            <TableCell>{formatTimestamp(occurrence.receivedAt)}</TableCell>
            <TableCell>
              {occurrence.capture?.connectorRunId
                ? sanitizeDisplayText(occurrence.capture.connectorRunId)
                : 'Not connector-captured'}
            </TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </section>
  )
}

function formatValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
