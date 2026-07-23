import { useEffect, useRef, useState } from 'react'
import { ValedictorianHttpError, ValedictorianTransportError } from '@sparxie/sdk'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { FormFailureAlert } from '@/components/ui/error-primitives'
import { Input } from '@/components/ui/input'
import { fieldControlId } from '@/lib/field-control-id'
import { safePublicErrorMessage } from '../app/error-presentation'
import type { AppSettingsPatch } from './app-settings'

export function ApiTokenSettingsControls({
  apiTokenConfigured,
  onSettingsPatch,
}: {
  apiTokenConfigured: boolean
  onSettingsPatch: (patch: AppSettingsPatch) => void | Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const controlId = fieldControlId('settings-text', 'API token')
  const statusLabel = apiTokenConfigured ? 'Configured' : 'Not configured'
  const saveLabel = apiTokenConfigured ? 'Replace' : 'Set'

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  async function applyPatch(patch: AppSettingsPatch, fallbackMessage: string) {
    setPending(true)
    setErrorMessage(null)
    try {
      await onSettingsPatch(patch)
      if (!isMountedRef.current) {
        return
      }
      setDraft('')
    } catch (error: unknown) {
      if (!isMountedRef.current) {
        return
      }
      const typedFailure = error instanceof ValedictorianHttpError
        || error instanceof ValedictorianTransportError
      setErrorMessage(
        typedFailure
          ? (safePublicErrorMessage(error) || fallbackMessage)
          : fallbackMessage,
      )
    } finally {
      if (isMountedRef.current) {
        setPending(false)
      }
    }
  }

  return (
    <Field className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-start">
      <FieldLabel className="block font-medium text-foreground" htmlFor={controlId}>
        API token
      </FieldLabel>
      <div className="space-y-3">
        <p
          aria-live="polite"
          className="text-sm text-muted-foreground"
          data-testid="api-token-status"
        >
          {statusLabel}
        </p>
        <Input
          autoComplete="off"
          disabled={pending}
          id={controlId}
          type="password"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            if (errorMessage) setErrorMessage(null)
          }}
        />
        {errorMessage ? (
          <div data-testid="api-token-error">
            <FormFailureAlert message={errorMessage} title="API token update failed" />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || draft.length === 0}
            type="button"
            variant="outline"
            onClick={() => {
              void applyPatch({ apiToken: draft }, 'API token could not be saved.')
            }}
          >
            {saveLabel}
          </Button>
          <Button
            disabled={pending || !apiTokenConfigured}
            type="button"
            variant="outline"
            onClick={() => {
              void applyPatch({ apiToken: '' }, 'API token could not be deleted.')
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </Field>
  )
}
