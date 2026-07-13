import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { CircleIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

function RadioGroup({
  className,
  onKeyUp,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
      onKeyUp={(event) => {
        onKeyUp?.(event)
        if (event.defaultPrevented) return
        if (!ARROW_KEYS.has(event.key)) return

        // Radix roving-focus moves focus in a setTimeout from keydown. A normal
        // keyup can clear its "arrow pressed" flag before that focus runs, so
        // selection is skipped. Defer one tick past focus, then click if needed.
        const root = event.currentTarget
        window.setTimeout(() => {
          const active = root.ownerDocument.activeElement
          if (!(active instanceof HTMLElement)) return
          if (!root.contains(active)) return
          if (active.getAttribute('data-slot') !== 'radio-group-item') return
          if (active.getAttribute('data-state') === 'checked') return
          if (active.hasAttribute('disabled') || active.getAttribute('data-disabled') != null) {
            return
          }
          active.click()
        })
      }}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-4 shrink-0 rounded-full border border-input bg-input/30 text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
