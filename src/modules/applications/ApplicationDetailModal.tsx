import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLinkButton } from '@/components/ExternalLinkButton'
import { Skeleton } from '@/components/ui/skeleton'
import { ModalShell } from '@/components/ui/modal-shell'
import { AlertCircle, X } from 'lucide-react'
import type { ScoreInput, ScoreRecord, VerificationReceiptPayload } from 'sparxie'
import type { ApplicationDetailSeed } from '../../app/types'
import { formatTimestamp } from '../../app/format'
import type {
  ApplicationAttempt,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationLinkRecord,
  CreateApplicationLinkInput,
  UpdateApplicationLinkInput,
} from './application.types'

interface ApplicationDetailModalProps {
  application: ApplicationDetail | ApplicationDetailSeed
  attempts: ApplicationAttempt[]
  attemptsError: string | null
  detailError: string | null
  events: ApplicationEvent[]
  eventsError: string | null
  isAttemptsLoading: boolean
  isDetailLoading: boolean
  isEventsLoading: boolean
  isLinksLoading: boolean
  links: ApplicationLinkRecord[]
  linksError: string | null
  onCreateLink?: (input: CreateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  onRecordScore?: (input: ScoreInput) => Promise<ScoreRecord>
  onUpdateLink?: (input: UpdateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  onClose: () => void
}

function ApplicationDetailModal({
  application,
  attempts,
  attemptsError,
  detailError,
  events,
  eventsError,
  isAttemptsLoading,
  isDetailLoading,
  isEventsLoading,
  isLinksLoading,
  links,
  linksError,
  onCreateLink,
  onRecordScore,
  onUpdateLink,
  onClose,
}: ApplicationDetailModalProps) {
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)
  const [scoreEditorOpen, setScoreEditorOpen] = useState(false)
  const [editingLink, setEditingLink] = useState<ApplicationLinkRecord | null>(null)

  return (
    <>
      <div
        aria-label="Application detail"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
        role="dialog"
      >
        <section className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Application detail
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{application.companyName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{application.roleTitle}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close application detail" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge variant="secondary">{application.status}</Badge>
            {'currentPriorityScore' in application ? (
              <Badge variant={application.currentPriorityScore === null ? 'outline' : 'default'}>
                {application.currentPriorityScore === null ? 'Unscored' : `${application.currentPriorityScore}/10`}
              </Badge>
            ) : null}
            <Badge variant="outline">{attempts.length} attempts</Badge>
            {onRecordScore ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setScoreEditorOpen(true)}>
                Record score
              </Button>
            ) : null}
          </div>
          {isDetailLoading ? (
            <div role="status" aria-label="Application detail loading" className="mb-4">
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : null}
          {detailError ? <InlineLoadError message={detailError} /> : null}
          <section className="mb-4 rounded-md border border-border px-4 py-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Overview
            </p>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd className="font-medium text-foreground">{application.sourceName}</dd>
              </div>
              {'location' in application ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Location</dt>
                  <dd className="font-medium text-foreground">{application.location}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          <section className="mb-4 rounded-md border border-border px-4 py-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Source context
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{application.sourceName}</Badge>
              {application.primaryLink ? (
                <ExternalLinkButton className="px-2" href={application.primaryLink.url}>
                  {application.primaryLink.label}
                </ExternalLinkButton>
              ) : (
                <span className="text-sm text-muted-foreground">No primary link</span>
              )}
            </div>
          </section>

          <section className="mb-4 rounded-md border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Links
              </p>
              {onCreateLink ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setLinkEditorOpen(true)}>
                  Add link
                </Button>
              ) : null}
            </div>
            {isLinksLoading ? (
              <div role="status" aria-label="Application links loading" className="mt-2 space-y-2">
                <Skeleton className="h-8 w-48" />
              </div>
            ) : linksError ? (
              <InlineLoadError message={linksError} />
            ) : links.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No links recorded.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {links.map((link) => (
                  <div key={link.id} className="flex items-center gap-1">
                    <ExternalLinkButton className="px-2" href={link.url}>
                      {link.label}
                    </ExternalLinkButton>
                    {onUpdateLink ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit link ${link.label}`}
                        onClick={() => setEditingLink(link)}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-4 rounded-md border border-border px-4 py-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Events
            </p>
            {isEventsLoading ? (
              <div role="status" aria-label="Application events loading" className="mt-2 space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : eventsError ? (
              <InlineLoadError message={eventsError} />
            ) : events.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No events recorded.</p>
            ) : (
              <ol className="mt-2 divide-y divide-border">
                {events.map((event) => (
                  <li key={event.id} className="grid gap-1 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{event.type}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(event.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{event.message}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-md border border-border px-4 py-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Attempts
            </p>

          {isAttemptsLoading ? (
            <div role="status" aria-label="Attempts loading" className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : null}

          {attemptsError ? (
            <Alert variant="destructive" className="bg-card">
              <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
              <div className="pl-7">
                <AlertTitle>Load failed</AlertTitle>
                <AlertDescription>{attemptsError}</AlertDescription>
              </div>
            </Alert>
          ) : null}

          {!isAttemptsLoading && !attemptsError && attempts.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No attempts recorded.</p>
          ) : null}

          {!isAttemptsLoading && !attemptsError && attempts.length > 0 ? (
            <div className="mt-2 space-y-4">
              {attempts.map((attempt) => (
                <section key={attempt.id} className="rounded-md border border-border">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {attempt.summary ?? `Attempt ${attempt.id}`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatTimestamp(attempt.startedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge>{attempt.status}</Badge>
                      {attempt.outcome ? <Badge variant="secondary">{attempt.outcome}</Badge> : null}
                    </div>
                  </div>
                  <ol className="divide-y divide-border">
                    {attempt.steps.map((step) => (
                      <AttemptStepItem key={step.id} step={step} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          ) : null}
          </section>
        </div>
        </section>
      </div>
      {linkEditorOpen && onCreateLink ? (
        <ApplicationLinkEditorModal
          applicationId={application.id}
          mode="add"
          onClose={() => setLinkEditorOpen(false)}
          onCreate={onCreateLink}
        />
      ) : null}
      {editingLink && onUpdateLink ? (
        <ApplicationLinkEditorModal
          applicationId={application.id}
          link={editingLink}
          mode="edit"
          onClose={() => setEditingLink(null)}
          onUpdate={onUpdateLink}
        />
      ) : null}
      {scoreEditorOpen && onRecordScore ? (
        <ScoreEditorModal
          applicationId={application.id}
          onClose={() => setScoreEditorOpen(false)}
          onRecordScore={onRecordScore}
        />
      ) : null}
    </>
  )
}

function ApplicationLinkEditorModal({
  applicationId,
  link,
  mode,
  onClose,
  onCreate,
  onUpdate,
}: {
  applicationId: string
  link?: ApplicationLinkRecord
  mode: 'add' | 'edit'
  onClose: () => void
  onCreate?: (input: CreateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  onUpdate?: (input: UpdateApplicationLinkInput) => Promise<ApplicationLinkRecord>
}) {
  const [label, setLabel] = useState(link?.label ?? 'source')
  const [kind, setKind] = useState(link?.kind ?? 'source')
  const [url, setUrl] = useState(link?.url ?? '')
  const [isPrimary, setIsPrimary] = useState(link?.isPrimary ?? false)
  const [error, setError] = useState<string | null>(null)
  const title = mode === 'add' ? 'Add application link' : 'Edit application link'

  async function saveLink() {
    setError(null)

    try {
      if (mode === 'add' && onCreate) {
        await onCreate({
          applicationId,
          kind: kind.trim(),
          label: label.trim(),
          url: url.trim(),
          ...(isPrimary ? { isPrimary } : {}),
        })
      } else if (mode === 'edit' && onUpdate && link) {
        await onUpdate({
          applicationId,
          isPrimary,
          kind: kind.trim(),
          label: label.trim(),
          linkId: link.id,
          url: url.trim(),
        })
      }

      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="grid gap-4">
        {error ? <InlineLoadError message={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <CompactModalInput label="Link label" value={label} onChange={setLabel} />
          <CompactModalInput label="Link kind" value={kind} onChange={setKind} />
          <div className="sm:col-span-2">
            <CompactModalInput label="Link URL" value={url} onChange={setUrl} />
          </div>
          <label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
            <input
              aria-label="Primary link"
              checked={isPrimary}
              className="h-4 w-4 accent-primary"
              type="checkbox"
              onChange={(event) => setIsPrimary(event.target.checked)}
            />
            <span>Primary link</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={saveLink}>
            Save link
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

function ScoreEditorModal({
  applicationId,
  onClose,
  onRecordScore,
}: {
  applicationId: string
  onClose: () => void
  onRecordScore: (input: ScoreInput) => Promise<ScoreRecord>
}) {
  const [score, setScore] = useState('8')
  const [band, setBand] = useState('high')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function saveScore() {
    const numericScore = Number(score)
    setError(null)

    try {
      await onRecordScore({
        applicationId,
        band: band.trim(),
        careerSignal: numericScore,
        cityWorkMode: numericScore,
        compensationLogistics: numericScore,
        penalties: [],
        rationale: rationale.trim(),
        roleRelevance: numericScore,
        rubricVersion: 'human-modal-v1',
        score: numericScore,
      })
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  return (
    <ModalShell title="Record application score" onClose={onClose}>
      <div className="grid gap-4">
        {error ? <InlineLoadError message={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <CompactModalInput label="Score" type="number" value={score} onChange={setScore} />
          <CompactModalInput label="Band" value={band} onChange={setBand} />
          <div className="sm:col-span-2">
            <CompactModalInput label="Rationale" value={rationale} onChange={setRationale} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={saveScore}>
            Save score
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

function CompactModalInput({
  label,
  onChange,
  type = 'text',
  value,
}: {
  label: string
  onChange: (value: string) => void
  type?: string
  value: string
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function AttemptStepItem({ step }: { step: ApplicationAttempt['steps'][number] }) {
  const receipt = parseVerificationReceiptPayload(step)

  if (receipt) {
    return <VerificationReceiptStepItem receipt={receipt} step={step} />
  }

  return (
    <li className="grid gap-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{step.type}</Badge>
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(step.createdAt)}
        </span>
      </div>
      <p className="text-sm text-foreground">{step.message}</p>
    </li>
  )
}

function VerificationReceiptStepItem({
  receipt,
  step,
}: {
  receipt: VerificationReceiptPayload
  step: ApplicationAttempt['steps'][number]
}) {
  return (
    <li className="px-4 py-3">
      <div className="border-l-4 border-l-border bg-muted/40 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{step.type}</Badge>
          <Badge variant={receipt.status === 'passed' ? 'success' : 'warning'}>
            {receipt.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(step.createdAt)}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">{step.message}</p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase text-muted-foreground">Evidence</dt>
            <dd className="mt-1 text-foreground">{receipt.evidence}</dd>
          </div>
          <ReceiptItemList label="Verified" items={receipt.verified} />
          <ReceiptItemList label="Unresolved" items={receipt.unresolved} />
        </dl>
      </div>
    </li>
  )
}

function ReceiptItemList({ items, label }: { items: string[]; label: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      {items.length > 0 ? (
        <dd className="mt-1">
          <ul className="grid gap-1">
            {items.map((item) => (
              <li key={item} className="text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </dd>
      ) : (
        <dd className="mt-1 text-muted-foreground">None</dd>
      )}
    </div>
  )
}

function parseVerificationReceiptPayload(
  step: ApplicationAttempt['steps'][number],
): VerificationReceiptPayload | null {
  if (step.type !== 'verification_receipt') {
    return null
  }

  try {
    const payload = JSON.parse(step.payloadJson) as unknown

    if (!isRecord(payload)) {
      return null
    }

    if (
      payload.version !== 1 ||
      payload.scope !== 'final_review' ||
      (payload.status !== 'passed' && payload.status !== 'failed') ||
      !Array.isArray(payload.verified) ||
      !Array.isArray(payload.unresolved) ||
      typeof payload.evidence !== 'string' ||
      !payload.verified.every((item) => typeof item === 'string') ||
      !payload.unresolved.every((item) => typeof item === 'string')
    ) {
      return null
    }

    return {
      version: 1,
      scope: 'final_review',
      status: payload.status,
      verified: payload.verified,
      unresolved: payload.unresolved,
      evidence: payload.evidence,
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function InlineLoadError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="mt-2 bg-card">
      <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
      <div className="pl-7">
        <AlertTitle>Load failed</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </div>
    </Alert>
  )
}


export { ApplicationDetailModal }
