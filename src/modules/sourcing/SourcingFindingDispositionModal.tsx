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
import { manualSourcingDecisionStatuses, type ManualSourcingDecisionStatus, type SetSourcingFindingDecisionInput, type SourcingFinding } from 'sparxie'
import { FindingInput, FindingSelect, FindingTextarea } from './SourcingFindingFormFields'

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
          <DialogTitle>Set sourcing disposition</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close Set sourcing disposition"
            onClick={onClose}
          >
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
              <FindingTextarea
                className="min-h-28"
                label="Disposition notes"
                value={mergeNotes}
                onChange={setMergeNotes}
              />
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="button" onClick={saveDecision}>
                  Save disposition
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
