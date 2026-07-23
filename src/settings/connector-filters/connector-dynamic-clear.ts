import type { ConnectorOption } from '@sparxie/sdk'

export function valueKey(value: unknown) {
  return typeof value === 'string' ? `s:${value}` : JSON.stringify(value)
}

export function displayValue(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value) ?? 'unknown value'
}

export function selectionValueKeys(values: unknown[]) {
  return values.map(valueKey).sort()
}

export function selectionValueKeysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  return left.every((key, index) => key === right[index])
}

export function knownDynamicValueKey(contextKey: string, value: unknown) {
  return `${contextKey}:${valueKey(value)}`
}

export function accountResolveSelectedValues(
  selectedValues: unknown[],
  options: ConnectorOption[],
  unknownValues: unknown[],
) {
  const optionKeys = new Set(options.map((option) => valueKey(option.value)))
  const unknownKeys = new Set(unknownValues.map(valueKey))
  return {
    explicitUnknown: selectedValues.filter((value) => unknownKeys.has(valueKey(value))),
    unresolved: selectedValues.filter((value) =>
      !optionKeys.has(valueKey(value)) && !unknownKeys.has(valueKey(value))),
  }
}

export function dependencyTransitionClearDecision(
  selectedValues: unknown[],
  unknownValues: unknown[],
) {
  if (unknownValues.length === 0) return null
  const unknownKeys = new Set(unknownValues.map(valueKey))
  const cleared = selectedValues.filter((value) => unknownKeys.has(valueKey(value)))
  if (cleared.length === 0) return null
  return {
    cleared,
    remaining: selectedValues.filter((value) => !unknownKeys.has(valueKey(value))),
  }
}

function clearedValueLabel(value: unknown, labels: Record<string, string>) {
  const cached = labels[valueKey(value)]
  if (typeof cached === 'string' && cached.trim() !== '') return cached
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return 'selected value'
}

export function formatDependencyClearFeedback(
  fieldLabel: string,
  cleared: unknown[],
  labels: Record<string, string>,
) {
  const names = cleared.map((value) => clearedValueLabel(value, labels))
  const listed = names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`
  const verb = names.length === 1 ? 'was' : 'were'
  const pronoun = names.length === 1 ? 'it is' : 'they are'
  return `${fieldLabel}: ${listed} ${verb} cleared because `
    + `${pronoun} unavailable with the current filter dependencies.`
}
