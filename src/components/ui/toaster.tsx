import {
  Toast,
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
      {toasts.map(({ description, id, open, title, variant }) => (
        <Toast key={id} open={open} variant={variant} onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            dismiss(id)
          }
        }}>
          <ToastTitle>{title}</ToastTitle>
          {description ? <ToastDescription>{description}</ToastDescription> : null}
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

export { Toaster }
