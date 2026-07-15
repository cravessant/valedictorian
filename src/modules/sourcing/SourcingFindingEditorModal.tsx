import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X } from 'lucide-react'
import { roleKinds, type CreateSourcingFindingInput, type JobTimingMode, type SourcingFinding, type UpdateSourcingFindingInput } from 'sparxie'
import { FindingTimingFields, buildFindingTimingInput } from './SourcingFindingTiming'
import { FindingInput, FindingSelect, FindingTextarea, applyOptionalFindingFields } from './SourcingFindingFormFields'

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
  const title = mode === 'add' ? 'Add opportunity' : 'Edit opportunity'

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
          <div className="px-5 py-4">
            <div className="grid gap-4">
              {error ? (
                <Alert variant="destructive">
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
                <FindingTextarea
                  className="min-h-24"
                  label="Fit notes"
                  value={fitNotes}
                  onChange={setFitNotes}
                />
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
                  Save opportunity
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
