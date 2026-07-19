import { toast as sonnerToast } from 'sonner'

type ToastVariant = 'default' | 'destructive' | 'success'
type ToastId = string | number

export interface ToastInput {
  action?: {
    label: string
    onClick: () => Promise<void> | void
  }
  description?: string
  operationId?: string
  title: string
  variant?: ToastVariant
}

const activeDestructiveOperationIds = new Map<string, ToastId>()

/** Test-only: clear dedupe bookkeeping between cases that share operationIds. */
export function clearDestructiveToastDedupe() {
  activeDestructiveOperationIds.clear()
}

/** Drop lifecycle ownership for one destructive operationId (e.g. on unmount). */
export function clearDestructiveToastDedupeFor(operationId: string) {
  activeDestructiveOperationIds.delete(operationId)
}

function releaseDestructiveOperation(operationId: string, toastId: ToastId) {
  if (activeDestructiveOperationIds.get(operationId) === toastId) {
    activeDestructiveOperationIds.delete(operationId)
  }
}

function toast(input: ToastInput) {
  if (input.variant === 'destructive' && input.operationId) {
    const existingId = activeDestructiveOperationIds.get(input.operationId)
    if (existingId !== undefined) {
      return {
        dismiss: () => {
          sonnerToast.dismiss(existingId)
          releaseDestructiveOperation(input.operationId!, existingId)
        },
        id: existingId,
      }
    }
  }

  const trackedId: { current?: ToastId } = {}
  const options = {
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.action
      ? {
          action: {
            label: input.action.label,
            onClick: () => {
              void input.action?.onClick()
            },
          },
        }
      : {}),
    ...(input.variant === 'destructive' && input.operationId
      ? {
          onDismiss: () => {
            if (trackedId.current !== undefined) {
              releaseDestructiveOperation(input.operationId!, trackedId.current)
            }
          },
          onAutoClose: () => {
            if (trackedId.current !== undefined) {
              releaseDestructiveOperation(input.operationId!, trackedId.current)
            }
          },
        }
      : {}),
  }

  const id =
    input.variant === 'destructive'
      ? sonnerToast.error(input.title, options)
      : input.variant === 'success'
        ? sonnerToast.success(input.title, options)
        : sonnerToast(input.title, options)
  trackedId.current = id

  if (input.variant === 'destructive' && input.operationId) {
    activeDestructiveOperationIds.set(input.operationId, id)
  }

  return {
    dismiss: () => {
      sonnerToast.dismiss(id)
      if (input.operationId) {
        releaseDestructiveOperation(input.operationId, id)
      }
    },
    id,
  }
}

function useToast() {
  return {
    dismiss: sonnerToast.dismiss,
    toast,
  }
}

export { toast, useToast }
