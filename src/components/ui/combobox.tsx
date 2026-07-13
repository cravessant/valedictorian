import * as React from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export type ComboboxOption = {
  label: string
  value: string
  keywords?: string[]
}

export type ComboboxProps = {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
}

function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  disabled = false,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          id={id}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-expanded={open}
          data-slot="combobox-trigger"
          className={cn(
            'h-9 w-full min-w-0 justify-between border-input bg-input/30 px-3 font-normal text-foreground shadow-xs hover:bg-input/50',
            'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        data-slot="combobox-content"
      >
        <Command data-slot="combobox-command">
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value || option.label}
                  value={option.label}
                  keywords={option.keywords ?? [option.value]}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                >
                  <CheckIcon
                    className={cn(
                      'size-4 shrink-0',
                      value === option.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
