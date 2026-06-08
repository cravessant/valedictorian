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
  onChange?(value: string): void
}) {
  return (
    <label className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center">
      <span>
        <span className="block font-medium">{label}</span>
      </span>
      <input
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground read-only:text-muted-foreground"
        readOnly={readOnly}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  )
}

export { SettingsTextInput }
