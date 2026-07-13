import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ModalShell } from '@/components/ui/modal-shell'
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
    <ModalShell title="Set sourcing disposition" onClose={onClose}>
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
    </ModalShell>
  )
}
