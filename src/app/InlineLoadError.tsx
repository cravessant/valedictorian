import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

export function InlineLoadError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="mt-2">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>Load failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
