import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ResourceDetailFrameProps {
  readonly backLabel: string
  readonly children: ReactNode
  readonly heading: string
  readonly headingId: string
  readonly isNarrow: boolean
  readonly onBack: () => void
}

export function ResourceDetailFrame({
  backLabel,
  children,
  heading,
  headingId,
  isNarrow,
  onBack,
}: ResourceDetailFrameProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [heading])

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-md border border-border bg-card/60 p-5"
      data-testid="workspace-resource-detail"
    >
      {isNarrow ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-2"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Button>
      ) : null}
      <h3
        ref={headingRef}
        id={headingId}
        className="text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        tabIndex={-1}
      >
        {heading}
      </h3>
      <div className="mt-4">{children}</div>
    </section>
  )
}
