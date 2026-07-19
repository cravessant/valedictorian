import type { CreateSourcingFindingInput, UpdateSourcingFindingInput } from 'sparxie'
import { formatEnumLabel } from '../../app/labels'

import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { fieldControlId } from '@/lib/field-control-id'
import { cn } from '@/lib/utils'

export function FindingInput({
  disabled,
  error,
  label,
  onChange,
  value,
}: {
  disabled?: boolean
  error?: string | null
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const controlId = fieldControlId('sourcing-finding', label)
  const errorId = `${controlId}-error`

  return (
    <Field
      className="grid gap-1 text-xs font-medium text-muted-foreground"
      data-disabled={disabled ? true : undefined}
    >
      <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <Input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <FieldError id={errorId} className="text-xs text-destructive">
          {error}
        </FieldError>
      ) : null}
    </Field>
  )
}

export function FindingTextarea({
  className,
  error,
  label,
  onChange,
  value,
}: {
  className?: string
  error?: string | null
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const controlId = fieldControlId('sourcing-finding', label)
  const errorId = `${controlId}-error`

  return (
    <Field className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
      <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <Textarea
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn('min-h-20', className)}
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <FieldError id={errorId} className="text-xs text-destructive">
          {error}
        </FieldError>
      ) : null}
    </Field>
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
  const controlId = fieldControlId('sourcing-finding', label)

  return (
    <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
      <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <NativeSelect
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {formatEnumLabel(option)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}
