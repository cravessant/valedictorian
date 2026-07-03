import {
  Toast,
  ToastAction,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'

function Toaster() {
  const { dismiss, toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(({ action, description, id, open, title, variant }) => (
        <Toast key={id} open={open} variant={variant} onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            dismiss(id)
          }
        }}>
          <ToastTitle>{title}</ToastTitle>
          {description ? <ToastDescription>{description}</ToastDescription> : null}
          {action ? (
            <ToastAction
              altText={action.label}
              onClick={() => {
                void action.onClick()
                dismiss(id)
              }}
            >
              {action.label}
            </ToastAction>
          ) : null}
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

export { Toaster }
