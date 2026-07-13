import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

interface FilterInputProps {
  label: string
  value: string
  onChange: (value: string) => void
}

export function FilterTextInput({ label, value, onChange }: FilterInputProps) {
  return (
    <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <Input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Label>
  )
}

export function FilterDateInput({ label, value, onChange }: FilterInputProps) {
  return (
    <Label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <Input
        aria-label={label}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Label>
  )
}
