import type { CreateSourcingFindingInput, UpdateSourcingFindingInput } from 'sparxie'
import { formatEnumLabel } from '../../app/labels'

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
