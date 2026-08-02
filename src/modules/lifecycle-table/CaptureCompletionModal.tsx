import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CaptureCompletionDetailV2,
  CompanyMatchPreview,
  CompanySearchResult,
  CompleteCaptureManuallyV2Input,
  CompleteCaptureManuallyV2Result,
  JobCompanyAssignmentPresentation,
  ManualCompanyResolution,
} from '@sparxie/sdk'
import type { LocalWorkspaceClientV2 } from '@sparxie/valedictorian-local-runtime/local-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { jobFactsTiming } from '@sparxie/valedictorian-local-runtime/job-edge-contract'
import type { CaptureCompletionIntent } from './configs/capture-config'
import { DESKTOP_USER_ACTOR, newIdempotencyKey } from './lifecycle-actor'
import { validateDestinationUrl } from '@sparxie/valedictorian-local-runtime/capture-edge-contract'
import { CaptureDestinationOutcome } from './CaptureDestinationOutcome'

export interface CaptureCompletionCompanySelection {
  readonly companyId: CompanySearchResult['companyId']
  readonly displayName: string
  readonly revision: number
  readonly status: 'active' | 'archived'
}

export interface CaptureCompletionPersistedDraft {
  readonly companyName: string
  readonly companyDisplayName: string
  readonly companyMode: 'create_local' | 'use_local'
  readonly selectedCompany: CaptureCompletionCompanySelection | null
  readonly roleTitle: string
  readonly destinationUrl: string
}

interface Draft extends CaptureCompletionPersistedDraft {
  /** UI-only auto-sync state; it is not part of the persisted completion. */
  readonly companyDisplayNameEdited: boolean
}

type DuplicateDecision = NonNullable<
  CompleteCaptureManuallyV2Input['duplicateResolution']
>
type DuplicateBlocker = Extract<CompleteCaptureManuallyV2Result, { status: 'duplicate_blocked' }>
type AssignmentBlocker = Extract<CompleteCaptureManuallyV2Result, { status: 'company_assignment_blocked' }>
type StaleCompletionResult = Extract<CompleteCaptureManuallyV2Result, { status: 'blocked' }>

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
    readonly selectedCompany: CaptureCompletionCompanySelection
  }
  | { readonly kind: 'stale'; readonly result: StaleCompletionResult }

