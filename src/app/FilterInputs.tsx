import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldControlId } from '@/lib/field-control-id'

interface FilterInputProps {
  label: string
  value: string
  onChange: (value: string) => void
}

export function FilterTextInput({ label, value, onChange }: FilterInputProps) {
  const controlId = fieldControlId('filter', label)

  return (
    <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
      <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <Input
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function FilterDateInput({ label, value, onChange }: FilterInputProps) {
  const controlId = fieldControlId('filter', label)

  return (
    <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
      <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <Input
        id={controlId}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}
