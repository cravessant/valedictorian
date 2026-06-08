import * as React from 'react'

type ToastVariant = 'default' | 'destructive' | 'success'

export interface ToastInput {
  description?: string
  title: string
  variant?: ToastVariant
}

export interface ToastRecord extends ToastInput {
  id: string
  open: boolean
}

const toastLimit = 3
const toastRemoveDelay = 1000

let count = 0
let memoryState: ToastRecord[] = []
const listeners: Array<(state: ToastRecord[]) => void> = []
const removeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

function emit() {
  for (const listener of listeners) {
    listener(memoryState)
  }
}

function updateToast(id: string, patch: Partial<ToastRecord>) {
  memoryState = memoryState.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast))
  emit()
}

function removeToast(id: string) {
  memoryState = memoryState.filter((toast) => toast.id !== id)
  removeTimers.delete(id)
  emit()
}

function queueRemove(id: string) {
  if (removeTimers.has(id)) {
    return
  }

  removeTimers.set(
    id,
    setTimeout(() => removeToast(id), toastRemoveDelay),
  )
}

function dismiss(id: string) {
  updateToast(id, { open: false })
  queueRemove(id)
}

function toast(input: ToastInput) {
  const id = genId()
  const toastRecord: ToastRecord = {
    ...input,
    id,
    open: true,
  }

  memoryState = [toastRecord, ...memoryState].slice(0, toastLimit)
  emit()

  return {
    dismiss: () => dismiss(id),
    id,
  }
}

function useToast() {
  const [toasts, setToasts] = React.useState<ToastRecord[]>(memoryState)

  React.useEffect(() => {
    listeners.push(setToasts)
    return () => {
      const index = listeners.indexOf(setToasts)
      if (index !== -1) {
        listeners.splice(index, 1)
      }
      if (listeners.length === 0) {
        for (const timer of removeTimers.values()) {
          clearTimeout(timer)
        }
        removeTimers.clear()
        memoryState = []
      }
    }
  }, [])

  return {
    dismiss,
    toast,
    toasts,
  }
}

export { toast, useToast }
