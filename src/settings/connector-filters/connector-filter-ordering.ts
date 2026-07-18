import type { InstalledConnectorDescriptor } from 'sparxie'

export function orderFilterProperties<T>(
  properties: Record<string, T>,
  dynamicOptions: InstalledConnectorDescriptor['dynamicOptions'],
) {
  const entries = Object.entries(properties)
  const bindings = dynamicOptions?.bindings ?? []
  const sources = new Map((dynamicOptions?.sources ?? []).map((source) => [source.id, source]))

  for (let pass = 0; pass < entries.length; pass += 1) {
    let changed = false
    for (const binding of bindings) {
      const dependent = pointerRootProperty(binding.filterPointer)
      const source = sources.get(binding.sourceId)
      if (!dependent || !source) continue
      for (const dependency of source.dependencies ?? []) {
        const prerequisite = pointerRootProperty(dependency.filterPointer)
        const dependentIndex = entries.findIndex(([property]) => property === dependent)
        const prerequisiteIndex = entries.findIndex(([property]) => property === prerequisite)
        if (prerequisiteIndex < 0 || dependentIndex < 0 || prerequisiteIndex < dependentIndex) {
          continue
        }
        const [entry] = entries.splice(prerequisiteIndex, 1)
        if (!entry) continue
        entries.splice(dependentIndex, 0, entry)
        changed = true
      }
    }
    if (!changed) break
  }

  return entries
}

function pointerRootProperty(pointer: string): string | null {
  const encoded = pointer.replace(/^\//, '').split('/')[0]
  return encoded ? encoded.replace(/~1/g, '/').replace(/~0/g, '~') : null
}
