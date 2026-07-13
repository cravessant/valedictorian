import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fieldControlId } from '@/lib/field-control-id'

function SettingsTextInput({
  label,
  readOnly = false,
  type = 'text',
  value,
  onChange,
}: {
  label: string
  readOnly?: boolean
  type?: string
  value: string
  onChange?: (value: string) => void
}) {
  const controlId = fieldControlId('settings-text', label)

  return (
    <Field className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center">
      <FieldLabel className="block font-medium text-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <Input
        className="read-only:text-muted-foreground"
        id={controlId}
        readOnly={readOnly}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </Field>
  )
}

export { SettingsTextInput }
