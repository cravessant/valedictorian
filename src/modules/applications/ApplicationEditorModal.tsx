import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ModalShell } from '@/components/ui/modal-shell'
import { Label } from '@/components/ui/label'
import { formatEnumLabel } from '../../app/labels'
import {
  applicationStatuses,
  deriveJobTermsFromDateRange,
  formatJobTerms,
  type ApplicationDetail,
  type ApplicationListItem,
} from './application.types'
import type {
  AppendApplicationNoteInput,
  CreateApplicationInput,
  JobTerm,
  JobTimingMode,
  StatusUpdateInput,
  UpdateApplicationInput,
  UpdateApplicationWorkflowInput,
} from './application.types'

type ApplicationEditorMode = 'add' | 'edit'

interface ApplicationEditorModalProps {
  application?: ApplicationListItem | ApplicationDetail
  mode: ApplicationEditorMode
  onClose: () => void
  onAppendNote: (input: AppendApplicationNoteInput) => Promise<ApplicationDetail>
  onCreate: (input: CreateApplicationInput) => Promise<ApplicationDetail>
  onSaved: () => void
  onUpdate: (input: UpdateApplicationInput) => Promise<ApplicationDetail>
  onUpdateStatus: (input: StatusUpdateInput) => Promise<ApplicationDetail>
  onUpdateWorkflow: (input: UpdateApplicationWorkflowInput) => Promise<ApplicationDetail>
}

const roleKindOptions = ['internship', 'new_grad', 'full_time', 'contract', 'part_time', 'other'] as const
const workModeOptions = ['remote', 'onsite', 'hybrid', 'unclear'] as const
const manualReviewKindOptions = ['overridable', 'non_overridable'] as const
const timingModeOptions = ['unknown', 'terms', 'dates'] as const

type ManualReviewKindSelection = NonNullable<UpdateApplicationWorkflowInput['manualReviewKind']> | ''

