import type { Dispatch, SetStateAction } from 'react'
import { profileEducationTypeOptions, type ProfileEducation } from '@sparxie/sdk'
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
import {
  CompactInput,
  educationDraftDefaults,
  InlineEditorActions,
  ProfileEducationRow,
  ProfileRowModal,
  SectionHeader,
} from './ProfileSettingsControls'

type EducationDraft = typeof educationDraftDefaults

type ProfileEducationSectionProps = {
  draft: EducationDraft
  editorMode: 'add' | 'edit'
  education: ProfileEducation[]
  formError: string | null
  isEditorOpen: boolean
  saveDisabled?: boolean
  onAdd: () => void
  onCancel: () => void
  onDraftChange: Dispatch<SetStateAction<EducationDraft>>
  onEdit: (education: ProfileEducation) => void
  onRemove: (id: string) => void
  onSave: () => void
}

export function ProfileEducationSection({
  draft,
  editorMode,
  education,
  formError,
  isEditorOpen,
  saveDisabled = false,
  onAdd,
  onCancel,
  onDraftChange,
  onEdit,
  onRemove,
  onSave,
}: ProfileEducationSectionProps) {
  return (
    <>
      <section className="space-y-3" aria-labelledby="education-title">
        <SectionHeader title="Education" id="education-title" />
        <div className="rounded-md border border-border bg-card">
          <Table aria-label="Education" className="min-w-[820px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Type</TableHead>
                <TableHead>School</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {education.map((item) => (
                <ProfileEducationRow
                  key={item.id}
                  education={item}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              ))}
              {education.length === 0 && !isEditorOpen ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={5}>
                    No education records yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!isEditorOpen ? (
            <Button type="button" onClick={onAdd}>
              Add education
            </Button>
          ) : null}
        </div>
      </section>

      {isEditorOpen ? (
        <ProfileRowModal
          title={editorMode === 'add' ? 'Add education' : 'Edit education'}
          onClose={onCancel}
        >
          {formError ? <FormFailureAlert message={formError} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId('profile', 'Education type')}
              >
                Education type
              </FieldLabel>
              <NativeSelect
                className="px-2"
                id={fieldControlId('profile', 'Education type')}
                value={draft.educationType}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    educationType: event.target.value,
                  }))
                }
              >
                {profileEducationTypeOptions.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {draft.educationType === 'Other' ? (
              <CompactInput
                label="Other education type"
                value={draft.otherEducationType}
                onChange={(value) =>
                  onDraftChange((current) => ({ ...current, otherEducationType: value }))
                }
              />
            ) : null}
            <CompactInput
              label="School name"
              value={draft.school}
              onChange={(value) =>
                onDraftChange((current) => ({ ...current, school: value }))
              }
            />
            {draft.educationType !== 'High school' ? (
              <>
                <CompactInput
                  label="Degree"
                  value={draft.degree}
                  onChange={(value) =>
                    onDraftChange((current) => ({ ...current, degree: value }))
                  }
                />
                <CompactInput
                  label="Major"
                  value={draft.major}
                  onChange={(value) =>
                    onDraftChange((current) => ({ ...current, major: value }))
                  }
                />
              </>
            ) : null}
            <CompactInput
              label="Graduation date"
              value={draft.graduationDate}
              onChange={(value) =>
                onDraftChange((current) => ({ ...current, graduationDate: value }))
              }
            />
            <CompactInput
              label="Class standing"
              value={draft.classStanding}
              onChange={(value) =>
                onDraftChange((current) => ({ ...current, classStanding: value }))
              }
            />
            {draft.educationType === 'High school' ? (
              <CompactInput
                label="SAT"
                value={draft.satScore}
                onChange={(value) =>
                  onDraftChange((current) => ({ ...current, satScore: value }))
                }
              />
            ) : null}
            <CompactInput
              label="Transcript path"
              value={draft.transcriptPath}
              onChange={(value) =>
                onDraftChange((current) => ({ ...current, transcriptPath: value }))
              }
            />
            <CompactInput
              label="Education notes"
              value={draft.notes}
              onChange={(value) =>
                onDraftChange((current) => ({ ...current, notes: value }))
              }
            />
          </div>
          <InlineEditorActions
            cancelLabel="Cancel education"
            disabled={saveDisabled}
            saveLabel="Save education"
            onCancel={onCancel}
            onSave={onSave}
          />
        </ProfileRowModal>
      ) : null}
    </>
  )
}
