import type { Dispatch, SetStateAction } from 'react'
import { profileEducationTypeOptions, type ProfileEducation } from 'sparxie'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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
  isEditorOpen: boolean
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
  isEditorOpen,
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
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table aria-label="Education" className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">School</th>
                <th className="px-4 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {education.map((item) => (
                <ProfileEducationRow
                  key={item.id}
                  education={item}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              ))}
              {education.length === 0 && !isEditorOpen ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                    No education records yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
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
            saveLabel="Save education"
            onCancel={onCancel}
            onSave={onSave}
          />
        </ProfileRowModal>
      ) : null}
    </>
  )
}
