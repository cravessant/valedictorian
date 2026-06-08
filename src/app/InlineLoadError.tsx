import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

export function InlineLoadError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="mt-2 bg-card">
      <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
      <div className="pl-7">
        <AlertTitle>Load failed</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </div>
    </Alert>
  )
}
