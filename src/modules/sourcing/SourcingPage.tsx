import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ModalShell } from '@/components/ui/modal-shell'
import { ExternalLinkButton } from '@/components/ExternalLinkButton'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle, Ban, Pencil } from 'lucide-react'
import {
  manualSourcingDecisionStatuses,
  sourcingMergeStatuses,
  type CreateSourcingFindingInput,
  type ManualSourcingDecisionStatus,
  type SetSourcingFindingDecisionInput,
  type SourcingFinding,
  type SourcingFindingsListResult,
  type SourcingMergeStatus,
  type UpdateSourcingFindingInput,
} from 'sparxie'
import { formatSourcingLocation } from '../../app/format'
import type { ApplicationDetailSeed } from '../../app/types'

interface SourcingPageProps {
  contentColumnClass: string
  error: string | null
  isLoading: boolean
  mergeStatus: SourcingMergeStatus | undefined
  promotingFindingId: string | null
  result: SourcingFindingsListResult
  sourceId: string
  onCreateFinding: (input: CreateSourcingFindingInput) => Promise<SourcingFinding>
  onDecideFinding: (input: SetSourcingFindingDecisionInput) => Promise<SourcingFinding>
  onMergeStatusChange: (mergeStatus: SourcingMergeStatus | undefined) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
  onPreviousPage: () => void
  onNextPage: () => void
  onPromoteFinding: (findingId: string) => void
  onSourceChange: (sourceId: string) => void
  onUpdateFinding: (input: UpdateSourcingFindingInput) => Promise<SourcingFinding>
}