function ApplicationEditorModal({
  application,
  mode,
  onClose,
  onAppendNote,
  onCreate,
  onSaved,
  onUpdate,
  onUpdateStatus,
  onUpdateWorkflow,
}: ApplicationEditorModalProps) {
  const [companyName, setCompanyName] = useState(application?.companyName ?? '')
  const [roleTitle, setRoleTitle] = useState(application?.roleTitle ?? '')
  const [sourceName, setSourceName] = useState(application?.sourceName ?? 'LinkedIn')
  const [roleKind, setRoleKind] = useState<CreateApplicationInput['roleKind']>(
    application?.roleKind ?? 'internship',
  )
  const [country, setCountry] = useState('US')
  const [workMode, setWorkMode] = useState<CreateApplicationInput['workMode']>(
    application?.workMode ?? 'remote',
  )
  const [status, setStatus] = useState<CreateApplicationInput['status']>(
    application && isApplicationStatusValue(application.status) ? application.status : 'queued',
  )
  const [timingMode, setTimingMode] = useState<JobTimingMode>(
    application?.timingMode ?? 'unknown',
  )
  const [termsJson, setTermsJson] = useState(application?.terms?.length ? JSON.stringify(application.terms, null, 2) : '')
  const [startDate, setStartDate] = useState(application?.startDate ?? '')
  const [endDate, setEndDate] = useState(application?.endDate ?? '')
  const [timingLabel, setTimingLabel] = useState(application && 'term' in application ? application.term ?? '' : '')
  const [locationRaw, setLocationRaw] = useState(
    application && 'location' in application ? application.location : '',
  )
  const [hasApplied, setHasApplied] = useState(
    application && 'hasApplied' in application ? application.hasApplied : false,
  )
  const [primaryUrl, setPrimaryUrl] = useState(application?.primaryLink?.url ?? '')
  const [sourceUrl, setSourceUrl] = useState('')
  const [initialNote, setInitialNote] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [manualReviewKind, setManualReviewKind] = useState<ManualReviewKindSelection>('')
  const [missingUserInfo, setMissingUserInfo] = useState('')
  const [blockerReason, setBlockerReason] = useState('')
  const [applicationNote, setApplicationNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const title = mode === 'add' ? 'Add application' : 'Edit application'

  async function saveApplication() {
    setError(null)
    setIsSaving(true)

    try {
      const timingInput = buildTimingInput({
        endDate,
        startDate,
        timingLabel,
        timingMode,
        termsJson,
      })

      if (mode === 'add') {
        await onCreate({
          companyName: companyName.trim(),
          country: country.trim(),
          ...(initialNote.trim() ? { initialNote: initialNote.trim() } : {}),
          ...(locationRaw.trim() ? { locationRaw: locationRaw.trim() } : {}),
          ...(primaryUrl.trim()
            ? {
                primaryLink: {
                  kind: 'official',
                  label: 'official',
                  url: primaryUrl.trim(),
                },
              }
            : {}),
          ...(sourceUrl.trim()
            ? {
                sourceLink: {
                  kind: 'source',
                  label: 'source',
                  url: sourceUrl.trim(),
                },
              }
            : {}),
          ...timingInput,
          roleKind,
          roleTitle: roleTitle.trim(),
          sourceName: sourceName.trim(),
          status,
          workMode,
        })
      } else if (application) {
        const applicationId = application.id

        await onUpdate({
          applicationId,
          country: country.trim(),
          hasApplied,
          locationRaw: locationRaw.trim() || null,
          roleKind,
          roleTitle: roleTitle.trim(),
          ...timingInput,
          workMode,
        })

        const trimmedStatusNote = statusNote.trim()
        if (status !== application.status || trimmedStatusNote) {
          await onUpdateStatus({
            applicationId,
            ...(trimmedStatusNote ? { notes: trimmedStatusNote } : {}),
            status,
          })
        }

        const workflowInput: UpdateApplicationWorkflowInput = { applicationId }
        if (manualReviewKind) {
          workflowInput.manualReviewKind = manualReviewKind
        }
        if (missingUserInfo.trim()) {
          workflowInput.missingUserInfo = missingUserInfo.trim()
        }
        if (blockerReason.trim()) {
          workflowInput.blockerReason = blockerReason.trim()
        }
        if (Object.keys(workflowInput).length > 1) {
          await onUpdateWorkflow(workflowInput)
        }

        if (applicationNote.trim()) {
          await onAppendNote({
            applicationId,
            message: applicationNote.trim(),
          })
        }
      }

      onSaved()
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="grid gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <EditorInput label="Company" value={companyName} disabled={mode === 'edit'} onChange={setCompanyName} />
          <EditorInput label="Role" value={roleTitle} onChange={setRoleTitle} />
          <EditorInput label="Source" value={sourceName} disabled={mode === 'edit'} onChange={setSourceName} />
          <EditorInput label="Country" value={country} onChange={setCountry} />
          <EditorSelect label="Role kind" value={roleKind} options={roleKindOptions} onChange={(value) => setRoleKind(value as CreateApplicationInput['roleKind'])} />
          <EditorSelect label="Work mode" value={workMode} options={workModeOptions} onChange={(value) => setWorkMode(value as CreateApplicationInput['workMode'])} />
          <EditorSelect label="Status" value={status} options={applicationStatuses} onChange={(value) => setStatus(value as CreateApplicationInput['status'])} />
          <TimingFields
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
          <EditorInput label="Location" value={locationRaw} onChange={setLocationRaw} />
          <EditorInput label="Primary URL" value={primaryUrl} disabled={mode === 'edit'} onChange={setPrimaryUrl} />
          {mode === 'add' ? (
            <>
              <EditorInput label="Source URL" value={sourceUrl} onChange={setSourceUrl} />
              <EditorInput label="Initial note" value={initialNote} onChange={setInitialNote} />
            </>
          ) : null}
          {mode === 'edit' ? (
            <Label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
              <input
                aria-label="Has applied"
                checked={hasApplied}
                className="h-4 w-4 accent-primary"
                type="checkbox"
                onChange={(event) => setHasApplied(event.target.checked)}
              />
              <span>Has applied</span>
            </Label>
          ) : null}
          {mode === 'edit' ? (
            <>
              <EditorInput label="Status note" value={statusNote} onChange={setStatusNote} />
              <EditorOptionalSelect
                label="Manual review kind"
                value={manualReviewKind}
                options={manualReviewKindOptions}
                onChange={(value) =>
                  setManualReviewKind(value as ManualReviewKindSelection)
                }
              />
              <EditorInput label="Missing user info" value={missingUserInfo} onChange={setMissingUserInfo} />
              <EditorInput label="Blocker reason" value={blockerReason} onChange={setBlockerReason} />
              <EditorTextarea label="Application note" value={applicationNote} onChange={setApplicationNote} />
            </>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={isSaving} onClick={saveApplication}>
            {isSaving ? 'Saving...' : 'Save application'}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

function TimingFields({
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
  const termsPreview = timingMode === 'terms' ? formatTermsJsonPreview(termsJson) : ''
  const datePreview = timingMode === 'dates' ? formatDateTermsPreview(startDate, endDate) : ''

  return (
    <>
      <EditorSelect
        label="Timing mode"
        value={timingMode}
        options={timingModeOptions}
        onChange={(value) => onTimingModeChange(value as JobTimingMode)}
      />
      {timingMode === 'unknown' ? (
        <EditorInput label="Timing label" value={timingLabel} onChange={onTimingLabelChange} />
      ) : null}
      {timingMode === 'terms' ? (
        <>
          <EditorTextarea label="Terms JSON" value={termsJson} onChange={onTermsJsonChange} />
          <EditorInput label="Timing summary" value={termsPreview} disabled onChange={() => {}} />
        </>
      ) : null}
      {timingMode === 'dates' ? (
        <>
          <EditorInput label="Start date" value={startDate} onChange={onStartDateChange} />
          <EditorInput label="End date" value={endDate} onChange={onEndDateChange} />
          <EditorInput label="Timing summary" value={datePreview} disabled onChange={() => {}} />
        </>
      ) : null}
    </>
  )
}

function buildTimingInput({
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
}): Pick<CreateApplicationInput, 'endDate' | 'startDate' | 'term' | 'terms' | 'timingMode'> {
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
      terms: parseTermsJsonInput(termsJson),
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

function parseTermsJsonInput(value: string): JobTerm[] {
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

function formatTermsJsonPreview(value: string) {
  try {
    const terms = parseTermsJsonInput(value)
    return formatJobTerms(terms)
  } catch {
    return ''
  }
}

function formatDateTermsPreview(startDate: string, endDate: string) {
  try {
    return formatJobTerms(deriveJobTermsFromDateRange(startDate.trim(), endDate.trim() || null))
  } catch {
    return ''
  }
}

function EditorOptionalSelect({
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
    <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatEnumLabel(option)}
          </option>
        ))}
      </select>
    </Label>
  )
}

function EditorTextarea({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <Label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
      {label}
      <textarea
        aria-label={label}
        className="min-h-20 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Label>
  )
}

function EditorInput({
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
    <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Label>
  )
}

function EditorSelect({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  options: readonly string[]
  value: string
}) {
  return (
    <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {formatEnumLabel(option)}
          </option>
        ))}
      </select>
    </Label>
  )
}

function isApplicationStatusValue(value: string): value is CreateApplicationInput['status'] {
  return (applicationStatuses as readonly string[]).includes(value)
}

export { ApplicationEditorModal }
