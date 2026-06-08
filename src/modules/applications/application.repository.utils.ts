export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
