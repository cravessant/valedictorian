import {
  normalizationGateStatuses,
  rawSourceListNormalizationStatuses,
  rawSourceListProjectionStatuses,
  sourceAdapterKinds,
  type RawSourceRecordsListQuery,
} from 'sparxie'

export interface RawRecordFilters {
  adapterId: string
  adapterKind: string
  connectorInstanceId: string
  receivedFrom: string
  receivedTo: string
  normalizationStatus: string
  gateStatus: string
  projectionStatus: string
}

export const emptyRawRecordFilters: RawRecordFilters = {
  adapterId: '', adapterKind: '', connectorInstanceId: '', receivedFrom: '', receivedTo: '',
  normalizationStatus: '', gateStatus: '', projectionStatus: '',
}

export function buildRawRecordQuery(
  filters: RawRecordFilters,
  cursor?: string,
): RawSourceRecordsListQuery {
  return Object.fromEntries(Object.entries({
    cursor,
    adapterId: filters.adapterId,
    adapterKind: filters.adapterKind,
    connectorInstanceId: filters.connectorInstanceId,
    receivedFrom: dateBoundary(filters.receivedFrom, 'start'),
    receivedTo: dateBoundary(filters.receivedTo, 'end'),
    normalizationStatus: filters.normalizationStatus,
    gateStatus: filters.gateStatus,
    projectionStatus: filters.projectionStatus,
    limit: 50,
  }).filter(([, value]) => value !== '' && value !== undefined)) as RawSourceRecordsListQuery
}

export function RawNormalizationFilters({
  filters,
  onChange,
}: {
  filters: RawRecordFilters
  onChange: (filters: RawRecordFilters) => void
}) {
  const update = (field: keyof RawRecordFilters, value: string) => {
    onChange({ ...filters, [field]: value })
  }
  return (
    <section aria-label="Capture normalization filters" className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <FilterInput label="Source adapter" value={filters.adapterId} onChange={(value) => update('adapterId', value)} />
      <FilterSelect label="Capture kind" value={filters.adapterKind} options={sourceAdapterKinds} onChange={(value) => update('adapterKind', value)} />
      <FilterInput label="Connector instance" value={filters.connectorInstanceId} onChange={(value) => update('connectorInstanceId', value)} />
      <FilterInput label="Received from" type="date" value={filters.receivedFrom} onChange={(value) => update('receivedFrom', value)} />
      <FilterInput label="Received to" type="date" value={filters.receivedTo} onChange={(value) => update('receivedTo', value)} />
      <FilterSelect label="Job normalization status" value={filters.normalizationStatus} options={rawSourceListNormalizationStatuses} onChange={(value) => update('normalizationStatus', value)} />
      <FilterSelect label="Opportunity admission status" value={filters.gateStatus} options={normalizationGateStatuses} onChange={(value) => update('gateStatus', value)} />
      <FilterSelect label="Opportunity projection status" value={filters.projectionStatus} options={rawSourceListProjectionStatuses} onChange={(value) => update('projectionStatus', value)} />
    </section>
  )
}

function dateBoundary(value: string, boundary: 'start' | 'end') {
  if (!value) return ''
  return `${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
}

function FilterInput({
  label, onChange, type = 'text', value,
}: {
  label: string
  onChange: (value: string) => void
  type?: 'date' | 'text'
  value: string
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input aria-label={label} className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function FilterSelect({
  label, onChange, options, value,
}: {
  label: string
  onChange: (value: string) => void
  options: readonly string[]
  value: string
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select aria-label={label} className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => <option key={option} value={option}>{formatStatus(option)}</option>)}
      </select>
    </label>
  )
}

function formatStatus(value: string) {
  const label = value.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}
