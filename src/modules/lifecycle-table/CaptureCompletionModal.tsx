import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CaptureCompletionDetail,
  CompanyMatchPreview,
  CompanySearchResult,
  CompleteCaptureManuallyInput,
  CompleteCaptureManuallyResult,
  JobCompanyAssignmentPresentation,
  ManualCompanyResolution,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { JobCompanyReassignmentModal } from '@/modules/workspace-resources/JobCompanyReassignmentModal'
import type { CaptureCompletionIntent } from './configs/capture-config'
import { DESKTOP_USER_ACTOR, newIdempotencyKey } from './lifecycle-actor'

interface SelectedCompany {
  readonly companyId: CompanySearchResult['companyId']
  readonly displayName: string
  readonly revision: number
  readonly status: 'active' | 'archived'
}

interface Draft {
  readonly companyName: string
  readonly companyDisplayName: string
  readonly companyDisplayNameEdited: boolean
  readonly companyMode: 'create_local' | 'use_local'
  readonly selectedCompany: SelectedCompany | null
  readonly roleTitle: string
  readonly destinationUrl: string
}

type DuplicateDecision = NonNullable<CompleteCaptureManuallyInput['duplicateResolution']>
type DuplicateBlocker = Extract<CompleteCaptureManuallyResult, { status: 'duplicate_blocked' }>
type AssignmentBlocker = Extract<CompleteCaptureManuallyResult, { status: 'company_assignment_blocked' }>

type Recovery =
  | {
    readonly kind: 'duplicate'
    readonly allowedDecisions: DuplicateBlocker['allowedDecisions']
    readonly conflictingJobs: DuplicateBlocker['conflictingJobs']
  }
  | {
    readonly kind: 'assignment'
    readonly allowedRecovery: AssignmentBlocker['allowedRecovery']
    readonly assignment: JobCompanyAssignmentPresentation
    readonly selectedCompany: SelectedCompany
  }
  | { readonly kind: 'stale'; readonly result: Extract<CompleteCaptureManuallyResult, { status: 'blocked' }> }

interface Props {
  readonly captureId: string | null
  readonly client: Pick<
    ValedictorianWorkspaceClient,
    'captureResolution' | 'companies' | 'jobs' | 'companyAssignments'
  > | null
  readonly intent: CaptureCompletionIntent | null
  readonly workspaceId: string | null
  readonly onClose: () => void
  readonly onCreated: (jobId: string) => Promise<void> | void
  readonly onAssignmentChanged?: () => Promise<void> | void
  readonly onViewJob?: (jobId: string) => void
}

