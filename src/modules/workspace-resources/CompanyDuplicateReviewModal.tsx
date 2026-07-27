import { useState } from 'react'
import type {
  CompanyDuplicateCandidateRow,
  MergeCompaniesResult,
} from '@sparxie/sdk'
import type { LocalWorkspaceCompaniesClient } from '../../runtime/local-connector-client.contract'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  DESKTOP_USER_ACTOR,
  newIdempotencyKey,
} from '@/modules/lifecycle-table/lifecycle-actor'

type MergedResult = Extract<MergeCompaniesResult, { status: 'merged' }>

export function CompanyDuplicateReviewModal({
  candidate,
  client,
  onChanged,
  onClose,
  onOpenCompany,
  workspaceId,
}: {
  readonly candidate: CompanyDuplicateCandidateRow
  readonly client: LocalWorkspaceCompaniesClient
  readonly onChanged: () => void
  readonly onClose: () => void
  readonly onOpenCompany: (companyId: string) => void
  readonly workspaceId: string
}) {
  const [rationale, setRationale] = useState('')
  const [winnerId, setWinnerId] = useState<string | null>(null)
  const [loserConfirmation, setLoserConfirmation] = useState('')
  const [acknowledgeNoUndo, setAcknowledgeNoUndo] = useState(false)
  const [pending, setPending] = useState<'distinct' | 'merge' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [mergedResult, setMergedResult] = useState<MergedResult | null>(null)
  const [distinctKey] = useState(() => newIdempotencyKey('company-mark-distinct'))
  const [mergeKey] = useState(() => newIdempotencyKey('company-merge'))
  const winner = winnerId === candidate.left.companyId
    ? candidate.left
    : winnerId === candidate.right.companyId ? candidate.right : null
  const loser = winner === candidate.left
    ? candidate.right
    : winner === candidate.right ? candidate.left : null
  const canMarkDistinct = candidate.status === 'open'
  const canMerge = candidate.status !== 'resolved_by_merge'
  const mergeReady = Boolean(
    winner
    && loser
    && rationale.trim()
    && loserConfirmation === loser.displayName
    && acknowledgeNoUndo,
  )
  const close = () => {
    if (mergedResult) onChanged()
    onClose()
  }

  async function markDistinct() {
    if (!rationale.trim()) {
      setFailure('Rationale is required.')
      return
    }
    setPending('distinct')
    setFailure(null)
    try {
      const result = await client.duplicates.markDistinct({
        workspaceId,
        candidateId: candidate.candidateId,
        expectedCandidateRevision: candidate.candidateRevision,
        leftCompanyId: candidate.left.companyId,
        expectedLeftCompanyRevision: candidate.left.revision,
        rightCompanyId: candidate.right.companyId,
        expectedRightCompanyRevision: candidate.right.revision,
        actor: DESKTOP_USER_ACTOR,
        rationale: rationale.trim(),
        idempotencyKey: distinctKey,
      })
      if (result.status === 'blocked') {
        setFailure(result.failure.blocker.message)
        return
      }
      onChanged()
      onClose()
    } catch (error) {
      setFailure(message(error, 'The distinct decision could not be recorded.'))
    } finally {
      setPending(null)
    }
  }

  async function merge() {
    if (!winner || !loser || !mergeReady) {
      setFailure('Choose the Company to keep and complete the no-undo confirmation.')
      return
    }
    setPending('merge')
    setFailure(null)
    try {
      const result = await client.duplicates.merge({
        workspaceId,
        winnerCompanyId: winner.companyId,
        expectedWinnerCompanyRevision: winner.revision,
        loserCompanyId: loser.companyId,
        expectedLoserCompanyRevision: loser.revision,
        actor: DESKTOP_USER_ACTOR,
        rationale: rationale.trim(),
        loserDisplayNameConfirmation: loserConfirmation,
        acknowledgeNoUndo: true,
        idempotencyKey: mergeKey,
      })
      if (result.status === 'blocked') {
        setFailure(result.failure.blocker.message)
        return
      }
      setMergedResult(result)
    } catch (error) {
      setFailure(message(error, 'The Companies could not be merged.'))
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) close() }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-4xl sm:p-6">
        {mergedResult ? (
          <MergeConfirmation
            result={mergedResult}
            onClose={close}
            onOpenCompany={(companyId) => {
              onChanged()
              onOpenCompany(companyId)
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review possible duplicate</DialogTitle>
              <DialogDescription>
                Compare both identities, then keep them separate or choose exactly
                which Company becomes canonical.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 md:grid-cols-2">
              <CompanySummary side="First Company" company={candidate.left} />
              <CompanySummary side="Second Company" company={candidate.right} />
            </div>
            <SuggestionReason candidate={candidate} />
            <div className="space-y-2">
              <Label htmlFor="company-review-rationale">Rationale</Label>
              <Textarea
                id="company-review-rationale"
                autoFocus
                value={rationale}
                disabled={pending !== null}
                placeholder="Explain why these identities should remain separate or be merged."
                onChange={(event) => {
                  setRationale(event.target.value)
                  setFailure(null)
                }}
              />
            </div>
            {canMerge ? (
              <MergeControls
                acknowledgeNoUndo={acknowledgeNoUndo}
                candidate={candidate}
                disabled={pending !== null}
                loser={loser}
                loserConfirmation={loserConfirmation}
                winnerId={winnerId}
                onAcknowledge={setAcknowledgeNoUndo}
                onConfirmation={setLoserConfirmation}
                onWinner={(value) => {
                  setWinnerId(value)
                  setLoserConfirmation('')
                  setAcknowledgeNoUndo(false)
                  setFailure(null)
                }}
              />
            ) : (
              <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                This candidate was resolved by a confirmed Company merge.
              </p>
            )}
            {failure ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {failure}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending !== null}
                onClick={close}
              >
                Cancel
              </Button>
              {canMarkDistinct ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending !== null}
                  onClick={() => void markDistinct()}
                >
                  {pending === 'distinct'
                    ? <Spinner aria-label="Marking Companies distinct" />
                    : null}
                  Mark distinct
                </Button>
              ) : null}
              {canMerge ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending !== null || !mergeReady}
                  onClick={() => void merge()}
                >
                  {pending === 'merge' ? <Spinner aria-label="Merging Companies" /> : null}
                  Merge Companies
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MergeControls({
  acknowledgeNoUndo,
  candidate,
  disabled,
  loser,
  loserConfirmation,
  onAcknowledge,
  onConfirmation,
  onWinner,
  winnerId,
}: {
  readonly acknowledgeNoUndo: boolean
  readonly candidate: CompanyDuplicateCandidateRow
  readonly disabled: boolean
  readonly loser: CompanyDuplicateCandidateRow['left'] | null
  readonly loserConfirmation: string
  readonly onAcknowledge: (checked: boolean) => void
  readonly onConfirmation: (value: string) => void
  readonly onWinner: (companyId: string) => void
  readonly winnerId: string | null
}) {
  return (
    <section className="space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <div>
        <h3 className="font-medium">Merge these Companies</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the identity to keep. Jobs move to it, and this cannot be undone.
        </p>
      </div>
      <RadioGroup
        aria-label="Canonical Company"
        disabled={disabled}
        value={winnerId ?? ''}
        onValueChange={onWinner}
      >
        {[candidate.left, candidate.right].map((company) => {
          const id = `canonical-company-${company.companyId}`
          return (
            <div key={company.companyId} className="flex items-center gap-2">
              <RadioGroupItem id={id} value={company.companyId} />
              <Label htmlFor={id}>Keep {company.displayName}</Label>
            </div>
          )
        })}
      </RadioGroup>
      {loser ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="loser-display-name-confirmation">
              Type {loser.displayName} to confirm
            </Label>
            <Input
              id="loser-display-name-confirmation"
              value={loserConfirmation}
              disabled={disabled}
              autoComplete="off"
              onChange={(event) => onConfirmation(event.target.value)}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="acknowledge-no-undo"
              checked={acknowledgeNoUndo}
              disabled={disabled}
              onCheckedChange={(checked) => onAcknowledge(checked === true)}
            />
            <Label htmlFor="acknowledge-no-undo" className="leading-5">
              I understand this merge is permanent and has no undo or split action.
            </Label>
          </div>
        </>
      ) : null}
    </section>
  )
}

function SuggestionReason({
  candidate,
}: {
  readonly candidate: CompanyDuplicateCandidateRow
}) {
  return (
    <section className="rounded-md border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Why this pair was suggested</h3>
        <Badge variant="secondary" className="tabular-nums">
          {Math.round(candidate.score * 100)}% confidence
        </Badge>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {candidate.reasons.map((reason) => (
          <li key={reason.code}>{reason.label}</li>
        ))}
      </ul>
    </section>
  )
}

function MergeConfirmation({
  onClose,
  onOpenCompany,
  result,
}: {
  readonly onClose: () => void
  readonly onOpenCompany: (companyId: string) => void
  readonly result: MergedResult
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Companies merged</DialogTitle>
        <DialogDescription>
          The server confirmed {result.merged.displayName} now redirects to{' '}
          {result.canonical.displayName}.
        </DialogDescription>
      </DialogHeader>
      <section className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        <p>
          {result.reassignedJobCount}{' '}
          {result.reassignedJobCount === 1 ? 'Job was' : 'Jobs were'} moved.
        </p>
        <p className="mt-1 text-muted-foreground">
          The losing Company’s notes and history remain available.
        </p>
      </section>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        <Button asChild>
          <a
            href={`?view=companies&resourceId=${encodeURIComponent(result.canonical.id)}`}
            onClick={(event) => {
              event.preventDefault()
              onOpenCompany(result.canonical.id)
            }}
          >
            View canonical Company
          </a>
        </Button>
      </DialogFooter>
    </>
  )
}

function CompanySummary({
  company,
  side,
}: {
  readonly company: CompanyDuplicateCandidateRow['left']
  readonly side: string
}) {
  return (
    <section className="min-w-0 rounded-md border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {side}
      </p>
      <h3 className="mt-1 break-words text-lg font-semibold">{company.displayName}</h3>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Website</dt>
        <dd className="min-w-0 break-all">{company.websiteUrl ?? 'Not declared'}</dd>
        <dt className="text-muted-foreground">Assigned Jobs</dt>
        <dd>{company.assignedJobCount}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="capitalize">{company.status}</dd>
      </dl>
    </section>
  )
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