function SourcingPage({
  contentColumnClass,
  error,
  isLoading,
  mergeStatus,
  promotingFindingId,
  result,
  sourceId,
  onCreateFinding,
  onDecideFinding,
  onMergeStatusChange,
  onOpenApplication,
  onPreviousPage,
  onNextPage,
  onPromoteFinding,
  onSourceChange,
  onUpdateFinding,
}: SourcingPageProps) {
  const [addingFinding, setAddingFinding] = useState(false)
  const [editingFinding, setEditingFinding] = useState<SourcingFinding | null>(null)
  const [decidingFinding, setDecidingFinding] = useState<SourcingFinding | null>(null)
  const pageStart = result.total === 0 ? 0 : result.offset + 1
  const pageEnd = Math.min(result.offset + result.items.length, result.total)
  const sourceOptions = Array.from(
    new Map(result.items.map((item) => [item.sourceId, item.sourceName])).entries(),
  ).map(([sourceId, sourceName]) => ({ sourceId, sourceName }))

  return (
    <main className={`flex h-full min-w-0 flex-col overflow-hidden px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
      <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Job automation
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
              Sourcing
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="w-fit border border-border bg-card">
              {result.total} findings
            </Badge>
            <Button type="button" onClick={() => setAddingFinding(true)}>
              Add finding
            </Button>
          </div>
        </header>

        <section aria-label="Sourcing filters" className="rounded-md border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1 text-xs font-medium text-muted-foreground">
              Review
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mergeStatus === 'new' ? 'default' : 'outline'}
                  onClick={() => onMergeStatusChange('new')}
                >
                  Review new
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mergeStatus === 'blocked' ? 'default' : 'outline'}
                  onClick={() => onMergeStatusChange('blocked')}
                >
                  Review blocked
                </Button>
              </div>
            </div>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Source
              <select
                aria-label="Source"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={sourceId}
                onChange={(event) => onSourceChange(event.target.value)}
              >
                <option value="">Any source</option>
                {sourceOptions.map((sourceOption) => (
                  <option key={sourceOption.sourceId} value={sourceOption.sourceId}>
                    {sourceOption.sourceName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Merge status
              <select
                aria-label="Merge status"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={mergeStatus ?? ''}
                onChange={(event) =>
                  onMergeStatusChange(
                    event.target.value ? (event.target.value as SourcingMergeStatus) : undefined,
                  )
                }
              >
                <option value="">Any status</option>
                {sourcingMergeStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {isLoading ? (
          <div
            role="status"
            aria-label="Sourcing findings loading"
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Loading findings...</p>
              <Skeleton className="h-2 w-24" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive" className="bg-card">
            <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
            <div className="pl-7">
              <AlertTitle>Load failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {pageStart}-{pageEnd} of {result.total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous sourcing page"
                disabled={result.offset === 0}
                onClick={onPreviousPage}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next sourcing page"
                disabled={!result.hasMore}
                onClick={onNextPage}
              >
                Next
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table aria-label="Sourcing findings" className="min-w-[1100px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Company</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Merge</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Links</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((item) => (
                  <SourcingFindingRow
                    key={item.id}
                    item={item}
                    isPromoting={promotingFindingId === item.id}
                    onDecideFinding={setDecidingFinding}
                    onEditFinding={setEditingFinding}
                    onOpenApplication={onOpenApplication}
                    onPromoteFinding={onPromoteFinding}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
        {addingFinding ? (
          <SourcingFindingEditorModal
            mode="add"
            onClose={() => setAddingFinding(false)}
            onCreate={onCreateFinding}
          />
        ) : null}
        {editingFinding ? (
          <SourcingFindingEditorModal
            finding={editingFinding}
            mode="edit"
            onClose={() => setEditingFinding(null)}
            onUpdate={onUpdateFinding}
          />
        ) : null}
        {decidingFinding ? (
          <SourcingFindingDispositionModal
            finding={decidingFinding}
            onClose={() => setDecidingFinding(null)}
            onDecide={onDecideFinding}
          />
        ) : null}
      </section>
    </main>
  )
}

function SourcingFindingRow({
  item,
  isPromoting,
  onDecideFinding,
  onEditFinding,
  onOpenApplication,
  onPromoteFinding,
}: {
  item: SourcingFinding
  isPromoting: boolean
  onDecideFinding: (finding: SourcingFinding) => void
  onEditFinding: (finding: SourcingFinding) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
  onPromoteFinding: (findingId: string) => void
}) {
  const canPromote = item.mergeStatus === 'new'
  const decision = getSourcingDecision(item)

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium text-foreground">{item.companyName}</span>
      </TableCell>
      <TableCell>
        <span className="block min-w-64 text-muted-foreground">{item.roleTitle}</span>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{item.sourceName}</Badge>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-muted-foreground">{item.workflowRunId}</span>
      </TableCell>
      <TableCell>
        <span className="block min-w-44 text-muted-foreground">
          {formatSourcingLocation(item)}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={item.priorityScore === null ? 'outline' : 'default'}>
          {item.priorityScore === null ? 'No score' : `${item.priorityScore}/10`}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="grid min-w-40 gap-1">
          <Badge className="w-fit" variant={decision.variant}>
            {item.mergeStatus}
          </Badge>
          <span className="text-xs font-medium text-foreground">{decision.label}</span>
          <span className="text-xs text-muted-foreground">{decision.description}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="grid min-w-56 gap-1 text-muted-foreground">
          <span>
            {item.dispositionReason ??
              item.policyBlocker ??
              item.mergeNotes ??
              item.fitNotes ??
              item.duplicateNotes ??
              item.blocker ??
              'None'}
          </span>
          {item.mergedApplicationId ? (
            <span className="font-mono text-xs">{item.mergedApplicationId}</span>
          ) : null}
          {formatMergedApplicationLabel(item) ? (
            <span className="text-xs">{formatMergedApplicationLabel(item)}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {item.officialUrl ? (
            <ExternalLinkButton className="px-2" href={item.officialUrl}>
              official
            </ExternalLinkButton>
          ) : null}
          {item.sourceUrl ? (
            <ExternalLinkButton className="px-2" href={item.sourceUrl}>
              source
            </ExternalLinkButton>
          ) : null}
          {!item.officialUrl && !item.sourceUrl ? (
            <span className="text-muted-foreground">None</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-w-48 flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Edit finding ${item.companyName}`}
            onClick={() => onEditFinding(item)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Set disposition ${item.companyName}`}
            onClick={() => onDecideFinding(item)}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
          </Button>
          {canPromote ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Promote ${item.companyName}`}
              disabled={isPromoting}
              onClick={() => onPromoteFinding(item.id)}
            >
              {isPromoting ? 'Promoting' : 'Promote'}
            </Button>
          ) : item.mergedApplicationId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Open app ${item.mergedApplicationCompanyName ?? item.companyName}`}
              onClick={() => onOpenApplication(sourcingFindingToApplication(item))}
            >
              Open app
            </Button>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              {decision.actionLabel}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function SourcingFindingDispositionModal({
  finding,
  onClose,
  onDecide,
}: {
  finding: SourcingFinding
  onClose: () => void
  onDecide: (input: SetSourcingFindingDecisionInput) => Promise<SourcingFinding>
}) {
  const initialStatus = manualSourcingDecisionStatuses.includes(
    finding.mergeStatus as ManualSourcingDecisionStatus,
  )
    ? (finding.mergeStatus as ManualSourcingDecisionStatus)
    : 'not_pursued'
  const [mergeStatus, setMergeStatus] = useState<ManualSourcingDecisionStatus>(initialStatus)
  const [mergeNotes, setMergeNotes] = useState(finding.mergeNotes ?? '')
  const [policyBlocker, setPolicyBlocker] = useState(finding.policyBlocker ?? '')
  const [dispositionReason, setDispositionReason] = useState(finding.dispositionReason ?? '')
  const [error, setError] = useState<string | null>(null)

  async function saveDecision() {
    setError(null)

    try {
      await onDecide({
        findingId: finding.id,
        mergeStatus,
        mergeNotes: mergeNotes.trim() || dispositionReason.trim() || null,
        policyBlocker: policyBlocker.trim() || null,
        dispositionReason: dispositionReason.trim() || mergeNotes.trim() || null,
      })
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  return (
    <ModalShell title="Set sourcing disposition" onClose={onClose}>
      <div className="grid gap-4">
        {error ? (
          <Alert variant="destructive" className="bg-card">
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FindingSelect
          label="Disposition"
          value={mergeStatus}
          options={manualSourcingDecisionStatuses}
          onChange={(value) => setMergeStatus(value as ManualSourcingDecisionStatus)}
        />
        <FindingInput
          label="Disposition reason"
          value={dispositionReason}
          onChange={setDispositionReason}
        />
        <FindingInput label="Policy blocker" value={policyBlocker} onChange={setPolicyBlocker} />
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Disposition notes
          <textarea
            aria-label="Disposition notes"
            className="min-h-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={mergeNotes}
            onChange={(event) => setMergeNotes(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={saveDecision}>
            Save disposition
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

function SourcingFindingEditorModal({
  finding,
  mode,
  onClose,
  onCreate,
  onUpdate,
}: {
  finding?: SourcingFinding
  mode: 'add' | 'edit'
  onClose: () => void
  onCreate?: (input: CreateSourcingFindingInput) => Promise<SourcingFinding>
  onUpdate?: (input: UpdateSourcingFindingInput) => Promise<SourcingFinding>
}) {
  const [workflowRunId, setWorkflowRunId] = useState(finding?.workflowRunId ?? '')
  const [sourceName, setSourceName] = useState(finding?.sourceName ?? 'Manual')
  const [companyName, setCompanyName] = useState(finding?.companyName ?? '')
  const [roleTitle, setRoleTitle] = useState(finding?.roleTitle ?? '')
  const [term, setTerm] = useState(finding?.term ?? '')
  const [locationRaw, setLocationRaw] = useState(finding?.locationRaw ?? '')
  const [workMode, setWorkMode] = useState(finding?.workMode ?? 'remote')
  const [officialUrl, setOfficialUrl] = useState(finding?.officialUrl ?? '')
  const [sourceUrl, setSourceUrl] = useState(finding?.sourceUrl ?? '')
  const [postedAge, setPostedAge] = useState(finding?.postedAge ?? '')
  const [priorityScore, setPriorityScore] = useState(
    finding?.priorityScore === null || finding?.priorityScore === undefined ? '' : String(finding.priorityScore),
  )
  const [priorityBand, setPriorityBand] = useState(finding?.priorityBand ?? '')
  const [fitNotes, setFitNotes] = useState(finding?.fitNotes ?? '')
  const [duplicateNotes, setDuplicateNotes] = useState(finding?.duplicateNotes ?? '')
  const [blocker, setBlocker] = useState(finding?.blocker ?? '')
  const [mergeNotes, setMergeNotes] = useState(finding?.mergeNotes ?? '')
  const [error, setError] = useState<string | null>(null)
  const title = mode === 'add' ? 'Add sourcing finding' : 'Edit sourcing finding'

  async function saveFinding() {
    setError(null)

    try {
      if (mode === 'add' && onCreate) {
        const input: CreateSourcingFindingInput = {
          companyName: companyName.trim(),
          roleKind: 'internship',
          roleTitle: roleTitle.trim(),
          sourceName: sourceName.trim(),
          workflowRunId: workflowRunId.trim(),
          workMode: workMode as CreateSourcingFindingInput['workMode'],
        }

        applyOptionalFindingFields(input, {
          duplicateNotes,
          fitNotes,
          locationRaw,
          officialUrl,
          postedAge,
          priorityBand,
          priorityScore,
          sourceUrl,
          term,
        }, { includeNulls: false })

        await onCreate(input)
      } else if (mode === 'edit' && finding && onUpdate) {
        const input: UpdateSourcingFindingInput = {
          companyName: companyName.trim(),
          findingId: finding.id,
          roleTitle: roleTitle.trim(),
          sourceName: sourceName.trim(),
          workMode: workMode as UpdateSourcingFindingInput['workMode'],
        }

        applyOptionalFindingFields(input, {
          blocker,
          duplicateNotes,
          fitNotes,
          locationRaw,
          mergeNotes,
          officialUrl,
          postedAge,
          priorityBand,
          priorityScore,
          sourceUrl,
          term,
        }, { includeNulls: true })

        await onUpdate(input)
      }

      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="grid gap-4">
        {error ? (
          <Alert variant="destructive" className="bg-card">
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid max-h-[70vh] gap-3 overflow-auto pr-1 sm:grid-cols-2">
          {mode === 'add' ? (
            <FindingInput label="Workflow run" value={workflowRunId} onChange={setWorkflowRunId} />
          ) : null}
          <FindingInput label="Source" value={sourceName} onChange={setSourceName} />
          <FindingInput label="Company" value={companyName} onChange={setCompanyName} />
          <FindingInput label="Role" value={roleTitle} onChange={setRoleTitle} />
          <FindingInput label="Term" value={term} onChange={setTerm} />
          <FindingInput label="Location" value={locationRaw} onChange={setLocationRaw} />
          <FindingSelect label="Work mode" value={workMode} options={['remote', 'onsite', 'hybrid', 'unclear']} onChange={(value) => setWorkMode(value as CreateSourcingFindingInput['workMode'])} />
          <FindingInput label="Official URL" value={officialUrl} onChange={setOfficialUrl} />
          <FindingInput label="Source URL" value={sourceUrl} onChange={setSourceUrl} />
          <FindingInput label="Posted age" value={postedAge} onChange={setPostedAge} />
          <FindingInput label="Priority score" value={priorityScore} onChange={setPriorityScore} />
          <FindingInput label="Priority band" value={priorityBand} onChange={setPriorityBand} />
          <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
            Fit notes
            <textarea
              aria-label="Fit notes"
              className="min-h-24 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={fitNotes}
              onChange={(event) => setFitNotes(event.target.value)}
            />
          </label>
          {mode === 'edit' ? (
            <>
              <FindingInput label="Duplicate notes" value={duplicateNotes} onChange={setDuplicateNotes} />
              <FindingInput label="Blocker" value={blocker} onChange={setBlocker} />
              <FindingInput label="Merge notes" value={mergeNotes} onChange={setMergeNotes} />
            </>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={saveFinding}>
            Save finding
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

function FindingInput({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

type EditableFindingPayload = Partial<CreateSourcingFindingInput> & Partial<UpdateSourcingFindingInput>

function applyOptionalFindingFields(
  input: EditableFindingPayload,
  fields: {
    blocker?: string
    duplicateNotes?: string
    fitNotes?: string
    locationRaw?: string
    mergeNotes?: string
    officialUrl?: string
    postedAge?: string
    priorityBand?: string
    priorityScore?: string
    sourceUrl?: string
    term?: string
  },
  options: { includeNulls: boolean },
) {
  assignOptionalString(input, 'term', fields.term, options.includeNulls)
  assignOptionalString(input, 'locationRaw', fields.locationRaw, options.includeNulls)
  assignOptionalString(input, 'officialUrl', fields.officialUrl, options.includeNulls)
  assignOptionalString(input, 'sourceUrl', fields.sourceUrl, options.includeNulls)
  assignOptionalString(input, 'postedAge', fields.postedAge, options.includeNulls)
  assignOptionalString(input, 'priorityBand', fields.priorityBand, options.includeNulls)
  assignOptionalString(input, 'fitNotes', fields.fitNotes, options.includeNulls)
  assignOptionalString(input, 'duplicateNotes', fields.duplicateNotes, options.includeNulls)
  assignOptionalString(input, 'blocker', fields.blocker, options.includeNulls)
  assignOptionalString(input, 'mergeNotes', fields.mergeNotes, options.includeNulls)

  if (fields.priorityScore === undefined) {
    return
  }

  const scoreText = fields.priorityScore.trim()
  if (!scoreText) {
    if (options.includeNulls) {
      input.priorityScore = null
    }
    return
  }

  const score = Number(scoreText)
  if (!Number.isFinite(score)) {
    throw new Error('Priority score must be a number.')
  }
  input.priorityScore = score
}

function assignOptionalString(
  input: EditableFindingPayload,
  key: Exclude<keyof EditableFindingPayload, 'priorityScore'>,
  value: string | undefined,
  includeNulls: boolean,
) {
  if (value === undefined) {
    return
  }

  const trimmed = value.trim()
  if (trimmed) {
    input[key] = trimmed as never
  } else if (includeNulls) {
    input[key] = null as never
  }
}

function FindingSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: readonly string[]
  value: string
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function sourcingFindingToApplication(item: SourcingFinding): ApplicationDetailSeed {
  return {
    id: item.mergedApplicationId ?? item.id,
    companyName: item.mergedApplicationCompanyName ?? item.companyName,
    primaryLink: item.officialUrl
      ? {
          label: 'official',
          url: item.officialUrl,
        }
      : item.sourceUrl
        ? {
            label: 'source',
            url: item.sourceUrl,
          }
        : null,
    roleTitle: item.mergedApplicationRoleTitle ?? item.roleTitle,
    sourceName: item.sourceName,
    status: item.mergeStatus,
  }
}

function getSourcingDecision(item: SourcingFinding): {
  actionLabel: string
  description: string
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'success' | 'warning'
} {
  switch (item.mergeStatus) {
    case 'merged':
      return {
        actionLabel: 'Already promoted',
        description: 'In applications',
        label: 'Promoted',
        variant: 'success',
      }
    case 'duplicate':
      return {
        actionLabel: 'Linked duplicate',
        description: 'Linked to existing application',
        label: 'Duplicate',
        variant: 'outline',
      }
    case 'blocked':
      return {
        actionLabel: 'Fix source data',
        description: 'Needs source data before promotion',
        label: 'Blocked',
        variant: 'warning',
      }
    case 'below_cutoff':
      return {
        actionLabel: 'Below cutoff',
        description: 'Not promoted by scoring cutoff',
        label: 'Below cutoff',
        variant: 'warning',
      }
    case 'not_fit':
      return {
        actionLabel: 'Not fit',
        description: 'Not promoted by fit review',
        label: 'Not fit',
        variant: 'outline',
      }
    case 'not_pursued':
      return {
        actionLabel: 'Not pursued',
        description: 'Skipped by review',
        label: 'Not pursued',
        variant: 'outline',
      }
    case 'archived':
      return {
        actionLabel: 'Archived',
        description: 'Hidden from active review',
        label: 'Archived',
        variant: 'outline',
      }
    case 'new':
    default:
      return {
        actionLabel: 'Promote',
        description: 'Ready to review',
        label: 'New finding',
        variant: 'secondary',
      }
  }
}

function formatMergedApplicationLabel(item: SourcingFinding) {
  if (!item.mergedApplicationCompanyName || !item.mergedApplicationRoleTitle) {
    return null
  }

  return `${item.mergedApplicationCompanyName} - ${item.mergedApplicationRoleTitle}`
}


export { SourcingPage }
