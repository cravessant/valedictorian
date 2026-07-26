import { ArrowRight } from 'lucide-react'
import type { ReactElement } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { LifecyclePhase } from './lifecycle-workbench'

export function LifecycleRail({
  selected,
  onSelect,
  counts,
}: {
  readonly selected: LifecyclePhase
  readonly onSelect: (phase: LifecyclePhase) => void
  readonly counts: Readonly<Record<LifecyclePhase, number>>
}): ReactElement {
  const steps: ReadonlyArray<{ phase: LifecyclePhase; label: string }> = [
    { phase: 'captures', label: 'Captures' },
    { phase: 'jobs', label: 'Jobs' },
    { phase: 'opportunities', label: 'Opportunities' },
    { phase: 'applications', label: 'Applications' },
  ]
  return (
    <nav aria-label="Lifecycle phase" className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const active = selected === step.phase
        return (
          <div key={step.phase} className="flex items-center gap-2">
            <Button
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              aria-current={active ? 'step' : undefined}
              aria-pressed={active}
              onClick={() => onSelect(step.phase)}
            >
              {step.label}
              <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                {counts[step.phase]}
              </span>
            </Button>
            {index < steps.length - 1 ? (
              <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}

export function phaseLabel(phase: LifecyclePhase): string {
  if (phase === 'captures') return 'Captures'
  if (phase === 'jobs') return 'Jobs'
  if (phase === 'opportunities') return 'Opportunities'
  return 'Applications'
}

/**
 * The shared list toolbar. Removed-record visibility is offered only by the
 * surfaces that own that filter; Captures address theirs through the location
 * filter group instead.
 */
export function RefreshToolbar({
  caption,
  total,
  loading,
  onRefresh,
  showRemoved,
  onShowRemovedChange,
  onAdd,
  addLabel,
}: {
  readonly caption: string
  readonly total: number
  readonly loading: boolean
  readonly onRefresh: () => void
  readonly showRemoved?: boolean
  readonly onShowRemovedChange?: (next: boolean) => void
  readonly onAdd?: () => void
  readonly addLabel?: string
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {caption} · {total} record{total === 1 ? '' : 's'}
      </p>
      <div className="flex items-center gap-3">
        {onShowRemovedChange ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={showRemoved ?? false}
              onCheckedChange={(value) => onShowRemovedChange(value === true)}
              aria-label="Show removed"
            />
            Show removed
          </label>
        ) : null}
        {onAdd ? (
          <Button type="button" variant="default" size="sm" onClick={onAdd}>
            {addLabel ?? 'Add'}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </div>
    </div>
  )
}
