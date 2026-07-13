/** Stable control id from a human-readable label for FieldLabel htmlFor association. */
export function fieldControlId(scope: string, label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${scope}-${slug}`
}
