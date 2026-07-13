import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const clampedValue =
    value == null || Number.isNaN(value) ? value : Math.min(100, Math.max(0, value))

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-primary/20',
        className,
      )}
      {...props}
      value={clampedValue}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (clampedValue || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
