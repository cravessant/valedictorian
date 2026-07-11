import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ModalShell } from '@/components/ui/modal-shell'
import {
  deriveJobTermsFromDateRange,
  formatJobTerms,
  manualSourcingDecisionStatuses,
  roleKinds,
  type CreateSourcingFindingInput,
  type JobTerm,
  type JobTimingMode,
  type ManualSourcingDecisionStatus,
  type SetSourcingFindingDecisionInput,
  type SourcingFinding,
  type SourcingDestinationClass,
  type SourcingUsability,
  type UpdateSourcingFindingInput
} from 'sparxie'
import { formatEnumLabel } from '../../app/labels'
import type { ApplicationDetailSeed } from '../../app/types'

const timingModeOptions = ['unknown', 'terms', 'dates'] as const

export function destinationClassLabel(value: SourcingDestinationClass | null | undefined): string {
  if (value === 'employer_or_ats') {
    return 'Employer / ATS'
  }
  if (value === 'third_party_job_posting') {
    return 'Third-party'
  }
  return 'Unresolved'
}

export function usabilityLabel(value: SourcingUsability): string {
  return value === 'usable' ? 'Projected usable' : 'Retained for review'
}

export function SourcingFindingDispositionModal({
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

export function SourcingFindingEditorModal({
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
  const [roleKind, setRoleKind] = useState<CreateSourcingFindingInput['roleKind']>(
    finding?.roleKind ?? 'internship',
  )
  const [timingMode, setTimingMode] = useState<JobTimingMode>(finding?.timingMode ?? 'unknown')
  const [termsJson, setTermsJson] = useState(finding?.terms?.length ? JSON.stringify(finding.terms, null, 2) : '')
  const [startDate, setStartDate] = useState(finding?.startDate ?? '')
  const [endDate, setEndDate] = useState(finding?.endDate ?? '')
  const [timingLabel, setTimingLabel] = useState(finding?.term ?? '')
  const [locationRaw, setLocationRaw] = useState(finding?.locationRaw ?? '')
  const [workMode, setWorkMode] = useState(finding?.workMode ?? 'unclear')
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
      const timingInput = buildFindingTimingInput({
        endDate,
        startDate,
        timingLabel,
        timingMode,
        termsJson,
      })

      if (mode === 'add' && onCreate) {
        const input: CreateSourcingFindingInput = {
          companyName: companyName.trim(),
          roleKind,
          roleTitle: roleTitle.trim(),
          sourceName: sourceName.trim(),
          workflowRunId: workflowRunId.trim(),
          workMode: workMode as CreateSourcingFindingInput['workMode'],
          ...timingInput,
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
        }, { includeNulls: false })

        await onCreate(input)
      } else if (mode === 'edit' && finding && onUpdate) {
        const input: UpdateSourcingFindingInput = {
          companyName: companyName.trim(),
          findingId: finding.id,
          roleKind,
          roleTitle: roleTitle.trim(),
          sourceName: sourceName.trim(),
          workMode: workMode as UpdateSourcingFindingInput['workMode'],
          ...timingInput,
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
          <FindingSelect label="Role kind" value={roleKind} options={roleKinds} onChange={(value) => setRoleKind(value as CreateSourcingFindingInput['roleKind'])} />
          <FindingTimingFields
            endDate={endDate}
            startDate={startDate}
            timingLabel={timingLabel}
            timingMode={timingMode}
            termsJson={termsJson}
            onEndDateChange={setEndDate}
            onStartDateChange={setStartDate}
            onTimingLabelChange={setTimingLabel}
            onTimingModeChange={setTimingMode}
            onTermsJsonChange={setTermsJson}
          />
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

export function FindingTimingFields({
  endDate,
  onEndDateChange,
  onStartDateChange,
  onTermsJsonChange,
  onTimingLabelChange,
  onTimingModeChange,
  startDate,
  termsJson,
  timingLabel,
  timingMode,
}: {
  endDate: string
  onEndDateChange: (value: string) => void
  onStartDateChange: (value: string) => void
  onTermsJsonChange: (value: string) => void
  onTimingLabelChange: (value: string) => void
  onTimingModeChange: (value: JobTimingMode) => void
  startDate: string
  termsJson: string
  timingLabel: string
  timingMode: JobTimingMode
}) {
  const termsPreview = timingMode === 'terms' ? formatFindingTermsJsonPreview(termsJson) : ''
  const datePreview = timingMode === 'dates'
    ? formatFindingDateTermsPreview(startDate, endDate)
    : ''

  return (
    <>
      <FindingSelect
        label="Timing mode"
        value={timingMode}
        options={timingModeOptions}
        onChange={(value) => onTimingModeChange(value as JobTimingMode)}
      />
      {timingMode === 'unknown' ? (
        <FindingInput label="Timing label" value={timingLabel} onChange={onTimingLabelChange} />
      ) : null}
      {timingMode === 'terms' ? (
        <>
          <FindingTextarea label="Terms JSON" value={termsJson} onChange={onTermsJsonChange} />
          <FindingInput label="Timing summary" value={termsPreview} disabled onChange={() => {}} />
        </>
      ) : null}
      {timingMode === 'dates' ? (
        <>
          <FindingInput label="Start date" value={startDate} onChange={onStartDateChange} />
          <FindingInput label="End date" value={endDate} onChange={onEndDateChange} />
          <FindingInput label="Timing summary" value={datePreview} disabled onChange={() => {}} />
        </>
      ) : null}
    </>
  )
}

export function buildFindingTimingInput({
  endDate,
  startDate,
  termsJson,
  timingLabel,
  timingMode,
}: {
  endDate: string
  startDate: string
  termsJson: string
  timingLabel: string
  timingMode: JobTimingMode
}): Pick<CreateSourcingFindingInput, 'endDate' | 'startDate' | 'term' | 'terms' | 'timingMode'> {
  if (timingMode === 'dates') {
    return {
      timingMode,
      startDate: startDate.trim(),
      endDate: endDate.trim() || null,
    }
  }

  if (timingMode === 'terms') {
    return {
      timingMode,
      terms: parseFindingTermsJsonInput(termsJson),
    }
  }

  return {
    timingMode,
    term: timingLabel.trim() || null,
    terms: [],
    startDate: null,
    endDate: null,
  }
}

export function parseFindingTermsJsonInput(value: string): JobTerm[] {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Terms JSON is required for term timing.')
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Terms JSON must be an array.')
  }

  return parsed as JobTerm[]
}

export function formatFindingTermsJsonPreview(value: string) {
  try {
    return formatJobTerms(parseFindingTermsJsonInput(value))
  } catch {
    return ''
  }
}

export function formatFindingDateTermsPreview(startDate: string, endDate: string) {
  try {
    return formatJobTerms(deriveJobTermsFromDateRange(startDate.trim(), endDate.trim() || null))
  } catch {
    return ''
  }
}

export function FindingInput({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function FindingTextarea({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
      {label}
      <textarea
        aria-label={label}
        className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export type EditableFindingPayload = Partial<CreateSourcingFindingInput> & Partial<UpdateSourcingFindingInput>

export function applyOptionalFindingFields(
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
  },
  options: { includeNulls: boolean },
) {
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

export function assignOptionalString(
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

export function FindingSelect({
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
            {formatEnumLabel(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function formatSourcingTiming(item: SourcingFinding) {
  if (item.term) {
    return item.term
  }

  const termsLabel = formatJobTerms(item.terms)
  return termsLabel || 'Unknown timing'
}

export function sourcingFindingToApplication(item: SourcingFinding): ApplicationDetailSeed {
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

export function getSourcingDecision(item: SourcingFinding): {
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

export function formatMergedApplicationLabel(item: SourcingFinding) {
  if (!item.mergedApplicationCompanyName || !item.mergedApplicationRoleTitle) {
    return null
  }

  return `${item.mergedApplicationCompanyName} - ${item.mergedApplicationRoleTitle}`
}
