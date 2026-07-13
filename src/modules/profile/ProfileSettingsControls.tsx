import { type ReactNode } from 'react'
import type { ProfileSensitiveDetails } from './profile.repository'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { ModalShell } from '@/components/ui/modal-shell'
import { Field, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { typography } from '@/components/ui/typography'
import { fieldControlId } from '@/lib/field-control-id'
import {
  type ProfileAnswer,
  type ProfileEducation,
  type ProfileSecretKind,
} from 'sparxie'

export const birthMonthOptions = [
  { label: 'January', value: '01' },
  { label: 'February', value: '02' },
  { label: 'March', value: '03' },
  { label: 'April', value: '04' },
  { label: 'May', value: '05' },
  { label: 'June', value: '06' },
  { label: 'July', value: '07' },
  { label: 'August', value: '08' },
  { label: 'September', value: '09' },
  { label: 'October', value: '10' },
  { label: 'November', value: '11' },
  { label: 'December', value: '12' },
]
export const birthDayOptions = Array.from({ length: 31 }, (_, index) => {
  const value = String(index + 1).padStart(2, '0')
  return { label: value, value }
})
export const birthYearOptions = Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => {
  const value = String(new Date().getFullYear() - index)
  return { label: value, value }
})
export const raceEthnicityOptions = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  'Two or more races',
  'Other',
  'Prefer not to answer',
]
export const genderOptions = ['Woman', 'Man', 'Non-binary', 'Other', 'Prefer not to answer']
export const yesNoSelfIdOptions = ['Yes', 'No', 'Prefer not to answer']
export const veteranStatusOptions = [
  'Protected veteran',
  'Not a protected veteran',
  'Prefer not to answer',
]

export function ProfileRowModal({
  children,
  onClose,
  title,
}: {
  children: ReactNode
  onClose: () => void
  title: string
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="grid gap-4">{children}</div>
    </ModalShell>
  )
}

export function formatProfileError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return 'Please try again.'
}

export function ProfileSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return (
    <section className="space-y-3" aria-labelledby={id}>
      <SectionHeader title={title} id={id} />
      <div className="divide-y divide-border rounded-md border border-border bg-card">{children}</div>
    </section>
  )
}

export function SectionHeader({ id, title }: { id: string; title: string }) {
  return (
    <h3 id={id} className={typography.panelTitle}>
      {title}
    </h3>
  )
}

export function BirthDateSelectRow({
  day,
  month,
  onDayChange,
  onMonthChange,
  onYearChange,
  year,
}: {
  day: string
  month: string
  onDayChange: (value: string) => void
  onMonthChange: (value: string) => void
  onYearChange: (value: string) => void
  year: string
}) {
  return (
    <div
      aria-label="Date of birth"
      className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center"
      role="group"
    >
      <div className="font-medium">Date of birth</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <CompactSelect
          label="Birth month"
          options={birthMonthOptions}
          placeholder="Month"
          value={month}
          onChange={onMonthChange}
        />
        <CompactSelect
          label="Birth day"
          options={birthDayOptions}
          placeholder="Day"
          value={day}
          onChange={onDayChange}
        />
        <BirthYearCombobox
          value={year}
          onChange={onYearChange}
        />
      </div>
    </div>
  )
}

