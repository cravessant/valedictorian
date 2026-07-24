import { useState } from 'react'
import type {
  CompanyDuplicateCandidateRow,
  WorkspaceCompaniesClient,
} from '@sparxie/sdk'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  DESKTOP_USER_ACTOR,
  newIdempotencyKey,
} from '@/modules/lifecycle-table/lifecycle-actor'

export function CompanyDuplicateReviewModal({
  candidate,
  client,
  onChanged,
  onClose,
  workspaceId,
}: {
  readonly candidate: CompanyDuplicateCandidateRow
  readonly client: WorkspaceCompaniesClient
  readonly onChanged: () => void
  readonly onClose: () => void
  readonly workspaceId: string
}) {
  const [rationale, setRationale] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [idempotencyKey] = useState(() => newIdempotencyKey('company-mark-distinct'))

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Review possible duplicate</DialogTitle>
          <DialogDescription>
            Compare both workspace identities before marking this pair as distinct.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <CompanySummary side="First Company" company={candidate.left} />
          <CompanySummary side="Second Company" company={candidate.right} />
        </div>
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
        <div className="space-y-2">
          <Label htmlFor="distinct-rationale">Rationale</Label>
          <Textarea
            id="distinct-rationale"
            autoFocus
            value={rationale}
            disabled={pending}
            placeholder="Explain why these are separate Companies."
            onChange={(event) => {
              setRationale(event.target.value)
              setFailure(null)
            }}
          />
          <p className="text-xs text-muted-foreground">
            This decision is recorded and remains in effect while both Company inputs are unchanged.
          </p>
        </div>
        {failure ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {failure}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={async () => {
              if (!rationale.trim()) {
                setFailure('Rationale is required.')
                return
              }
              setPending(true)
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
                  idempotencyKey,
                })
                if (result.status === 'blocked') {
                  setFailure(result.failure.blocker.message)
                  return
                }
                onChanged()
                onClose()
              } catch (error) {
                setFailure(error instanceof Error
                  ? error.message
                  : 'The distinct decision could not be recorded.')
              } finally {
                setPending(false)
              }
            }}
          >
            {pending ? <Spinner aria-label="Marking Companies distinct" /> : null}
            Mark distinct
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
