import type {
  ConnectorRendererPresentationField,
  ConnectorRendererSchema,
} from 'sparxie'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { ConnectorSchemaValidationIssue } from '../../modules/connectors/connector.renderer-schema-validation'
import {
  durationDisplayToStorage,
  durationStorageToDisplay,
  optionPresentationLabel,
} from './connector-presentation'

export function StaticFilterControl({
  description,
  descriptionId,
  disabled,
  issues = [],
  label,
  onChange,
  presentation,
  required = false,
  schema,
  value,
}: {
  description: string
  descriptionId: string
  disabled: boolean
  issues?: ConnectorSchemaValidationIssue[]
  label: string
  onChange: (value: unknown) => void
  presentation: ConnectorRendererPresentationField
  required?: boolean
  schema: ConnectorRendererSchema
  value: unknown
}) {
  if ('oneOf' in schema) return null

  const help = (
    <p id={descriptionId} className="text-xs text-muted-foreground">
      {description}
    </p>
  )

  if (schema.type === 'boolean') {
    return (
      <div className="grid min-w-0 content-start gap-1.5 text-sm">
        <label className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 break-words">{label}</span>
          <Switch
            aria-describedby={descriptionId}
            aria-label={label}
            checked={typeof value === 'boolean' ? value : (schema.default ?? false)}
            disabled={disabled}
            onCheckedChange={onChange}
          />
        </label>
        {help}
      </div>
    )
  }

  if (schema.type === 'string' && schema.enum) {
    const hasValidValue = typeof value === 'string' && schema.enum.includes(value)
    return (
      <label className="grid min-w-0 gap-1.5 text-sm">
        <span className="min-w-0 break-words font-medium text-foreground">{label}</span>
        <select
          aria-describedby={descriptionId}
          aria-label={label}
          className="h-9 rounded-md border border-input bg-input/30 px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          {!required || !hasValidValue ? <option role="none" value="">Select…</option> : null}
          {schema.enum.map((option) => (
            <option key={option} role="none" value={option}>
              {optionPresentationLabel(presentation, option) ?? option}
            </option>
          ))}
        </select>
        {help}
      </label>
    )
  }

  if (schema.type === 'string') {
    return (
      <label className="grid min-w-0 gap-1.5 text-sm">
        <span className="min-w-0 break-words font-medium text-foreground">{label}</span>
        <Input
          aria-describedby={descriptionId}
          aria-label={label}
          disabled={disabled}
          maxLength={schema.maxLength}
          minLength={schema.minLength}
          type={schema.format === 'date' ? 'date' : 'text'}
          value={typeof value === 'string' ? value : (schema.default ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
        {help}
      </label>
    )
  }

  if ((schema.type === 'number' || schema.type === 'integer') && schema.enum) {
    const hasValidValue = typeof value === 'number' && schema.enum.includes(value)
    return (
      <label className="grid min-w-0 gap-1.5 text-sm">
        <span className="min-w-0 break-words font-medium text-foreground">{label}</span>
        <select
          aria-describedby={descriptionId}
          aria-label={label}
          className="h-9 rounded-md border border-input bg-input/30 px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          disabled={disabled}
          value={hasValidValue ? String(value) : ''}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        >
          {!required || !hasValidValue ? <option role="none" value="">Select…</option> : null}
          {schema.enum.map((option) => (
            <option key={option} role="none" value={option}>
              {optionPresentationLabel(presentation, option) ?? String(option)}
            </option>
          ))}
        </select>
        {help}
      </label>
    )
  }

  if (
    (schema.type === 'number' || schema.type === 'integer')
    && presentation.display?.kind === 'duration'
    && presentation.display.storageUnit === 'milliseconds'
    && presentation.display.displayUnit === 'minutes'
  ) {
    const storageValue = typeof value === 'number'
      ? value
      : (typeof schema.default === 'number' ? schema.default : undefined)
    const displayValue = storageValue === undefined
      ? ''
      : durationStorageToDisplay(storageValue)
    return (
      <label className="grid min-w-0 gap-1.5 text-sm">
        <span className="min-w-0 break-words font-medium text-foreground">{label}</span>
        <InputGroup>
          <InputGroupInput
            aria-describedby={descriptionId}
            aria-label={label}
            disabled={disabled}
            max={schema.maximum === undefined
              ? undefined
              : durationStorageToDisplay(schema.maximum)}
            min={schema.minimum === undefined
              ? undefined
              : durationStorageToDisplay(schema.minimum)}
            step="any"
            type="number"
            value={displayValue}
            onChange={(event) => {
              if (event.target.value === '') {
                onChange(undefined)
                return
              }
              onChange(durationDisplayToStorage(Number(event.target.value)))
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>Minutes</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        {help}
      </label>
    )
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <label className="grid min-w-0 gap-1.5 text-sm">
        <span className="min-w-0 break-words font-medium text-foreground">{label}</span>
        <Input
          aria-describedby={descriptionId}
          aria-label={label}
          disabled={disabled}
          max={schema.maximum}
          min={schema.minimum}
          step={schema.multipleOf ?? (schema.type === 'integer' ? 1 : 'any')}
          type="number"
          value={typeof value === 'number' ? value : (schema.default ?? '')}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
        {help}
      </label>
    )
  }

  if (schema.type === 'array' && !('oneOf' in schema.items)
    && (schema.items.type === 'number' || schema.items.type === 'integer')
    && schema.minItems === 2 && schema.maxItems === 2 && !schema.items.enum) {
    const values = Array.isArray(value) ? value : []
    const rangeLabel = label.replace(/ range$/i, '')
    const itemSchema = schema.items
    const invalid = issues.length > 0
    const errorId = `${descriptionId}-error`
    const describedBy = invalid ? `${descriptionId} ${errorId}` : descriptionId
    return (
      <fieldset
        aria-describedby={describedBy}
        className="grid min-w-0 grid-cols-2 content-start gap-2"
        data-invalid={invalid ? true : undefined}
      >
        <legend className="mb-1 min-w-0 break-words text-sm font-medium text-foreground">{rangeLabel}</legend>
        {[0, 1].map((index) => (
          <label className="grid min-w-0 gap-1 text-xs text-muted-foreground" key={index}>
            <span>{index === 0 ? 'Minimum' : 'Maximum'}</span>
            <Input
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-label={`${index === 0 ? 'Minimum' : 'Maximum'} ${rangeLabel.toLowerCase()}`}
              className="min-w-0"
              disabled={disabled}
              max={itemSchema.maximum}
              min={itemSchema.minimum}
              step={itemSchema.multipleOf ?? (itemSchema.type === 'integer' ? 1 : 'any')}
              type="number"
              value={typeof values[index] === 'number' ? values[index] : ''}
              onChange={(event) => {
                const next = [...values]
                next[index] = event.target.value === '' ? undefined : Number(event.target.value)
                onChange(next)
              }}
            />
          </label>
        ))}
        {help}
        {invalid ? (
          <p className="col-span-2 text-xs text-destructive" id={errorId}>
            {issues.map((issue) => issue.message).join(' ')}
          </p>
        ) : null}
      </fieldset>
    )
  }

  if (schema.type === 'array'
    && !('oneOf' in schema.items)
    && (schema.items.type === 'string'
      || schema.items.type === 'number'
      || schema.items.type === 'integer')
    && schema.items.enum) {
    const selected = Array.isArray(value) ? value : []
    const enumValues = schema.items.enum
    return (
      <fieldset
        aria-describedby={descriptionId}
        className="grid min-w-0 content-start gap-2"
      >
        <legend className="mb-1 min-w-0 break-words text-sm font-medium text-foreground">{label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {enumValues.map((option) => {
            const checked = selected.includes(option)
            const optionLabel = optionPresentationLabel(presentation, option) ?? String(option)
            return (
              <label className="flex items-center gap-2 text-sm" key={String(option)}>
                <Checkbox
                  aria-label={optionLabel}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(nextChecked) => onChange(nextChecked
                    ? [...selected, option]
                    : selected.filter((candidate) => candidate !== option))}
                />
                <span>{optionLabel}</span>
              </label>
            )
          })}
        </div>
        {help}
      </fieldset>
    )
  }

  return null
}