function BirthYearCombobox({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  const controlId = fieldControlId('compact-select', 'Birth year')
  const options = [
    { label: 'Year', value: '' },
    ...birthYearOptions,
  ]

  return (
    <Field className="gap-1">
      <FieldLabel className="sr-only" htmlFor={controlId}>
        Birth year
      </FieldLabel>
      <Combobox
        emptyText="No year found."
        id={controlId}
        options={options}
        placeholder="Year"
        searchPlaceholder="Search year..."
        value={value}
        onValueChange={onChange}
      />
    </Field>
  )
}

export function SettingsSelectInput({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
}) {
  const controlId = fieldControlId('settings-select', label)

  return (
    <Field className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center">
      <FieldLabel className="block font-medium text-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <NativeSelect
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <NativeSelectOption value="">Select...</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}

export function CompactSelect({
  label,
  options,
  placeholder,
  value,
  onChange,
}: {
  label: string
  options: Array<{ label: string; value: string }>
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  const controlId = fieldControlId('compact-select', label)

  return (
    <Field className="gap-1">
      <FieldLabel className="sr-only" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <NativeSelect
        id={controlId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <NativeSelectOption value="">{placeholder}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}

export function InlineEditorActions({
  cancelLabel,
  onCancel,
  onSave,
  saveLabel,
}: {
  cancelLabel: string
  onCancel: () => void
  onSave: () => void
  saveLabel: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={onSave}>
        {saveLabel}
      </Button>
      <Button type="button" aria-label={cancelLabel} variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

export function ProfileAnswerRow({
  answer,
  onEdit,
  onRemove,
}: {
  answer: ProfileAnswer
  onEdit: (answer: ProfileAnswer) => void
  onRemove: (key: string) => void
}) {
  return (
    <tr>
      <td className="px-4 py-3 font-medium text-foreground">{answer.label}</td>
      <td className="px-4 py-3 text-muted-foreground">{answer.questionPattern}</td>
      <td className="px-4 py-3 text-foreground">{answer.answer}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {answer.includeInAgentContext ? 'Yes' : 'No'}
      </td>
      <td className="flex flex-wrap gap-2 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          aria-label={`Edit answer ${answer.label}`}
          onClick={() => onEdit(answer)}
        >
          Edit
        </Button>
        <Button type="button" variant="ghost" onClick={() => onRemove(answer.key)}>
          Remove
        </Button>
      </td>
    </tr>
  )
}

export function ProfileEducationRow({
  education,
  onEdit,
  onRemove,
}: {
  education: ProfileEducation
  onEdit: (education: ProfileEducation) => void
  onRemove: (id: string) => void
}) {
  const details = [
    education.degree,
    education.major,
    education.classStanding,
    education.graduationDate,
    education.satScore ? `SAT ${education.satScore}` : null,
    education.transcriptPath,
  ].filter(Boolean)

  return (
    <tr>
      <td className="px-4 py-3 font-medium text-foreground">{education.educationType}</td>
      <td className="px-4 py-3 text-foreground">{education.school}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {details.length ? details.join(' / ') : 'No details'}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{education.notes ?? 'No notes'}</td>
      <td className="flex flex-wrap gap-2 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          aria-label={`Edit education ${education.school}`}
          onClick={() => onEdit(education)}
        >
          Edit
        </Button>
        <Button type="button" variant="ghost" onClick={() => onRemove(education.id)}>
          Remove
        </Button>
      </td>
    </tr>
  )
}

export function BooleanPreferenceControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | null
  onChange: (value: boolean) => void
}) {
  const yesId = fieldControlId('boolean-preference', `${label} Yes`)
  const noId = fieldControlId('boolean-preference', `${label} No`)
  const groupLabelId = fieldControlId('boolean-preference', label)
  const groupValue = value === true ? 'true' : value === false ? 'false' : ''

  return (
    <div className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center">
      <div className="font-medium" id={groupLabelId}>{label}</div>
      <RadioGroup
        aria-labelledby={groupLabelId}
        className="flex flex-wrap gap-2"
        value={groupValue}
        onValueChange={(next) => onChange(next === 'true')}
      >
        <Label
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3"
          htmlFor={yesId}
        >
          <RadioGroupItem
            aria-label={`${label} Yes`}
            id={yesId}
            value="true"
          />
          <span>Yes</span>
        </Label>
        <Label
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3"
          htmlFor={noId}
        >
          <RadioGroupItem
            aria-label={`${label} No`}
            id={noId}
            value="false"
          />
          <span>No</span>
        </Label>
      </RadioGroup>
    </div>
  )
}

export function CompactInput({
  label,
  type = 'text',
  value,
  onChange,
}: {
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
}) {
  const controlId = fieldControlId('compact-input', label)

  return (
    <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
      <FieldLabel className="text-xs font-medium text-muted-foreground" htmlFor={controlId}>
        {label}
      </FieldLabel>
      <Input
        className="px-2"
        id={controlId}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function nullableInput(value: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

export const answerDraftDefaults = {
  answer: '',
  includeInAgentContext: false,
  label: '',
  questionPattern: '',
}

export const educationDraftDefaults = {
  classStanding: '',
  degree: '',
  educationType: 'College',
  graduationDate: '',
  major: '',
  notes: '',
  otherEducationType: '',
  satScore: '',
  school: '',
  transcriptPath: '',
}

export const secretDraftDefaults = {
  key: '',
  kind: 'password' as ProfileSecretKind,
  label: '',
  value: '',
}

export const defaultSensitiveDetails: ProfileSensitiveDetails = {
  birthDay: null,
  birthMonth: null,
  birthYear: null,
  disabilityStatus: null,
  gender: null,
  hispanicLatino: null,
  raceEthnicity: null,
  ssnLast4: null,
  veteranStatus: null,
}
