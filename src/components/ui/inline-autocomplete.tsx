import { useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export interface InlineAutocompleteOption {
  readonly value: string
  readonly label: string
  readonly detail?: string
}

export interface InlineAutocompleteProps {
  readonly id: string
  readonly query: string
  readonly onQueryChange: (next: string) => void
  readonly options: ReadonlyArray<InlineAutocompleteOption>
  readonly onSelect: (option: InlineAutocompleteOption) => void
  readonly listLabel: string
  readonly selectedValue?: string | null
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly invalid?: boolean
  /** Rendered inside the suggestion surface for loading, empty, truncation, and failure. */
  readonly status?: ReactNode
  /** Rendered under the suggestions, outside the listbox, for actions that are not a selection. */
  readonly footer?: ReactNode
  readonly inputRef?: MutableRefObject<HTMLInputElement | null>
}

/** Inline editable combobox whose active option survives result reordering. */
export function InlineAutocomplete({
  id,
  query,
  onQueryChange,
  options,
  onSelect,
  listLabel,
  selectedValue = null,
  placeholder,
  disabled = false,
  invalid = false,
  status,
  footer,
  inputRef,
}: InlineAutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [activeValue, setActiveValue] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const surfaceId = useId()
  const listboxId = `${surfaceId}-listbox`
  const optionId = (value: string) => `${surfaceId}-option-${value}`

  const activeIndex = options.findIndex((option) => option.value === activeValue)
  const active = activeIndex >= 0 ? options[activeIndex] : undefined

  function choose(option: InlineAutocompleteOption) {
    setOpen(false)
    setActiveValue(null)
    onSelect(option)
  }

  function moveActive(delta: number) {
    if (options.length === 0) {
      setActiveValue(null)
      return
    }
    const from = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : 0
    const next = (from + delta + options.length) % options.length
    setActiveValue(options[next]?.value ?? null)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        if (activeIndex < 0) setActiveValue(options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.value ?? null)
        return
      }
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveValue(options[0]?.value ?? null)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveValue(options[options.length - 1]?.value ?? null)
      return
    }
    if (event.key === 'Enter' && open && active) {
      event.preventDefault()
      choose(active)
    }
  }

  // Radix handles Escape at document capture, so the open list claims it first.
  useEffect(() => {
    if (!open) return
    function claimEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (!containerRef.current?.contains(event.target as Node | null)) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setActiveValue(null)
    }
    window.addEventListener('keydown', claimEscape, true)
    return () => window.removeEventListener('keydown', claimEscape, true)
  }, [open])

  return (
    <div
      ref={containerRef}
      className="relative"
      data-slot="inline-autocomplete"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget)) {
          setOpen(false)
          setActiveValue(null)
        }
      }}
    >
      <Input
        ref={inputRef}
        id={id}
        name={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && active ? optionId(active.value) : undefined}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        disabled={disabled}
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value)
          setOpen(true)
          setActiveValue(null)
        }}
        onKeyDown={handleKeyDown}
      />
      <div
        hidden={!open}
        data-slot="inline-autocomplete-surface"
        className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md"
      >
        <ul
          id={listboxId}
          role="listbox"
          aria-label={listLabel}
          className="max-h-56 overflow-y-auto py-1"
        >
          {options.map((option) => (
            <li
              key={option.value}
              id={optionId(option.value)}
              role="option"
              aria-selected={option.value === selectedValue}
              data-active={option.value === activeValue ? 'true' : undefined}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                option.value === activeValue && 'bg-accent text-accent-foreground',
              )}
              onMouseMove={() => setActiveValue(option.value)}
              // Keeps focus on the input so selection never moves the caret out of the combobox.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span className="block truncate">{option.label}</span>
              {option.detail ? (
                <span className="block truncate text-xs text-muted-foreground">{option.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
        {status}
        {footer}
      </div>
    </div>
  )
}
