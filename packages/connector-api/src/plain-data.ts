export interface PlainDataBounds {
  maxDepth: number
  maxNodes: number
  maxArrayLength?: number
}

export type PlainDataSnapshot =
  | { success: true; value: unknown }
  | { success: false }

interface PendingValue {
  source: object
  target: object
  depth: number
}

const unsafeNames = new Set(['__proto__', 'prototype', 'constructor'])

function primitive(value: unknown): PlainDataSnapshot | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { success: true, value }
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { success: true, value } : { success: false }
  }
  if (typeof value !== 'object') return { success: false }
  return undefined
}

/**
 * Copies hostile input exclusively through own data-property descriptors.
 * Zod receives the copy, never the original object, so accessors and ordinary
 * proxy `get` traps cannot run during validation.
 */
export function snapshotBoundedPlainData(
  root: unknown,
  bounds: PlainDataBounds,
): PlainDataSnapshot {
  try {
    const rootPrimitive = primitive(root)
    if (rootPrimitive !== undefined) return rootPrimitive

    const rootArray = Array.isArray(root)
    if (Object.getPrototypeOf(root) !== (rootArray ? Array.prototype : Object.prototype)) {
      return { success: false }
    }
    const rootTarget: object = rootArray ? [] : {}
    const pending: PendingValue[] = [{ source: root as object, target: rootTarget, depth: 0 }]
    const seen = new WeakSet<object>()
    let nodes = 0

    while (pending.length > 0) {
      const current = pending.pop()!
      nodes += 1
      if (nodes > bounds.maxNodes || current.depth > bounds.maxDepth) return { success: false }
      if (seen.has(current.source)) return { success: false }
      seen.add(current.source)

      const array = Array.isArray(current.source)
      if (Object.getPrototypeOf(current.source)
        !== (array ? Array.prototype : Object.prototype)) return { success: false }

      const lengthDescriptor = array
        ? Object.getOwnPropertyDescriptor(current.source, 'length')
        : undefined
      if (array) {
        if (lengthDescriptor === undefined
          || !('value' in lengthDescriptor)
          || lengthDescriptor.enumerable
          || !Number.isSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0
          || (bounds.maxArrayLength !== undefined
            && lengthDescriptor.value > bounds.maxArrayLength)) return { success: false }
        nodes += lengthDescriptor.value
        if (nodes > bounds.maxNodes) return { success: false }
        const targetArray = current.target as unknown[]
        targetArray.length = lengthDescriptor.value
      }

      for (const key of Reflect.ownKeys(current.source)) {
        if (typeof key !== 'string' || unsafeNames.has(key)) return { success: false }
        const descriptor = Object.getOwnPropertyDescriptor(current.source, key)
        if (descriptor === undefined || !('value' in descriptor)) return { success: false }
        if (array && key === 'length') {
          continue
        }
        if (!descriptor.enumerable) {
          return { success: false }
        }
        if (array) {
          if (!/^(?:0|[1-9]\d*)$/.test(key)) return { success: false }
          const index = Number(key)
          if (!Number.isInteger(index)
            || index >= 4_294_967_295
            || lengthDescriptor === undefined
            || !('value' in lengthDescriptor)
            || index >= lengthDescriptor.value) return { success: false }
        }
        nodes += 1
        if (nodes > bounds.maxNodes) return { success: false }

        const childPrimitive = primitive(descriptor.value)
        if (childPrimitive?.success === false) return childPrimitive
        if (childPrimitive?.success === true) {
          Object.defineProperty(current.target, key, {
            configurable: true,
            enumerable: true,
            value: childPrimitive.value,
            writable: true,
          })
          continue
        }

        const child = descriptor.value as object
        const childArray = Array.isArray(child)
        if (Object.getPrototypeOf(child)
          !== (childArray ? Array.prototype : Object.prototype)) return { success: false }
        const childTarget: object = childArray ? [] : {}
        Object.defineProperty(current.target, key, {
          configurable: true,
          enumerable: true,
          value: childTarget,
          writable: true,
        })
        pending.push({ source: child, target: childTarget, depth: current.depth + 1 })
      }
    }
    return { success: true, value: rootTarget }
  } catch {
    return { success: false }
  }
}

export function isBoundedPlainData(root: unknown, bounds: PlainDataBounds): boolean {
  return snapshotBoundedPlainData(root, bounds).success
}
