import { useId, useState, type ReactElement } from 'react'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Checkbox } from '@/components/ui/checkbox'

import type {
  DuplicateChoice,
  LifecycleOutcome,
} from './lifecycle-outcome-types'
import type { LifecycleWarning, RemovalChoice } from '@sparxie/sdk'

/**
 * Phase-neutral presentation for lifecycle mutation outcomes. Errors
 * (deterministic blockers) render in an alert; policy warnings render in a
 * visually and semantically separate non-alert region that retains the draft
 * and allows resubmission with selected warning codes plus attributable
 * rationale. Duplicate blockers expose only the allowed attach/merge choices
 * and target id. Blocked removals expose supported choices and dependent
 * ids; successful removal/restore shows affected dependent summaries.
 */
export function LifecycleOutcomeView({
  outcome,
  onResolveDuplicate,
  onResolveRemoval,
  onOverrideWarnings,
  pending = false,
}: {
  outcome: LifecycleOutcome
  onResolveDuplicate?: (choice: DuplicateChoice) => void
  onResolveRemoval?: (choice: RemovalChoice, rationale: string) => void
  onOverrideWarnings?: (warningCodes: ReadonlyArray<LifecycleWarning['code']>, rationale: string) => void
  pending?: boolean
}): ReactElement {
  const formId = useId()

  if (outcome.kind === 'error') {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        data-testid="lifecycle-outcome-error"
      >
        <p className="font-medium">Error · {outcome.blocker.code}</p>
        <p>{outcome.message}</p>
        {outcome.blocker.field ? <p className="text-xs">Field: {outcome.blocker.field}</p> : null}
      </div>
    )
  }

  if (outcome.kind === 'duplicate') {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive space-y-2"
        data-testid="lifecycle-outcome-duplicate"
      >
        <p className="font-medium">Error · {outcome.blocker.code}</p>
        <p>{outcome.message}</p>
        <p>Target: <span data-testid="duplicate-target">{outcome.choices[0]?.targetResourceId ?? outcome.blocker.conflictingResourceId ?? ''}</span></p>
        <div className="flex flex-wrap gap-2">
          {outcome.choices.map((choice) => (
            <Button
              key={choice.action}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onResolveDuplicate?.(choice)}
            >
              {choice.action} → {choice.targetResourceId}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  if (outcome.kind === 'removal-blocked') {
    return <RemovalBlockedView
      key={outcome.blocker.code}
      outcome={outcome}
      onResolveRemoval={onResolveRemoval}
      formId={formId}
      pending={pending}
    />
  }

  if (outcome.kind === 'warnings') {
    return <WarningsView outcome={outcome} onOverrideWarnings={onOverrideWarnings} formId={formId} pending={pending} />
  }

  if (outcome.kind === 'removed') {
    return (
      <div
        role="status"
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground space-y-1"
        data-testid="lifecycle-outcome-removed"
      >
        <p className="font-medium">Removed.</p>
        {outcome.affectedDependentIds.length > 0 ? (
          <div>
            <p className="text-xs">Affected dependents:</p>
            <ul className="flex flex-wrap gap-1">
              {outcome.affectedDependentIds.map((id) => (
                <li key={id} className="rounded bg-secondary px-1.5 py-0.5 text-xs">{id}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }

  if (outcome.kind === 'restored') {
    return (
      <div
        role="status"
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground space-y-1"
        data-testid="lifecycle-outcome-restored"
      >
        <p className="font-medium">Restored.</p>
        {outcome.dependentLinks.length > 0 ? (
          <ul className="space-y-0.5">
            {outcome.dependentLinks.map((link) => (
              <li key={link.dependentId}>
                <span className="font-mono text-xs">{link.dependentId}</span>{' '}
                → {link.state}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  if (outcome.kind === 'history') {
    return (
      <div className="space-y-1 text-sm" data-testid="lifecycle-outcome-history">
        {outcome.entries.length === 0 ? (
          <p className="text-muted-foreground">No history yet.</p>
        ) : null}
        {outcome.entries.map((entry) => (
          <div key={`${entry.revision}-${entry.kind}`} className="border-b border-border py-1 last:border-b-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">r{entry.revision} · {entry.kind}</span>
              <time className="text-xs text-muted-foreground">{entry.timestamp}</time>
            </div>
            <p className="text-xs text-muted-foreground">
              by {entry.actor.displayName ?? entry.actor.id} ({entry.actor.type})
            </p>
            {entry.summary ? <p className="text-sm">{entry.summary}</p> : null}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div role="status" className="text-sm text-muted-foreground" data-testid="lifecycle-outcome-succeeded">
      Succeeded.
    </div>
  )
}

function WarningsView({
  outcome,
  onOverrideWarnings,
  formId,
  pending,
}: {
  outcome: Extract<LifecycleOutcome, { kind: 'warnings' }>
  onOverrideWarnings?: (warningCodes: ReadonlyArray<LifecycleWarning['code']>, rationale: string) => void
  formId: string
  pending: boolean
}): ReactElement {
  const [selected, setSelected] = useState<Set<LifecycleWarning['code']>>(new Set())
  const [rationale, setRationale] = useState('')

  function toggle(code: LifecycleWarning['code']) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function submit() {
    if (selected.size === 0 || rationale.trim() === '') return
    onOverrideWarnings?.(Array.from(selected), rationale.trim())
  }

  return (
    <div
      className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm space-y-3"
      data-testid="lifecycle-outcome-warnings"
      aria-live="polite"
    >
      <p className="font-medium">Warnings</p>
      <ul className="space-y-1">
        {outcome.warnings.map((warning: LifecycleWarning) => (
          <li key={warning.code} className="flex items-start gap-2">
            <Checkbox
              id={`${formId}-${warning.code}`}
              checked={selected.has(warning.code)}
              disabled={pending}
              onCheckedChange={() => toggle(warning.code)}
            />
            <label htmlFor={`${formId}-${warning.code}`} className="flex flex-col">
              <span className="font-mono text-xs">{warning.code}</span>
              <span>{warning.message}</span>
            </label>
          </li>
        ))}
      </ul>
      <Field>
        <FieldLabel htmlFor={`${formId}-rationale`}>Override rationale</FieldLabel>
        <Input
          id={`${formId}-rationale`}
          value={rationale}
          disabled={pending}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Explain why these warnings are acceptable."
        />
      </Field>
      <Button type="button" size="sm" onClick={submit} disabled={pending || selected.size === 0 || rationale.trim() === ''}>
        Override warnings
      </Button>
    </div>
  )
}

function RemovalBlockedView({
  outcome,
  onResolveRemoval,
  formId,
  pending,
}: {
  outcome: Extract<LifecycleOutcome, { kind: 'removal-blocked' }>
  onResolveRemoval?: (choice: RemovalChoice, rationale: string) => void
  formId: string
  pending: boolean
}): ReactElement {
  const [choice, setChoice] = useState<RemovalChoice>(outcome.choice.supportedChoices[0] ?? outcome.choice.choice)
  const [rationale, setRationale] = useState('')

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive space-y-2"
      data-testid="lifecycle-outcome-removal-blocked"
    >
      <p className="font-medium">Error · {outcome.blocker.code}</p>
      <p>{outcome.message}</p>
      <div>
        <p className="text-xs">Dependent ids:</p>
        <ul className="flex flex-wrap gap-1">
          {outcome.choice.dependentIds.map((id) => (
            <li key={id} className="rounded bg-destructive/20 px-1.5 py-0.5 text-xs font-mono">{id}</li>
          ))}
        </ul>
      </div>
      <Field>
        <FieldLabel htmlFor={`${formId}-choice`}>Removal choice</FieldLabel>
        <NativeSelect
          id={`${formId}-choice`}
          value={choice}
          disabled={pending}
          onChange={(event) => setChoice((event.target as HTMLSelectElement).value as RemovalChoice)}
        >
          {outcome.choice.supportedChoices.map((c) => (
            <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${formId}-rationale`}>Rationale</FieldLabel>
        <Input
          id={`${formId}-rationale`}
          value={rationale}
          disabled={pending}
          onChange={(event) => setRationale(event.target.value)}
        />
      </Field>
      <Button
        type="button"
        size="sm"
        onClick={() => rationale.trim() && onResolveRemoval?.(choice, rationale.trim())}
        disabled={pending || rationale.trim() === ''}
      >
        Confirm removal
      </Button>
    </div>
  )
}
