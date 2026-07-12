import { deriveJobTermsFromDateRange, formatJobTerms, type CreateSourcingFindingInput, type JobTerm, type JobTimingMode } from 'sparxie'
import { FindingInput, FindingSelect, FindingTextarea } from './SourcingFindingFormFields'

const timingModeOptions = ['unknown', 'terms', 'dates'] as const

export function FindingTimingFields({
  endDate,
  onEndDateChange,
  onStartDateChange,
  onTermsJsonChange,
  onTimingLabelChange,
  onTimingModeChange,
  startDate,
  termsJson,
  timingLabel,
  timingMode,
}: {
  endDate: string
  onEndDateChange: (value: string) => void
  onStartDateChange: (value: string) => void
  onTermsJsonChange: (value: string) => void
  onTimingLabelChange: (value: string) => void
  onTimingModeChange: (value: JobTimingMode) => void
  startDate: string
  termsJson: string
  timingLabel: string
  timingMode: JobTimingMode
}) {
  const termsPreview = timingMode === 'terms' ? formatFindingTermsJsonPreview(termsJson) : ''
  const datePreview = timingMode === 'dates'
    ? formatFindingDateTermsPreview(startDate, endDate)
    : ''

  return (
    <>
      <FindingSelect
        label="Timing mode"
        value={timingMode}
        options={timingModeOptions}
        onChange={(value) => onTimingModeChange(value as JobTimingMode)}
      />
      {timingMode === 'unknown' ? (
        <FindingInput label="Timing label" value={timingLabel} onChange={onTimingLabelChange} />
      ) : null}
      {timingMode === 'terms' ? (
        <>
          <FindingTextarea label="Terms JSON" value={termsJson} onChange={onTermsJsonChange} />
          <FindingInput label="Timing summary" value={termsPreview} disabled onChange={() => {}} />
        </>
      ) : null}
      {timingMode === 'dates' ? (
        <>
          <FindingInput label="Start date" value={startDate} onChange={onStartDateChange} />
          <FindingInput label="End date" value={endDate} onChange={onEndDateChange} />
          <FindingInput label="Timing summary" value={datePreview} disabled onChange={() => {}} />
        </>
      ) : null}
    </>
  )
}

export function buildFindingTimingInput({
  endDate,
  startDate,
  termsJson,
  timingLabel,
  timingMode,
}: {
  endDate: string
  startDate: string
  termsJson: string
  timingLabel: string
  timingMode: JobTimingMode
}): Partial<Pick<CreateSourcingFindingInput, 'endDate' | 'startDate' | 'term' | 'terms' | 'timingMode'>> {
  if (timingMode === 'dates') {
    return {
      timingMode,
      startDate: startDate.trim(),
      endDate: endDate.trim() || null,
    }
  }

  if (timingMode === 'terms') {
    return {
      timingMode,
      terms: parseFindingTermsJsonInput(termsJson),
    }
  }

  return {
    timingMode,
    term: timingLabel.trim() || null,
    terms: [],
    startDate: null,
    endDate: null,
  }
}

export function parseFindingTermsJsonInput(value: string): JobTerm[] {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Terms JSON is required for term timing.')
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Terms JSON must be an array.')
  }

  return parsed as JobTerm[]
}

export function formatFindingTermsJsonPreview(value: string) {
  try {
    return formatJobTerms(parseFindingTermsJsonInput(value))
  } catch {
    return ''
  }
}

export function formatFindingDateTermsPreview(startDate: string, endDate: string) {
  try {
    return formatJobTerms(deriveJobTermsFromDateRange(startDate.trim(), endDate.trim() || null))
  } catch {
    return ''
  }
}
