import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  maximumSelectableEarliestBackfillDate,
  minimumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../modules/connectors/connector.earliest-backfill'

export function ConnectorEarliestBackfillDateControl({
  createdAt,
  disabled,
  instanceId,
  onChange,
  value,
}: {
  createdAt: string
  disabled?: boolean
  instanceId: string
  onChange: (next: string) => void
  value: string
}) {
  const [open, setOpen] = useState(false)
  const todayUtc = maximumSelectableEarliestBackfillDate(new Date().toISOString())
  const minimum = minimumSelectableEarliestBackfillDate(createdAt)
  const validation = validateSelectableEarliestBackfillDate({
    candidate: value,
    createdAt,
    todayUtc,
  })
  const selected = parseCalendarDateOnly(value)
  const fromDate = parseCalendarDateOnly(minimum)!
  const toDate = parseCalendarDateOnly(todayUtc)!
  const descriptionId = `connector-earliest-backfill-description-${instanceId}`

  return (
    <div
      className="grid gap-1 text-xs font-medium text-muted-foreground"
      data-testid={`connector-earliest-backfill-${instanceId}`}
    >
      <span>Earliest backfill date</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p
          aria-live="polite"
          className="text-sm font-normal text-foreground"
          data-testid={`connector-earliest-backfill-value-${instanceId}`}
        >
          {value}
        </p>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-describedby={descriptionId}
              aria-invalid={!validation.ok}
              aria-label={`Choose earliest backfill date for ${instanceId}`}
              className="h-9 gap-2"
              disabled={disabled}
              size="sm"
              type="button"
              variant="outline"
            >
              <CalendarIcon className="h-4 w-4" />
              Choose date
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selected}
              fromDate={fromDate}
              toDate={toDate}
              disabled={{ before: fromDate, after: toDate }}
              onSelect={(date) => {
                if (!date) return
                onChange(formatCalendarDateOnly(date))
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      {validation.ok ? (
        <span className="font-normal text-muted-foreground" id={descriptionId}>
          Inclusive UTC start. Allowed range: {minimum} to {todayUtc}.
        </span>
      ) : (
        <span className="font-normal text-warning" id={descriptionId} role="alert">
          {validation.message}
        </span>
      )}
    </div>
  )
}

function parseCalendarDateOnly(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return undefined
  }
  return date
}

function formatCalendarDateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
