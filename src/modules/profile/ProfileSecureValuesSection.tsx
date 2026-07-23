import type { Dispatch, SetStateAction } from 'react'
import type { ProfileSecretKind } from '@sparxie/sdk'
import { Button } from '@/components/ui/button'
import { FormFailureAlert } from '@/components/ui/error-primitives'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fieldControlId } from '@/lib/field-control-id'
import type { ProfileSecretSummary } from '@sparxie/sdk'
import {
  CompactInput,
  InlineEditorActions,
  ProfileRowModal,
  secretDraftDefaults,
  SectionHeader,
} from './ProfileSettingsControls'

type SecretDraft = typeof secretDraftDefaults

type ProfileSecureValuesSectionProps = {
  draft: SecretDraft
  editorMode: 'add' | 'edit'
  formError: string | null
  isEditorOpen: boolean
  saveDisabled?: boolean
  onAdd: () => void
  onCancel: () => void
  onDraftChange: Dispatch<SetStateAction<SecretDraft>>
  onEdit: (secret: ProfileSecretSummary) => void
  onRemove: (key: string) => void
  onSave: () => void
  secrets: ProfileSecretSummary[]
}

export function ProfileSecureValuesSection({
  draft,
  editorMode,
  formError,
  isEditorOpen,
  saveDisabled = false,
  onAdd,
  onCancel,
  onDraftChange,
  onEdit,
  onRemove,
  onSave,
  secrets,
}: ProfileSecureValuesSectionProps) {
  return (
    <>
      <section className="space-y-3" aria-labelledby="secure-values-title">
        <SectionHeader title="Secure Values" id="secure-values-title" />
        <div className="rounded-md border border-border bg-card">
          <Table aria-label="Secure Values" className="min-w-[760px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secrets.map((secret) => (
                <TableRow key={secret.key}>
                  <TableCell className="font-medium text-foreground">{secret.label}</TableCell>
                  <TableCell className="text-muted-foreground">{secret.key}</TableCell>
                  <TableCell className="text-muted-foreground">{secret.kind}</TableCell>
                  <TableCell className="text-muted-foreground">••••••••</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Edit secure value ${secret.label}`}
                        onClick={() => onEdit(secret)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Remove secure value ${secret.label}`}
                        onClick={() => onRemove(secret.key)}
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {secrets.length === 0 && !isEditorOpen ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={5}>
                    No secure values yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!isEditorOpen ? (
            <Button type="button" onClick={onAdd}>
              Add secure value
            </Button>
          ) : null}
        </div>
      </section>

      {isEditorOpen ? (
        <ProfileRowModal
          title={editorMode === 'add' ? 'Add secure value' : 'Edit secure value'}
          onClose={onCancel}
        >
          {formError ? <FormFailureAlert message={formError} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <CompactInput
              label="Secure value name"
              value={draft.label}
              onChange={(value) =>
                onDraftChange((current) => ({ ...current, label: value }))
              }
            />
            <CompactInput
              label="Secure value key"
              value={draft.key}
              onChange={(value) => onDraftChange((current) => ({ ...current, key: value }))}
            />
            <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId('profile', 'Secure value type')}
              >
                Type
              </FieldLabel>
              <NativeSelect
                aria-label="Secure value type"
                className="px-2"
                id={fieldControlId('profile', 'Secure value type')}
                value={draft.kind}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    kind: event.target.value as ProfileSecretKind,
                  }))
                }
              >
                <NativeSelectOption value="password">password</NativeSelectOption>
                <NativeSelectOption value="token">token</NativeSelectOption>
                <NativeSelectOption value="identity">identity</NativeSelectOption>
                <NativeSelectOption value="other">other</NativeSelectOption>
              </NativeSelect>
            </Field>
            <CompactInput
              label="Secure value"
              type="password"
              value={draft.value}
              onChange={(value) => onDraftChange((current) => ({ ...current, value }))}
            />
          </div>
          <InlineEditorActions
            cancelLabel="Cancel secure value"
            disabled={saveDisabled}
            saveLabel="Save secure value"
            onCancel={onCancel}
            onSave={onSave}
          />
        </ProfileRowModal>
      ) : null}
    </>
  )
}
