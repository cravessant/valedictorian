import { toast as sonnerToast } from 'sonner'

type ToastVariant = 'default' | 'destructive' | 'success'

export interface ToastInput {
  action?: {
    label: string
    onClick: () => Promise<void> | void
  }
  description?: string
  title: string
  variant?: ToastVariant
}

function toast(input: ToastInput) {
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
  }

  const id =
    input.variant === 'destructive'
      ? sonnerToast.error(input.title, options)
      : input.variant === 'success'
        ? sonnerToast.success(input.title, options)
        : sonnerToast(input.title, options)

  return {
    dismiss: () => {
      sonnerToast.dismiss(id)
    },
    id: String(id),
  }
}

function useToast() {
  return {
    dismiss: sonnerToast.dismiss,
    toast,
  }
}

export { toast, useToast }
