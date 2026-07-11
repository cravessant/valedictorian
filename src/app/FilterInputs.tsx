const filterControlClassName = 'h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground'

interface FilterInputProps {
  label: string
  value: string
  onChange: (value: string) => void
}

export function FilterTextInput({ label, value, onChange }: FilterInputProps) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className={filterControlClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function FilterDateInput({ label, value, onChange }: FilterInputProps) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className={filterControlClassName}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
