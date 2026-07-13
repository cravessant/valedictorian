import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

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
  return (
    <Label className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center">
      <span>
        <span className="block font-medium">{label}</span>
      </span>
      <Input
        aria-label={label}
        className="read-only:text-muted-foreground"
        readOnly={readOnly}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </Label>
  )
}

export { SettingsTextInput }
