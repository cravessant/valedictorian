import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'

export type FieldInputType = 'text' | 'textarea' | 'select' | 'datetime-local' | 'number' | 'custom'

export interface CustomFieldControlProps {
  readonly id: string
  readonly value: string
  readonly onChange: (next: string) => void
  readonly disabled: boolean
  readonly invalid: boolean
}

export interface FieldSelectChoice {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface FieldSpec<T> {
  readonly key: keyof T & string
  readonly label: string
  readonly inputType: FieldInputType
  readonly placeholder?: string
  readonly description?: string
  readonly required?: boolean
  readonly choices?: ReadonlyArray<FieldSelectChoice>
  /** When true the field is rendered as a readonly text representation. */
  readonly readOnly?: boolean
  /** Custom control that participates in the shared form draft and validation. */
  readonly render?: (props: CustomFieldControlProps) => ReactNode
}

/** Every lifecycle command that records why it happened requires a rationale. */
export function requireRationale<T extends { rationale: string }>(value: T): FieldErrors<T> | null {
  return value.rationale.trim() === ''
    ? { fieldErrors: { rationale: 'Rationale is required.' } as Partial<Record<keyof T & string, string>> }
    : null
}

export interface FieldErrors<T> {
  readonly fieldErrors?: Partial<Record<keyof T & string, string>>
  readonly formError?: string
}

export interface FormModalProps<T> {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly fields: ReadonlyArray<FieldSpec<T>>
  readonly value: T
  readonly onChange: (next: T) => void
  readonly onSubmit: (value: T) => Promise<void> | void
  readonly onCancel: () => void
  readonly validate?: (value: T) => FieldErrors<T> | null
  readonly pending?: boolean
  readonly submitLabel?: string
  readonly cancelLabel?: string
  readonly error?: string | null
  readonly afterFields?: ReactNode
  readonly footerExtras?: ReactNode
}

/**
 * Shared responsive form modal for lifecycle Add/Edit/Correct flows. Built on
 * the established Dialog/Field/ScrollArea language with labelled controls,
 * keyboard flow, validation that preserves drafts, explicit pending/error
 * state, unsaved-change close/ESC protection, and deterministic opener focus
 * restoration. Mutation feedback is owned by the modal's submit/pending/error
 * surface; the opener action that opened the modal never announces a fake
 * success on open.
 */
export function FormModal<T>({
  open,
  title,
  description,
  fields,
  value,
  onChange,
  onSubmit,
  onCancel,
  validate,
  pending = false,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  error = null,
  afterFields,
  footerExtras,
}: FormModalProps<T>): ReactElement {
  const [draft, setDraft] = useState<T>(value)
  const [localErrors, setLocalErrors] = useState<FieldErrors<T> | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const formId = useId()
  const valueRef = useRef(value)
  const fieldsRef = useRef(fields)
  const initialValueRef = useRef(canonicalFormValue(value, fields))
  valueRef.current = value
  fieldsRef.current = fields

  // Resync the internal draft when the modal (re)opens or the parent
  // explicitly replaces the value while the modal is closed.
  useEffect(() => {
    if (open) {
      setDraft(valueRef.current)
      initialValueRef.current = canonicalFormValue(valueRef.current, fieldsRef.current)
      setLocalErrors(null)
      setSubmitError(null)
      setConfirmDiscardOpen(false)
      openerRef.current = (document.activeElement as HTMLElement | null) ?? null
      const t = setTimeout(() => {
        formRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
      }, 0)
      return () => {
        clearTimeout(t)
        const opener = openerRef.current
        openerRef.current = null
        setTimeout(() => {
          if (opener?.isConnected) opener.focus()
        }, 0)
      }
    }
    // When closing, restore opener focus after the dialog unmounts.
    const opener = openerRef.current
    openerRef.current = null
    const t = setTimeout(() => {
      if (opener?.isConnected) opener.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  function handleFieldChange<K extends keyof T & string>(key: K, raw: string) {
    const next = { ...draft, [key]: raw } as T
    setDraft(next)
    onChange(next)
  }

  const dirty = canonicalFormValue(draft, fields) !== initialValueRef.current
  const dismissLabel = dirty ? 'Discard changes' : cancelLabel

  function requestClose() {
    if (pending) return
    if (dirty) {
      setConfirmDiscardOpen(true)
    } else {
      onCancel()
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const validation = validate?.(draft) ?? null
    setLocalErrors(validation)
    setSubmitError(null)
    if (validation) return
    try {
      await Promise.resolve(onSubmit(draft))
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed.')
    }
  }

  const compositeError = submitError ?? error ?? localErrors?.formError ?? null

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
      >
        <DialogContent
          {...(!description ? { 'aria-describedby': undefined } : {})}
          className="sm:max-w-md"
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            requestClose()
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault()
            requestClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <ScrollArea
            aria-label="Form fields"
            role="region"
            tabIndex={0}
            className="max-h-[60vh] min-h-0"
          >
            <form ref={formRef} id={formId} noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 px-1">
              {fields.map((field) => {
                const raw = String(draft[field.key] ?? '')
                const fieldError = localErrors?.fieldErrors?.[field.key]
                const inputId = `${formId}-${field.key}`
                return (
                  <Field key={field.key}>
                    <FieldLabel htmlFor={inputId}>{field.label}</FieldLabel>
                    {field.inputType === 'custom'
                      ? field.render?.({
                          id: inputId,
                          value: raw,
                          onChange: (next) => handleFieldChange(field.key, next),
                          disabled: pending,
                          invalid: Boolean(fieldError),
                        })
                      : renderFieldInput(field, raw, inputId, (next) => handleFieldChange(field.key, next), pending)}
                    {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
                    {fieldError ? <FieldError>{fieldError}</FieldError> : null}
                  </Field>
                )
              })}
              {afterFields}
            </form>
          </ScrollArea>

          {compositeError ? (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {compositeError}
            </div>
          ) : null}

          {pending ? (
            <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
              Saving…
            </div>
          ) : null}

          <DialogFooter>
            {footerExtras}
            <Button type="button" variant="outline" onClick={requestClose} disabled={pending}>
              {dismissLabel}
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending ? 'Save…' : submitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDiscardOpen}
        onOpenChange={(next) => {
          if (!next) setConfirmDiscardOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing the form will discard the draft you have entered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              variant="destructive"
              onClick={() => {
                if (pending) return
                setConfirmDiscardOpen(false)
                onCancel()
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function canonicalFormValue<T>(value: T, fields: ReadonlyArray<FieldSpec<T>>): string {
  return JSON.stringify(fields.map((field) => [field.key, String(value[field.key] ?? '')]))
}

function renderFieldInput<T>(
  field: FieldSpec<T>,
  raw: string,
  id: string,
  onChange: (next: string) => void,
  pending: boolean,
): ReactElement {
  const commonProps = {
    id,
    name: id,
    required: field.required,
    disabled: pending,
    placeholder: field.placeholder,
  }
  if (field.readOnly) {
    return <Input {...commonProps} readOnly value={raw} />
  }
  switch (field.inputType) {
    case 'textarea':
      return (
        <Textarea
          {...commonProps}
          value={raw}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'select':
      return (
        <NativeSelect
          {...commonProps}
          value={raw}
          onChange={(event) => onChange((event.target as HTMLSelectElement).value)}
        >
          <NativeSelectOption value="">— Select —</NativeSelectOption>
          {field.choices?.map((choice) => (
            <NativeSelectOption key={choice.value} value={choice.value} disabled={choice.disabled}>
              {choice.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )
    default:
      return (
        <Input
          {...commonProps}
          type={field.inputType === 'number' ? 'number' : field.inputType === 'datetime-local' ? 'datetime-local' : 'text'}
          value={raw}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
