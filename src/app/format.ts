import type { SourcingFinding } from 'sparxie'

export function formatSourcingLocation(item: SourcingFinding) {
  if (item.locationRaw) {
    return item.locationRaw
  }

  return [item.city, item.region, item.country].filter(Boolean).join(', ') || item.workMode
}

export function formatTimestamp(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
