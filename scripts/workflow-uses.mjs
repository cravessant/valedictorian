import {
  EVENT_SCALAR,
  getScalarValue,
  load as loadYaml,
  parseEvents,
} from 'js-yaml'

export function inventoryWorkflowUses(source) {
  let events
  let document
  try {
    events = parseEvents(source)
    document = loadYaml(source)
  } catch (error) {
    return {
      uses: [],
      scalarUseOffsets: new Set(),
      problems: [`workflow YAML is not valid: ${error instanceof Error ? error.message : String(error)}`],
    }
  }

  const uses = []
  const problems = []
  const scalarUseOffsets = new Set(
    events.flatMap((event) => event.type === EVENT_SCALAR
      && getScalarValue(source, event) === 'uses'
      ? [event.valueStart]
      : []),
  )
  const ancestors = new Set()

  function visit(value, location) {
    if (value === null || typeof value !== 'object') return
    if (ancestors.has(value)) {
      problems.push(`workflow YAML contains a cyclic alias at ${location}`)
      return
    }
    ancestors.add(value)
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${location}[${index}]`))
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'uses') {
          if (typeof child !== 'string') {
            problems.push(`${location}.uses must be a string`)
          } else {
            uses.push(child)
          }
        }
        visit(child, `${location}.${key}`)
      }
    }
    ancestors.delete(value)
  }

  visit(document, '$')
  return { uses, scalarUseOffsets, problems }
}

export function findWorkflowUsesLines(source, linePattern) {
  const lines = []
  let offset = 0
  for (const [index, sourceLine] of source.split('\n').entries()) {
    const line = sourceLine.endsWith('\r') ? sourceLine.slice(0, -1) : sourceLine
    if (linePattern.test(line)) {
      lines.push({ line, number: index + 1, offset })
    }
    offset += sourceLine.length + 1
  }
  return lines
}

export function bindCanonicalWorkflowUses(lines, scalarUseOffsets, actionUsePattern) {
  return lines.flatMap((line) => {
    const tokenOffset = line.offset + line.line.indexOf('uses')
    if (!scalarUseOffsets.has(tokenOffset)) return []
    return [{ ...line, match: actionUsePattern.exec(line.line) }]
  })
}

export function workflowUsesMatchCanonicalLines(structuralUses, canonicalUses) {
  if (structuralUses.length !== canonicalUses.length) return false
  const counts = new Map()
  for (const value of structuralUses) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  for (const value of canonicalUses) {
    const count = counts.get(value)
    if (count === undefined) return false
    if (count === 1) counts.delete(value)
    else counts.set(value, count - 1)
  }
  return counts.size === 0
}