interface Props {
  readonly captureId: string | null
  readonly client: Pick<
    LocalWorkspaceClientV2,
    'captureResolutionV2' | 'companies' | 'jobs' | 'companyAssignments'
  > | null
  readonly intent: CaptureCompletionIntent | null
  readonly workspaceId: string | null
  readonly onClose: () => void
  readonly onCreated: (jobId: string) => Promise<void> | void
  readonly onAssignmentChanged?: () => Promise<void> | void
  readonly onViewJob?: (jobId: string) => void
  readonly onRemoveCapture?: () => void
  readonly removalPending?: boolean
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
  onRemoveCapture,
  removalPending = false,
}: Props) {
  const [detail, setDetail] = useState<CaptureCompletionDetailV2 | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [initialDraft, setInitialDraft] = useState<Draft | null>(null)
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryFailure, setRecoveryFailure] = useState(false)
  const [reassignment, setReassignment] = useState<JobCompanyAssignmentPresentation | null>(null)
  const [keepPersistedRecovery, setKeepPersistedRecovery] = useState(false)
  // Lookup controls are transient UI state: neither the query nor this filter
  // is persisted by completion or included in the canonical dirty projection.
  const [companyQuery, setCompanyQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [companyMatches, setCompanyMatches] = useState<readonly CompanySearchResult[]>([])
  const [companyPreviews, setCompanyPreviews] = useState<readonly CompanyMatchPreview[]>([])
  const [companyMessage, setCompanyMessage] = useState<string | null>(null)
  const recoveryRef = useRef<HTMLElement>(null)
  const idempotencyKeyRef = useRef('')
  const needsFreshIdempotencyKeyRef = useRef(false)
  const open = captureId !== null
  // A null intent is the explicit resolution-details mode. The server exposes
  // no supported completion action for the Capture, so this mode is read-only:
  // no completion editor, no mutation controls, and no completion call.
  const detailsMode = intent === null

  useEffect(() => {
    if (!captureId || !client) return
    let active = true
    const persistedRecoveryIntent = recoveryIntent(intent)
    setDetail(null)
    setDraft(null)
    setInitialDraft(null)
    setDiscardConfirmationOpen(false)
    setMessage(null)
    setRecovery(null)
    setRecoveryLoading(Boolean(persistedRecoveryIntent))
    setRecoveryFailure(false)
    setReassignment(null)
    setKeepPersistedRecovery(Boolean(persistedRecoveryIntent))
    setCompanyQuery('')
    setIncludeArchived(false)
    setCompanyMatches([])
    setCompanyPreviews([])
    setCompanyMessage(null)
    idempotencyKeyRef.current = newIdempotencyKey(`capture-completion-${captureId}`)
    needsFreshIdempotencyKeyRef.current = false
    void client.captureResolutionV2.get(captureId).then((next) => {
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

  const selectCompany = useCallback((company: CaptureCompletionCompanySelection) => {
    setDraft((current) => current ? {
      ...current,
      companyMode: 'use_local',
      selectedCompany: company,
    } : current)
  }, [])

  const draftDirty = draft !== null
    && initialDraft !== null
    && !samePersistedCaptureCompletionDraft(draft, initialDraft)
  const dismissLabel = detailsMode ? 'Close' : draftDirty ? 'Discard changes' : 'Cancel'
  const interactionPending = pending || removalPending

  function closeModal() {
    setDiscardConfirmationOpen(false)
    onClose()
  }

  function requestClose() {
    if (interactionPending) return
    if (draftDirty) {
      setDiscardConfirmationOpen(true)
      return
    }
    closeModal()
  }

  async function refreshGuards() {
    if (!captureId || !client || pending) return
    setPending(true)
    setMessage(null)
    try {
      const persistedRecoveryIntent = keepPersistedRecovery ? recoveryIntent(intent) : null
      const [next, nextRecovery] = await Promise.all([
        client.captureResolutionV2.get(captureId),
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
    // Defensive: resolution-details mode must never reach the mutation, even
    // if a handler were triggered indirectly.
    if (!detail || !client || detailsMode) return
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
      const result = await client.captureResolutionV2.complete({
        captureId: detail.captureId,
        expectedCaptureRevision: detail.captureRevision,
        expectedGenerationId: detail.expectedGenerationId,
        idempotencyKey: idempotencyKeyRef.current,
        actor: DESKTOP_USER_ACTOR,
        jobFacts: jobFactsFromDraft(detail, value),
        destination: { url: value.destinationUrl },
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
  const destinationValidation = draft ? validateDestinationUrl(draft.destinationUrl) : null

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
      <DialogContent
        showCloseButton={!interactionPending}
        data-probe="capture-completion-shell"
        className="flex h-[100dvh] w-full min-w-0 max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:max-w-[72rem] sm:rounded-md"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          requestClose()
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          requestClose()
        }}
      >
        <DialogHeader data-probe="capture-completion-header" className="shrink-0 border-b px-5 py-5 pr-14">
          <DialogTitle>{detailsMode ? 'Capture resolution details' : 'Complete Capture into a Job'}</DialogTitle>
          <DialogDescription className="break-words">{detailsMode
            ? 'This Capture has no supported completion action. These resolution details are read-only.'
            : 'Confirm the evidence and select the local Company that will group this Job.'}</DialogDescription>
        </DialogHeader>
        <div
          data-probe="capture-completion-body"
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4"
          style={{ scrollbarGutter: 'stable' }}
        >
          {!detail || !draft ? <p className="text-sm text-muted-foreground">Loading Capture provenance…</p> : (
            <div className="space-y-4">
              <section
                aria-label="Provenance path"
                data-probe="capture-completion-provenance"
                className="min-w-0 rounded-md border border-primary/35 bg-muted/45 px-4 py-3"
              >
                <p className="text-xs font-medium tracking-wide text-primary">CAPTURE PROVENANCE</p>
                <div className="mt-2 flex min-w-0 flex-col gap-2 text-sm sm:flex-row sm:items-center">
                  <span className="min-w-0 break-words"><span className="font-medium">Source</span> {detail.sourceSummary.displayName}</span>
                  <span aria-hidden="true" className="hidden text-primary sm:inline">→</span>
                  <span className="min-w-0 break-words"><span className="font-medium">Resolved destination</span> <span data-probe="capture-completion-provenance-url" className="break-all font-mono text-xs">{detail.destination.url ?? 'No resolved destination'}</span></span>
                </div>
              </section>
              <CaptureDestinationOutcome
                destination={detail.destination}
                issue={detail.lastIssue}
              />
              <div className={detailsMode ? 'min-w-0' : 'grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)]'}>
              <section aria-label="Capture source" data-probe="capture-completion-source" className="min-w-0 space-y-3 rounded-md border bg-muted/30 p-4">
                <h3 className="font-medium">Source evidence</h3>
                <p className="break-words text-sm">{detail.sourceSummary.displayName}</p>
                <p className="break-words text-xs text-muted-foreground">Observed {new Date(detail.sourceSummary.observedAt).toLocaleString()}</p>
                <details className="min-w-0">
                  <summary className="cursor-pointer text-sm font-medium">Raw evidence ({detail.rawEvidence.length})</summary>
                  <ul data-probe="capture-completion-raw-evidence" className="mt-2 max-w-full space-y-2 overflow-x-auto rounded border bg-background/70 font-mono text-xs text-muted-foreground">
                    {detail.rawEvidence.map((evidence) => (
                      <li key={`${evidence.captureRevision}-${evidence.evidenceIndex}`} className="min-w-max px-2 py-1 whitespace-pre">
                        <span className="font-sans font-medium text-foreground">{evidence.label}:</span> {evidence.displayValue}
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
              {detailsMode ? null : (
              <section aria-label="Job destination" data-probe="capture-completion-destination" className="min-w-0 space-y-4">
                <h3 className="font-medium">Destination Job</h3>
                <label data-probe="capture-completion-company-field" className="grid min-w-0 gap-1 text-sm">
                  Job facts company
                  <input
                    autoFocus
                    className="w-full min-w-0 rounded-md border bg-background px-3 py-2"
                    disabled={interactionPending}
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
                <label data-probe="capture-completion-role-field" className="grid min-w-0 gap-1 text-sm">
                  Role title
                  <input
                    className="w-full min-w-0 rounded-md border bg-background px-3 py-2"
                    disabled={interactionPending}
                    value={draft.roleTitle}
                    onChange={(event) => setDraft({ ...draft, roleTitle: event.target.value })}
                  />
                </label>
                <label data-probe="capture-completion-url-field" className="grid min-w-0 gap-1 text-sm">
                  Destination URL
                  <input
                    className="w-full min-w-0 rounded-md border bg-background px-3 py-2 font-mono text-xs"
                    disabled={interactionPending}
                    inputMode="url"
                    value={draft.destinationUrl}
                    onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })}
                  />
                </label>
                {destinationValidation && !destinationValidation.ok ? (
                  <p role="alert" className="break-words text-xs text-destructive">
                    {destinationValidation.message}
                  </p>
                ) : null}
                <fieldset data-probe="capture-completion-company-choice" className="min-w-0 space-y-3 rounded-md border bg-muted/20 p-3" aria-label="Local Company choice">
                  <legend className="px-1 text-sm font-medium">Local Company</legend>
                  <p className="break-words text-xs text-muted-foreground">This is a single atomic completion; no Company is created before the Job succeeds.</p>
                  <label className="flex min-w-0 items-start gap-2 text-sm">
                    <input
                      checked={draft.companyMode === 'create_local'}
                      disabled={interactionPending}
                      name="company-mode"
                      type="radio"
                      onChange={() => setDraft({ ...draft, companyMode: 'create_local', selectedCompany: null })}
                    />
                    <span className="min-w-0 break-words">Create a local Company inside this Job completion</span>
                  </label>
                  {draft.companyMode === 'create_local' ? (
                    <label className="grid min-w-0 gap-1 text-sm">
                      Local Company display name
                      <input
                        className="w-full min-w-0 rounded-md border bg-background px-3 py-2"
                        disabled={interactionPending}
                        value={draft.companyDisplayName}
                        onChange={(event) => setDraft({
                          ...draft,
                          companyDisplayName: event.target.value,
                          companyDisplayNameEdited: true,
                        })}
                      />
                    </label>
                  ) : null}
                  <label className="flex min-w-0 items-start gap-2 text-sm">
                    <input
                      checked={draft.companyMode === 'use_local'}
                      disabled={interactionPending}
                      name="company-mode"
                      type="radio"
                      onChange={() => setDraft({ ...draft, companyMode: 'use_local' })}
                    />
                    <span className="min-w-0 break-words">Use an existing local Company</span>
                  </label>
                  {draft.companyMode === 'use_local' ? (
                    <div className="space-y-2">
                      <label className="grid min-w-0 gap-1 text-sm">
                        Search active local Companies
                        <input
                          className="w-full min-w-0 rounded-md border bg-background px-3 py-2"
                          disabled={interactionPending}
                          value={companyQuery}
                          onChange={(event) => setCompanyQuery(event.target.value)}
                        />
                      </label>
                      <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <input
                          checked={includeArchived}
                          disabled={interactionPending}
                          type="checkbox"
                          onChange={(event) => setIncludeArchived(event.target.checked)}
                        />
                        <span className="min-w-0 break-words">Include archived Companies for explicit recovery</span>
                      </label>
                      {companyMessage ? <p role="alert" className="break-words text-xs text-destructive">{companyMessage}</p> : null}
                      {companyMatches.length > 0 ? (
                        <ul className="min-w-0 space-y-2" aria-label="Company search results">
                          {companyMatches.map((company) => (
                            <li key={company.companyId} className="flex min-w-0 items-center justify-between gap-3 rounded border bg-background px-2 py-2 text-sm">
                              <span className="min-w-0 break-words">{company.displayName} <span className="text-xs text-muted-foreground">{company.status === 'archived' ? 'Archived — restore on completion' : 'Active'} · rev {company.revision}</span></span>
                              <Button type="button" size="xs" variant="outline" disabled={interactionPending} className="shrink-0" onClick={() => selectCompany(company)}>Use</Button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {selectedCompany ? (
                        <p data-probe="capture-completion-selected-company" className="min-w-0 break-words rounded border border-primary/30 bg-primary/5 px-2 py-2 text-xs" aria-live="polite">
                          Using {selectedCompany.displayName} · rev {selectedCompany.revision} · {selectedCompanyStatus === 'archived' ? 'archived (will restore on completion)' : 'active'}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {companyPreviews.length > 0 ? (
                    <div className="space-y-2 border-t pt-3">
                      <p className="text-xs font-medium">Possible existing Companies</p>
                      <p className="break-words text-xs text-muted-foreground">Advisory only. Choosing one is explicit and does not create or reserve anything.</p>
                      <ul className="space-y-2" aria-label="Advisory Company matches">
                        {companyPreviews.map((company) => (
                          <li key={company.companyId} className="flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="min-w-0 break-words">{company.displayName} · rev {company.revision}</span>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled={interactionPending}
                              className="shrink-0"
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
                {message ? <p data-probe="capture-completion-message" role={recovery ? 'alert' : 'status'} aria-live="polite" className="min-w-0 break-words text-sm text-muted-foreground">{message}</p> : null}
              </section>
              )}
            </div>
              {recoveryLoading ? (
                <p role="status" className="break-words text-sm text-muted-foreground">Loading current completion recovery guards…</p>
              ) : null}
              {recovery ? (
                <RecoveryPanel
                  recovery={recovery}
                  pending={interactionPending}
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
        </div>
        <DialogFooter data-probe="capture-completion-footer" className="shrink-0 border-t px-5 py-4">
          {onRemoveCapture && !detailsMode ? (
            <div className="w-full border-t border-destructive/30 pt-3 sm:mr-auto sm:w-auto sm:border-0 sm:p-0">
              <Button
                type="button"
                variant="destructive"
                disabled={interactionPending}
                onClick={() => { if (!interactionPending) onRemoveCapture() }}
              >
                Remove Capture
              </Button>
            </div>
          ) : null}
          <Button type="button" variant="outline" onClick={requestClose} disabled={interactionPending}>{dismissLabel}</Button>
          {detailsMode ? null : (
          <Button
            type="button"
            disabled={interactionPending || !detail || !draft || recovery !== null || recoveryLoading || recoveryFailure}
            onClick={() => { if (draft) void complete(draft) }}
          >
            {pending ? 'Completing…' : 'Create Job'}
          </Button>
          )}
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

      <AlertDialog
        open={discardConfirmationOpen}
        onOpenChange={(next) => {
          if (!next) setDiscardConfirmationOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing this Capture completion will discard the completion details you changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={interactionPending}
              variant="destructive"
              onClick={() => {
                if (!interactionPending) closeModal()
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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

function draftFromDetail(detail: CaptureCompletionDetailV2): Draft {
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

function normalizedCompletionJobFacts(draft: CaptureCompletionPersistedDraft) {
  return {
    companyName: draft.companyName.trim(),
    roleTitle: draft.roleTitle.trim(),
    destinationUrl: draft.destinationUrl,
  }
}

function jobFactsFromDraft(detail: CaptureCompletionDetailV2, draft: Draft) {
  const normalized = normalizedCompletionJobFacts(draft)
  return {
    companyName: normalized.companyName,
    roleTitle: normalized.roleTitle,
    sourceName: detail.jobDefaults.sourceName ?? detail.sourceSummary.displayName,
    roleKind: detail.jobDefaults.roleKind ?? 'other',
    ...jobFactsTiming({
      terms: detail.jobDefaults.terms ?? [],
      timingMode: detail.jobDefaults.timingMode ?? 'unknown',
      startDate: detail.jobDefaults.startDate ?? null,
      endDate: detail.jobDefaults.endDate ?? null,
    }),
    location: detail.jobDefaults.location ?? null,
    workMode: detail.jobDefaults.workMode ?? 'unknown',
    employmentType: detail.jobDefaults.employmentType ?? 'unknown',
    seniority: detail.jobDefaults.seniority ?? 'unknown',
    compensation: detail.jobDefaults.compensation ?? null,
    postedAt: detail.jobDefaults.postedAt ?? null,
    destination: { url: normalized.destinationUrl },
  }
}

function normalizedCreateLocalCompanyDisplayName(draft: CaptureCompletionPersistedDraft): string {
  return draft.companyDisplayName.trim()
}

function selectedCompanyResolution(
  company: CaptureCompletionCompanySelection,
) {
  return {
    companyId: company.companyId,
    expectedCompanyRevision: company.revision,
    restoreIfArchived: company.status === 'archived',
  }
}

function companyResolutionFromDraft(
  draft: CaptureCompletionPersistedDraft,
): ManualCompanyResolution | null {
  if (draft.companyMode === 'create_local') {
    const displayName = normalizedCreateLocalCompanyDisplayName(draft)
    return displayName ? { action: 'create_local', displayName } : null
  }
  if (!draft.selectedCompany) return null
  return {
    action: 'use_local',
    ...selectedCompanyResolution(draft.selectedCompany),
  }
}

function persistedCompanyActionProjection(draft: CaptureCompletionPersistedDraft) {
  if (draft.companyMode === 'create_local') {
    return {
      action: 'create_local' as const,
      companyDisplayName: normalizedCreateLocalCompanyDisplayName(draft),
    }
  }
  return {
    action: 'use_local' as const,
    selectedCompany: draft.selectedCompany
      ? selectedCompanyResolution(draft.selectedCompany)
      : null,
  }
}

function validateDraft(draft: Draft): string | null {
  if (!draft.companyName.trim() || !draft.roleTitle.trim() || !draft.destinationUrl) {
    return 'Company, role, and destination URL are required.'
  }
  const destination = validateDestinationUrl(draft.destinationUrl)
  return destination.ok ? null : destination.message
}

/**
 * The canonical completion payload state used for both submission and dirty
 * comparison. Search UI and display-name edit history deliberately do not
 * appear here. Text fields and selected Company guards use the same
 * normalization as submission. An incomplete Company action stays explicit so
 * changing modes is still a dirty edit before the action becomes submit-ready.
 */
export function persistedCaptureCompletionDraftProjection(
  draft: CaptureCompletionPersistedDraft,
) {
  const jobFacts = normalizedCompletionJobFacts(draft)
  return {
    jobFacts,
    companyAction: persistedCompanyActionProjection(draft),
  }
}

export function samePersistedCaptureCompletionDraft(
  left: CaptureCompletionPersistedDraft,
  right: CaptureCompletionPersistedDraft,
): boolean {
  return JSON.stringify(persistedCaptureCompletionDraftProjection(left))
    === JSON.stringify(persistedCaptureCompletionDraftProjection(right))
}

type StaleGuard = Extract<
  StaleCompletionResult['failure'],
  { kind: 'stale_guard' }
>['recovery']['guards'][number]

function staleGuardLabel(guard: StaleGuard): string {
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
): Promise<CaptureCompletionCompanySelection> {
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
