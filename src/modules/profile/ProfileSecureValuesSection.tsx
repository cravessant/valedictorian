import type { Dispatch, SetStateAction } from 'react'
import type { ProfileSecretKind } from 'sparxie'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { fieldControlId } from '@/lib/field-control-id'
import type { ProfileSecretSummary } from 'sparxie'
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
  isEditorOpen: boolean
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
  isEditorOpen,
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
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table aria-label="Secure Values" className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {secrets.map((secret) => (
                <tr key={secret.key}>
                  <td className="px-4 py-3 font-medium text-foreground">{secret.label}</td>
                  <td className="px-4 py-3 text-muted-foreground">{secret.key}</td>
                  <td className="px-4 py-3 text-muted-foreground">{secret.kind}</td>
                  <td className="px-4 py-3 text-muted-foreground">••••••••</td>
                  <td className="flex flex-wrap gap-2 px-4 py-3">
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
                  </td>
                </tr>
              ))}
              {secrets.length === 0 && !isEditorOpen ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                    No secure values yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
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
            saveLabel="Save secure value"
            onCancel={onCancel}
            onSave={onSave}
          />
        </ProfileRowModal>
      ) : null}
    </>
  )
}