export function CaptureCompletionModal({
  captureId,
  client,
  intent,
  workspaceId,
  onClose,
  onCreated,
  onAssignmentChanged,
  onViewJob,
}: Props) {
  const [detail, setDetail] = useState<CaptureCompletionDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [initialDraft, setInitialDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryFailure, setRecoveryFailure] = useState(false)
  const [reassignment, setReassignment] = useState<JobCompanyAssignmentPresentation | null>(null)
  const [keepPersistedRecovery, setKeepPersistedRecovery] = useState(false)
  const [companyQuery, setCompanyQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [companyMatches, setCompanyMatches] = useState<readonly CompanySearchResult[]>([])
  const [companyPreviews, setCompanyPreviews] = useState<readonly CompanyMatchPreview[]>([])
  const [companyMessage, setCompanyMessage] = useState<string | null>(null)
  const recoveryRef = useRef<HTMLElement>(null)
  const idempotencyKeyRef = useRef('')
  const needsFreshIdempotencyKeyRef = useRef(false)
  const open = captureId !== null

  useEffect(() => {
    if (!captureId || !client) return
    let active = true
    const persistedRecoveryIntent = recoveryIntent(intent)
    setDetail(null)
    setDraft(null)
    setInitialDraft(null)
    setMessage(null)
    setRecovery(null)
    setRecoveryLoading(Boolean(persistedRecoveryIntent))
    setRecoveryFailure(false)
    setReassignment(null)
    setKeepPersistedRecovery(Boolean(persistedRecoveryIntent))
    setCompanyMatches([])
    setCompanyPreviews([])
    setCompanyMessage(null)
    idempotencyKeyRef.current = newIdempotencyKey(`capture-completion-${captureId}`)
    needsFreshIdempotencyKeyRef.current = false
    void client.captureResolution.get(captureId).then((next) => {
      if (!active) return
      const nextDraft = draftFromDetail(next)
      setDetail(next)
      setDraft(nextDraft)
      setInitialDraft(nextDraft)
    }, () => {
      if (active) setMessage('The Capture details could not be loaded.')
    })
    if (persistedRecoveryIntent) {
      void hydrateRecovery(client, persistedRecoveryIntent).then((next) => {
        if (!active) return
        setRecovery(next)
        setRecoveryLoading(false)
      }, (error: unknown) => {
        if (!active) return
        setRecoveryLoading(false)
        setRecoveryFailure(true)
        setMessage(errorMessage(error, 'The persisted completion recovery could not be loaded.'))
      })
    }
    return () => { active = false }
  }, [captureId, client, intent])

  useEffect(() => {
    if (!client || !draft?.companyDisplayName.trim()) {
      setCompanyPreviews([])
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void client.companies.previewMatches({
        displayName: draft.companyDisplayName.trim(),
        limit: 5,
      }).then((page) => {
        if (active) setCompanyPreviews(page.items)
      }, () => {
        if (active) setCompanyPreviews([])
      })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [client, draft?.companyDisplayName])

  useEffect(() => {
    if (!client || draft?.companyMode !== 'use_local' || !companyQuery.trim()) {
      setCompanyMatches([])
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void client.companies.search({
        query: companyQuery.trim(),
        scope: includeArchived ? 'active_and_archived' : 'active',
        limit: 8,
      }).then((page) => {
        if (!active) return
        setCompanyMatches(page.items)
        setCompanyMessage(null)
      }, () => {
        if (!active) return
        setCompanyMatches([])
        setCompanyMessage('Company search could not be loaded.')
      })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [client, companyQuery, draft?.companyMode, includeArchived])

  useEffect(() => {
    if (recovery) recoveryRef.current?.focus()
  }, [recovery])

  const selectCompany = useCallback((company: SelectedCompany) => {
    setDraft((current) => current ? {
      ...current,
      companyMode: 'use_local',
      selectedCompany: company,
    } : current)
  }, [])

  function requestClose() {
    if (pending) return
    if (draft && initialDraft && !sameDraft(draft, initialDraft)
      && !window.confirm('Discard the unsaved completion details?')) return
    onClose()
  }

  async function refreshGuards() {
    if (!captureId || !client || pending) return
    setPending(true)
    setMessage(null)
    try {
      const persistedRecoveryIntent = keepPersistedRecovery ? recoveryIntent(intent) : null
      const [next, nextRecovery] = await Promise.all([
        client.captureResolution.get(captureId),
        persistedRecoveryIntent ? hydrateRecovery(client, persistedRecoveryIntent) : Promise.resolve(null),
      ])
      setDetail(next)
      setRecovery(nextRecovery)
      setRecoveryFailure(false)
      idempotencyKeyRef.current = newIdempotencyKey(`capture-completion-${captureId}`)
      needsFreshIdempotencyKeyRef.current = false
      setMessage(nextRecovery
        ? 'Recovery guards refreshed. Review the retained draft, then choose a supported action.'
        : 'Capture guards refreshed. Review the retained draft, then submit again.')
    } catch (error) {
      setRecoveryFailure(true)
      setMessage(errorMessage(error, 'Capture guards could not be refreshed.'))
    } finally {
      setPending(false)
    }
  }

  async function complete(
    value: Draft,
    options: {
      readonly duplicateResolution?: DuplicateDecision
      readonly freshIdempotencyKey?: boolean
    } = {},
  ) {
    if (!detail || !client) return
    const validationMessage = validateDraft(value)
    if (validationMessage) {
      setMessage(validationMessage)
      return
    }
    const companyResolution = companyResolutionFromDraft(value)
    if (!companyResolution) {
      setMessage('Choose an existing local Company or enter a local Company display name.')
      return
    }
    if (options.freshIdempotencyKey || needsFreshIdempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey(`capture-completion-${detail.captureId}`)
      needsFreshIdempotencyKeyRef.current = false
    }
    setPending(true)
    setMessage(null)
    setRecovery(null)
    setRecoveryFailure(false)
    try {
      const result = await client.captureResolution.complete({
        captureId: detail.captureId,
        expectedCaptureRevision: detail.captureRevision,
        expectedGenerationId: detail.expectedGenerationId,
        idempotencyKey: idempotencyKeyRef.current,
        actor: DESKTOP_USER_ACTOR,
        jobFacts: jobFactsFromDraft(detail, value),
        destination: { class: 'employer_or_ats', url: value.destinationUrl },
        externalIdentities: [],
        evidenceReferences: detail.exactEvidenceReferences,
        companyResolution,
        ...(options.duplicateResolution ? { duplicateResolution: options.duplicateResolution } : {}),
      })
      if (result.status === 'created') {
        await onCreated(result.jobId)
        onClose()
        toast({
          title: 'Job created',
          variant: 'success',
          action: onViewJob ? {
            label: 'View Job',
            onClick: () => onViewJob(result.jobId),
          } : undefined,
        })
        return
      }
      if (result.status === 'duplicate_blocked') {
        needsFreshIdempotencyKeyRef.current = true
        setRecovery(duplicateRecovery(result))
        setRecoveryFailure(false)
        setMessage('Choose one of the server-supported duplicate decisions.')
        return
      }
      if (result.status === 'company_assignment_blocked') {
        needsFreshIdempotencyKeyRef.current = true
        setRecoveryLoading(true)
        try {
          setRecovery(await hydrateAssignmentRecovery(client, result))
          setRecoveryFailure(false)
          setMessage('This Job already has a Company assignment.')
        } catch (error) {
          setRecoveryFailure(true)
          setMessage(errorMessage(error, 'The current Job Company assignment could not be loaded.'))
        } finally {
          setRecoveryLoading(false)
        }
        return
      }
      if (result.failure.kind === 'stale_guard') {
        needsFreshIdempotencyKeyRef.current = true
        setRecovery({ kind: 'stale', result })
        setMessage('The Capture or selected Company changed. Refresh guards before resubmitting.')
        return
      }
      needsFreshIdempotencyKeyRef.current = true
      setMessage(result.failure.blocker.message)
    } catch (error) {
      setMessage(errorMessage(error, 'Completion failed.'))
    } finally {
      setPending(false)
    }
  }

  async function useExistingAssignment() {
    if (!draft || recovery?.kind !== 'assignment') return
    const nextDraft = {
      ...draft,
      companyMode: 'use_local' as const,
      selectedCompany: recovery.selectedCompany,
    }
    setDraft(nextDraft)
    await complete(nextDraft, { freshIdempotencyKey: true })
  }

  function openReassignment() {
    if (!workspaceId || recovery?.kind !== 'assignment') return
    setReassignment(recovery.assignment)
  }

  async function refreshAfterReassignment() {
    if (!client || recovery?.kind !== 'assignment') return
    const next = await hydrateAssignmentRecovery(client, {
      existingJobId: recovery.assignment.jobId,
      allowedRecovery: recovery.allowedRecovery,
    })
    setDraft((current) => current ? {
      ...current,
      companyMode: 'use_local',
      selectedCompany: next.selectedCompany,
    } : current)
    setRecovery(null)
    setRecoveryFailure(false)
    setReassignment(null)
    setKeepPersistedRecovery(false)
    idempotencyKeyRef.current = newIdempotencyKey(`capture-completion-${captureId ?? recovery.assignment.jobId}`)
    needsFreshIdempotencyKeyRef.current = false
    try {
      await onAssignmentChanged?.()
      setMessage('Job Company guards refreshed. The retained draft now uses the reassigned Company.')
    } catch (error) {
      setMessage(errorMessage(error, 'The Job Company changed, but the table could not be refreshed.'))
    }
  }

  const selectedCompany = draft?.selectedCompany
  const selectedCompanyStatus = selectedCompany?.status === 'archived' ? 'archived' : 'active'

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
      <DialogContent
        showCloseButton={!pending}
        className="h-[100dvh] w-[100vw] max-w-none overflow-y-auto rounded-none p-5 sm:h-auto sm:max-h-[90dvh] sm:max-w-[72rem] sm:rounded-md"
      >
        <DialogHeader>
          <DialogTitle>Complete Capture into a Job</DialogTitle>
          <DialogDescription>Confirm the evidence and select the local Company that will group this Job.</DialogDescription>
        </DialogHeader>
        {!detail || !draft ? <p className="text-sm text-muted-foreground">Loading Capture provenance…</p> : (
          <div className="space-y-4">
            <section aria-label="Provenance path" className="rounded-md border border-primary/35 bg-muted/45 px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-primary">CAPTURE PROVENANCE</p>
              <div className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
                <span><span className="font-medium">Source</span> {detail.sourceSummary.displayName}</span>
                <span aria-hidden="true" className="hidden text-primary sm:inline">→</span>
                <span><span className="font-medium">Resolved destination</span> <span className="font-mono text-xs">{detail.destination.url ?? 'No resolved destination'}</span></span>
              </div>
            </section>
            <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(24rem,1.2fr)]">
              <section aria-label="Capture source" className="space-y-3 rounded-md border bg-muted/30 p-4">
                <h3 className="font-medium">Source evidence</h3>
                <p className="text-sm">{detail.sourceSummary.displayName}</p>
                <p className="text-xs text-muted-foreground">Observed {new Date(detail.sourceSummary.observedAt).toLocaleString()}</p>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Raw evidence ({detail.rawEvidence.length})</summary>
                  <ul className="mt-2 space-y-2 font-mono text-xs text-muted-foreground">
                    {detail.rawEvidence.map((evidence) => (
                      <li key={`${evidence.captureRevision}-${evidence.evidenceIndex}`}>
                        <span className="font-sans font-medium text-foreground">{evidence.label}:</span> {evidence.displayValue}
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
              <section aria-label="Job destination" className="space-y-4">
                <h3 className="font-medium">Destination Job</h3>
                <label className="grid gap-1 text-sm">
                  Job facts company
                  <input
                    autoFocus
                    className="rounded-md border bg-background px-3 py-2"
                    disabled={pending}
                    value={draft.companyName}
                    onChange={(event) => setDraft((current) => current ? {
                      ...current,
                      companyName: event.target.value,
                      companyDisplayName: current.companyDisplayNameEdited
                        ? current.companyDisplayName
                        : event.target.value,
                    } : current)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Role title
                  <input
                    className="rounded-md border bg-background px-3 py-2"
                    disabled={pending}
                    value={draft.roleTitle}
                    onChange={(event) => setDraft({ ...draft, roleTitle: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Employer or ATS URL
                  <input
                    className="rounded-md border bg-background px-3 py-2 font-mono text-xs"
                    disabled={pending}
                    inputMode="url"
                    value={draft.destinationUrl}
                    onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })}
                  />
                </label>
                <fieldset className="space-y-3 rounded-md border bg-muted/20 p-3" aria-label="Local Company choice">
                  <legend className="px-1 text-sm font-medium">Local Company</legend>
                  <p className="text-xs text-muted-foreground">This is a single atomic completion; no Company is created before the Job succeeds.</p>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      checked={draft.companyMode === 'create_local'}
                      disabled={pending}
                      name="company-mode"
                      type="radio"
                      onChange={() => setDraft({ ...draft, companyMode: 'create_local', selectedCompany: null })}
                    />
                    <span>Create a local Company inside this Job completion</span>
                  </label>
                  {draft.companyMode === 'create_local' ? (
                    <label className="grid gap-1 text-sm">
                      Local Company display name
                      <input
                        className="rounded-md border bg-background px-3 py-2"
                        disabled={pending}
                        value={draft.companyDisplayName}
                        onChange={(event) => setDraft({
                          ...draft,
                          companyDisplayName: event.target.value,
                          companyDisplayNameEdited: true,
                        })}
                      />
                    </label>
                  ) : null}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      checked={draft.companyMode === 'use_local'}
                      disabled={pending}
                      name="company-mode"
                      type="radio"
                      onChange={() => setDraft({ ...draft, companyMode: 'use_local' })}
                    />
                    <span>Use an existing local Company</span>
                  </label>
                  {draft.companyMode === 'use_local' ? (
                    <div className="space-y-2">
                      <label className="grid gap-1 text-sm">
                        Search active local Companies
                        <input
                          className="rounded-md border bg-background px-3 py-2"
                          disabled={pending}
                          value={companyQuery}
                          onChange={(event) => setCompanyQuery(event.target.value)}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          checked={includeArchived}
                          disabled={pending}
                          type="checkbox"
                          onChange={(event) => setIncludeArchived(event.target.checked)}
                        />
                        Include archived Companies for explicit recovery
                      </label>
                      {companyMessage ? <p role="alert" className="text-xs text-destructive">{companyMessage}</p> : null}
                      {companyMatches.length > 0 ? (
                        <ul className="space-y-2" aria-label="Company search results">
                          {companyMatches.map((company) => (
                            <li key={company.companyId} className="flex items-center justify-between gap-3 rounded border bg-background px-2 py-2 text-sm">
                              <span>{company.displayName} <span className="text-xs text-muted-foreground">{company.status === 'archived' ? 'Archived — restore on completion' : 'Active'} · rev {company.revision}</span></span>
                              <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => selectCompany(company)}>Use</Button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {selectedCompany ? (
                        <p className="rounded border border-primary/30 bg-primary/5 px-2 py-2 text-xs" aria-live="polite">
                          Using {selectedCompany.displayName} · rev {selectedCompany.revision} · {selectedCompanyStatus === 'archived' ? 'archived (will restore on completion)' : 'active'}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {companyPreviews.length > 0 ? (
                    <div className="space-y-2 border-t pt-3">
                      <p className="text-xs font-medium">Possible existing Companies</p>
                      <p className="text-xs text-muted-foreground">Advisory only. Choosing one is explicit and does not create or reserve anything.</p>
                      <ul className="space-y-2" aria-label="Advisory Company matches">
                        {companyPreviews.map((company) => (
                          <li key={company.companyId} className="flex items-center justify-between gap-3 text-xs">
                            <span>{company.displayName} · rev {company.revision}</span>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled={pending}
                              onClick={() => selectCompany({ ...company, status: 'active' })}
                            >
                              Use existing
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </fieldset>
              </section>
            </div>
            {recoveryLoading ? (
              <p role="status" className="text-sm text-muted-foreground">Loading current completion recovery guards…</p>
            ) : null}
            {recovery ? (
              <RecoveryPanel
                recovery={recovery}
                pending={pending}
                recoveryRef={recoveryRef}
                onDuplicateDecision={(decision) => {
                  if (draft) void complete(draft, { duplicateResolution: decision, freshIdempotencyKey: true })
                }}
                canReassign={Boolean(workspaceId)}
                onOpenReassignment={openReassignment}
                onRefresh={() => { void refreshGuards() }}
                onUseExisting={() => { void useExistingAssignment() }}
              />
            ) : null}
          </div>
        )}
        {message ? <p role={recovery ? 'alert' : 'status'} aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose} disabled={pending}>Discard</Button>
          <Button
            type="button"
            disabled={pending || !detail || !draft || recovery !== null || recoveryLoading || recoveryFailure}
            onClick={() => { if (draft) void complete(draft) }}
          >
            {pending ? 'Completing…' : 'Create Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
      {reassignment && client && workspaceId ? (
        <JobCompanyReassignmentModal
          key={`${reassignment.jobId}:${reassignment.assignmentRevision}`}
          assignment={reassignment}
          client={client}
          workspaceId={workspaceId}
          onChanged={refreshAfterReassignment}
          onClose={() => setReassignment(null)}
        />
      ) : null}
    </Dialog>
  )
}

function RecoveryPanel({
  recovery,
  pending,
  recoveryRef,
  onDuplicateDecision,
  canReassign,
  onOpenReassignment,
  onRefresh,
  onUseExisting,
}: {
  readonly recovery: Recovery
  readonly pending: boolean
  readonly recoveryRef: React.RefObject<HTMLElement>
  readonly onDuplicateDecision: (decision: DuplicateDecision) => void
  readonly canReassign: boolean
  readonly onOpenReassignment: () => void
  readonly onRefresh: () => void
  readonly onUseExisting: () => void
}) {
  if (recovery.kind === 'duplicate') {
    return (
      <section ref={recoveryRef} tabIndex={-1} role="alert" aria-label="Duplicate Job recovery" className="space-y-3 rounded-md border border-destructive/45 bg-destructive/5 p-4 outline-none">
        <div>
          <h3 className="font-medium">Duplicate Job needs a decision</h3>
          <p className="text-sm text-muted-foreground">Only the decisions supported by the server are available for each conflicting Job.</p>
        </div>
        <div className="space-y-2">
          {recovery.conflictingJobs.map((job) => (
            <article key={job.jobId} className="rounded border bg-background p-3 text-sm">
              <p className="font-medium">Job {job.jobId}</p>
              <p className="text-xs text-muted-foreground">Job facts rev {job.jobFactsRevision} · Company {job.companyId} rev {job.companyRevision} · Assignment rev {job.assignmentRevision}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {recovery.allowedDecisions.map((action) => (
                  <Button
                    key={action}
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() => onDuplicateDecision(action === 'attach' ? {
                      action: 'attach',
                      targetJobId: job.jobId,
                      expectedJobFactsRevision: job.jobFactsRevision,
                      expectedAssignmentRevision: job.assignmentRevision,
                    } : {
                      action: 'merge',
                      targetJobId: job.jobId,
                      expectedJobFactsRevision: job.jobFactsRevision,
                      expectedAssignmentRevision: job.assignmentRevision,
                    })}
                  >
                    {action === 'attach' ? 'Attach to this Job' : 'Merge with this Job'}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    )
  }
  if (recovery.kind === 'assignment') {
    const { assignment } = recovery
    return (
      <section ref={recoveryRef} tabIndex={-1} role="alert" aria-label="Company assignment recovery" className="space-y-3 rounded-md border border-destructive/45 bg-destructive/5 p-4 outline-none">
        <div>
          <h3 className="font-medium">This Job already has a Company</h3>
          <p className="text-sm text-muted-foreground">Job {assignment.jobId} is assigned to Company {assignment.workspaceCompany.companyId} · Company rev {assignment.workspaceCompany.revision} · Assignment rev {assignment.assignmentRevision}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {recovery.allowedRecovery.includes('use_existing_company') ? (
            <Button type="button" size="sm" disabled={pending} onClick={onUseExisting}>Use this existing Company</Button>
          ) : null}
          {recovery.allowedRecovery.includes('reassign_company') ? (
            <Button type="button" size="sm" variant="outline" disabled={pending || !canReassign} onClick={onOpenReassignment}>Reassign Job Company</Button>
          ) : null}
        </div>
        {recovery.allowedRecovery.includes('reassign_company') ? <p className="text-xs text-muted-foreground">The reassignment opens here. This completion draft stays open and refreshes its Company guards when reassignment succeeds.</p> : null}
      </section>
    )
  }
  return (
    <section ref={recoveryRef} tabIndex={-1} role="alert" aria-label="Stale completion guards" className="space-y-3 rounded-md border border-destructive/45 bg-destructive/5 p-4 outline-none">
      <div>
        <h3 className="font-medium">Completion guards changed</h3>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
          {recovery.result.failure.kind === 'stale_guard' ? recovery.result.failure.recovery.guards.map((guard) => (
            <li key={`${guard.kind}-${guard.kind === 'generation' ? guard.currentGenerationId : guard.currentRevision}`}>{staleGuardLabel(guard)}</li>
          )) : null}
        </ul>
      </div>
      <Button type="button" size="sm" disabled={pending} onClick={onRefresh}>Refresh guards and data</Button>
      <p className="text-xs text-muted-foreground">The draft is retained and will not resubmit until you review the refreshed values.</p>
    </section>
  )
}

function draftFromDetail(detail: CaptureCompletionDetail): Draft {
  const companyName = detail.jobDefaults.companyName ?? ''
  return {
    companyName,
    companyDisplayName: companyName,
    companyDisplayNameEdited: false,
    companyMode: 'create_local',
    selectedCompany: null,
    roleTitle: detail.jobDefaults.roleTitle ?? '',
    destinationUrl: detail.destination.url ?? '',
  }
}

function jobFactsFromDraft(detail: CaptureCompletionDetail, draft: Draft) {
  return {
    companyName: draft.companyName.trim(),
    roleTitle: draft.roleTitle.trim(),
    sourceName: detail.jobDefaults.sourceName ?? detail.sourceSummary.displayName,
    roleKind: detail.jobDefaults.roleKind ?? 'other',
    term: detail.jobDefaults.term ?? null,
    terms: detail.jobDefaults.terms ?? [],
    timingMode: detail.jobDefaults.timingMode ?? 'unknown',
    startDate: detail.jobDefaults.startDate ?? null,
    endDate: detail.jobDefaults.endDate ?? null,
    location: detail.jobDefaults.location ?? null,
    workMode: detail.jobDefaults.workMode ?? 'unknown',
    employmentType: detail.jobDefaults.employmentType ?? 'unknown',
    seniority: detail.jobDefaults.seniority ?? 'unknown',
    compensation: detail.jobDefaults.compensation ?? null,
    postedAt: detail.jobDefaults.postedAt ?? null,
    destination: { class: 'employer_or_ats' as const, url: draft.destinationUrl },
  }
}

function companyResolutionFromDraft(draft: Draft): ManualCompanyResolution | null {
  if (draft.companyMode === 'create_local') {
    const displayName = draft.companyDisplayName.trim()
    return displayName ? { action: 'create_local', displayName } : null
  }
  if (!draft.selectedCompany) return null
  return {
    action: 'use_local',
    companyId: draft.selectedCompany.companyId,
    expectedCompanyRevision: draft.selectedCompany.revision,
    restoreIfArchived: draft.selectedCompany.status === 'archived',
  }
}

function validateDraft(draft: Draft): string | null {
  if (!draft.companyName.trim() || !draft.roleTitle.trim() || !draft.destinationUrl) {
    return 'Company, role, and employer or ATS destination are required.'
  }
  try {
    const destination = new URL(draft.destinationUrl)
    if (destination.protocol !== 'https:' || !destination.hostname
      || destination.username || destination.password || destination.search || destination.hash) {
      return 'Use an https employer or ATS URL without credentials, query parameters, or a fragment. The URL will be submitted exactly as entered.'
    }
  } catch {
    return 'Enter a complete employer or ATS URL. The URL will be submitted exactly as entered.'
  }
  return null
}

function sameDraft(left: Draft, right: Draft): boolean {
  return left.companyName === right.companyName
    && left.companyDisplayName === right.companyDisplayName
    && left.companyDisplayNameEdited === right.companyDisplayNameEdited
    && left.companyMode === right.companyMode
    && left.roleTitle === right.roleTitle
    && left.destinationUrl === right.destinationUrl
    && left.selectedCompany?.companyId === right.selectedCompany?.companyId
    && left.selectedCompany?.revision === right.selectedCompany?.revision
    && left.selectedCompany?.status === right.selectedCompany?.status
}

function staleGuardLabel(guard: Extract<Extract<CompleteCaptureManuallyResult, { status: 'blocked' }>['failure'], { kind: 'stale_guard' }>['recovery']['guards'][number]): string {
  if (guard.kind === 'generation') return 'The active processing generation changed.'
  if (guard.kind === 'capture_revision') return `Capture revision changed from ${guard.expectedRevision} to ${guard.currentRevision}.`
  if (guard.kind === 'company_revision') return `Company ${guard.companyId} changed from revision ${guard.expectedRevision} to ${guard.currentRevision}.`
  return `Job ${guard.jobId} assignment changed from revision ${guard.expectedRevision} to ${guard.currentRevision}.`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

type PersistedRecoveryIntent = Extract<CaptureCompletionIntent, {
  readonly kind: 'resolve_duplicate_job' | 'resolve_company_assignment'
}>

type CompletionClient = NonNullable<Props['client']>

function recoveryIntent(
  intent: CaptureCompletionIntent | null,
): PersistedRecoveryIntent | null {
  return intent?.kind === 'resolve_duplicate_job' || intent?.kind === 'resolve_company_assignment'
    ? intent
    : null
}

async function hydrateRecovery(
  client: CompletionClient,
  intent: PersistedRecoveryIntent,
): Promise<Recovery> {
  if (intent.kind === 'resolve_duplicate_job') {
    const conflictingJobs = await Promise.all(intent.conflictingJobIds.map(async (jobId) => {
      const [job, assignment] = await Promise.all([
        client.jobs.get(jobId),
        client.companyAssignments.get(jobId),
      ])
      if (!job || job.removedAt) throw new Error('A conflicting Job is no longer available.')
      const company = await currentAssignmentCompany(client, assignment)
      return {
        jobId,
        jobFactsRevision: job.factsRevision,
        companyId: company.companyId,
        companyRevision: company.revision,
        assignmentRevision: assignment.assignmentRevision,
      }
    }))
    return {
      kind: 'duplicate',
      allowedDecisions: intent.supportedActions,
      conflictingJobs,
    }
  }
  return hydrateAssignmentRecovery(client, {
    existingJobId: intent.jobId,
    allowedRecovery: ['use_existing_company', 'reassign_company'],
  })
}

function duplicateRecovery(result: DuplicateBlocker): Recovery {
  return {
    kind: 'duplicate',
    allowedDecisions: result.allowedDecisions,
    conflictingJobs: result.conflictingJobs,
  }
}

async function hydrateAssignmentRecovery(
  client: CompletionClient,
  result: Pick<AssignmentBlocker, 'existingJobId' | 'allowedRecovery'>,
): Promise<Extract<Recovery, { kind: 'assignment' }>> {
  const [job, assignment] = await Promise.all([
    client.jobs.get(result.existingJobId),
    client.companyAssignments.get(result.existingJobId),
  ])
  if (!job || job.removedAt) throw new Error('The existing Job is no longer available.')
  return {
    kind: 'assignment',
    allowedRecovery: result.allowedRecovery,
    assignment,
    selectedCompany: await currentAssignmentCompany(client, assignment),
  }
}

async function currentAssignmentCompany(
  client: CompletionClient,
  assignment: JobCompanyAssignmentPresentation,
): Promise<SelectedCompany> {
  const lookup = await client.companies.lookup(assignment.workspaceCompany.companyId)
  const company = lookup.requested
  if (company.id !== assignment.workspaceCompany.companyId || company.status === 'merged') {
    throw new Error('The current Job Company assignment is no longer available.')
  }
  return {
    companyId: company.id,
    displayName: company.displayName,
    revision: company.revision,
    status: company.status,
  }
}
