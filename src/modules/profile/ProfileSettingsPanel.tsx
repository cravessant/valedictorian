import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ModalShell } from '@/components/ui/modal-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import {
  defaultUserProfile,
  normalizeProfileEducationInput,
  normalizeProfileAnswerInput,
  profileEducationTypeOptions,
  type ProfileAnswer,
  type ProfileEducation,
  type ProfileSecretKind,
  type ProfileUpdateInput,
  type UserProfile,
} from 'sparxie'
import type { ProfilePreloadApi } from '../../ipc/profile.preload'
import type {
  ProfileSensitiveDetails,
  ProfileSecretSummary,
} from './profile.repository'
import { SettingsTextInput } from '../../settings/SettingsTextInput'

const defaultSensitiveDetails: ProfileSensitiveDetails = {
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

const answerDraftDefaults = {
  answer: '',
  includeInAgentContext: false,
  label: '',
  questionPattern: '',
}

const educationDraftDefaults = {
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

const secretDraftDefaults = {
  key: '',
  kind: 'password' as ProfileSecretKind,
  label: '',
  value: '',
}

const birthMonthOptions = [
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
const birthDayOptions = Array.from({ length: 31 }, (_, index) => {
  const value = String(index + 1).padStart(2, '0')
  return { label: value, value }
})
const birthYearOptions = Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => {
  const value = String(new Date().getFullYear() - index)
  return { label: value, value }
})
const raceEthnicityOptions = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  'Two or more races',
  'Other',
  'Prefer not to answer',
]
const genderOptions = ['Woman', 'Man', 'Non-binary', 'Other', 'Prefer not to answer']
const yesNoSelfIdOptions = ['Yes', 'No', 'Prefer not to answer']
const veteranStatusOptions = [
  'Protected veteran',
  'Not a protected veteran',
  'Prefer not to answer',
]

type ProfileField = keyof Omit<UserProfile, 'answers' | 'education'>
type ProfileSaveScope =
  | 'answer'
  | 'education'
  | 'private-identifiers'
  | 'profile'
  | 'secret'
  | 'voluntary-self-id'
type ProfileSaveStatus = {
  kind: 'saving' | 'success' | 'error'
  message: string
  scope: ProfileSaveScope
} | null

function ProfileSettingsPanel({ profileApi }: { profileApi: ProfilePreloadApi }) {
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile)
  const [sensitiveDetails, setSensitiveDetails] =
    useState<ProfileSensitiveDetails>(defaultSensitiveDetails)
  const [isProfileLoading, setIsProfileLoading] = useState(true)
  const [showAnswerEditor, setShowAnswerEditor] = useState(false)
  const [showEducationEditor, setShowEducationEditor] = useState(false)
  const [showSecretEditor, setShowSecretEditor] = useState(false)
  const [answerEditorMode, setAnswerEditorMode] = useState<'add' | 'edit'>('add')
  const [educationEditorMode, setEducationEditorMode] = useState<'add' | 'edit'>('add')
  const [secretEditorMode, setSecretEditorMode] = useState<'add' | 'edit'>('add')
  const [answerDraft, setAnswerDraft] = useState(answerDraftDefaults)
  const [educationDraft, setEducationDraft] = useState(educationDraftDefaults)
  const [secretDraft, setSecretDraft] = useState(secretDraftDefaults)
  const [secretSummaries, setSecretSummaries] = useState<ProfileSecretSummary[]>([])
  const [saveStatus, setSaveStatus] = useState<ProfileSaveStatus>(null)
  const { toast } = useToast()

  useEffect(() => {
    let active = true

    void Promise.all([profileApi.get(), profileApi.sensitive.get(), profileApi.secrets.list()])
      .then(([savedProfile, savedSensitiveDetails, savedSecrets]) => {
        if (!active) {
          return
        }

        setProfile(savedProfile)
        setSensitiveDetails(savedSensitiveDetails)
        setSecretSummaries(savedSecrets)
      })
      .finally(() => {
        if (active) {
          setIsProfileLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [profileApi])

  function updateProfileField(field: ProfileField, value: string) {
    setProfile((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function updateSensitiveField(field: keyof ProfileSensitiveDetails, value: string) {
    setSensitiveDetails((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function buildProfilePatch(
    answers = profile.answers,
    education = profile.education,
  ): ProfileUpdateInput {
    const patch: ProfileUpdateInput = {
      answers,
      education,
    }
    const fields: ProfileField[] = [
      'addressLine1',
      'addressLine2',
      'city',
      'country',
      'citizenship',
      'coverLetterPath',
      'email',
      'fullName',
      'githubUrl',
      'language',
      'linkedinUrl',
      'phone',
      'phoneDeviceType',
      'portfolioUrl',
      'preferredName',
      'region',
      'relocationNotes',
      'requireSponsorship',
      'requireSponsorshipFuture',
      'travelNotes',
      'willingToRelocate',
      'willingToTravel',
      'workAuthorization',
    ]

    for (const field of fields) {
      const value = profile[field]

      if (value !== null && value !== undefined && value !== '') {
        Object.assign(patch, { [field]: value })
      }
    }

    return patch
  }

  function saveProfile() {
    runProfileAction({
      errorPrefix: 'Could not save profile',
      onSuccess: setProfile,
      pendingMessage: 'Saving profile...',
      scope: 'profile',
      successMessage: 'Profile saved.',
      task: () => profileApi.update(buildProfilePatch()),
    })
  }

  function saveEducation() {
    const nextEducationItem = normalizeProfileEducationInput({
      classStanding: educationDraft.classStanding,
      degree: educationDraft.degree,
      educationType:
        educationDraft.educationType === 'Other'
          ? educationDraft.otherEducationType
          : educationDraft.educationType,
      graduationDate: educationDraft.graduationDate,
      major: educationDraft.major,
      notes: educationDraft.notes,
      satScore: educationDraft.satScore,
      school: educationDraft.school,
      transcriptPath: educationDraft.transcriptPath,
    })
    const nextEducation = [
      ...profile.education.filter((item) => item.id !== nextEducationItem.id),
      nextEducationItem,
    ]

    setProfile((current) => ({ ...current, education: nextEducation }))
    setEducationDraft(educationDraftDefaults)
    setShowEducationEditor(false)
    runProfileAction({
      errorPrefix: 'Could not save education',
      onSuccess: setProfile,
      pendingMessage: 'Saving education...',
      scope: 'education',
      successMessage: 'Education saved.',
      task: () => profileApi.update(buildProfilePatch(profile.answers, nextEducation)),
    })
  }

  function cancelEducation() {
    setEducationDraft(educationDraftDefaults)
    setEducationEditorMode('add')
    setShowEducationEditor(false)
  }

  function openAddEducation() {
    setEducationDraft(educationDraftDefaults)
    setEducationEditorMode('add')
    setShowEducationEditor(true)
  }

  function openEditEducation(education: ProfileEducation) {
    setEducationDraft({
      classStanding: education.classStanding ?? '',
      degree: education.degree ?? '',
      educationType: profileEducationTypeOptions.includes(education.educationType as never)
        ? education.educationType
        : 'Other',
      graduationDate: education.graduationDate ?? '',
      major: education.major ?? '',
      notes: education.notes ?? '',
      otherEducationType: profileEducationTypeOptions.includes(education.educationType as never)
        ? ''
        : education.educationType,
      satScore: education.satScore ?? '',
      school: education.school,
      transcriptPath: education.transcriptPath ?? '',
    })
    setEducationEditorMode('edit')
    setShowEducationEditor(true)
  }

  function removeEducation(id: string) {
    const nextEducation = profile.education.filter((item) => item.id !== id)

    setProfile((current) => ({ ...current, education: nextEducation }))
    runProfileAction({
      errorPrefix: 'Could not remove education',
      onSuccess: setProfile,
      pendingMessage: 'Removing education...',
      scope: 'education',
      successMessage: 'Education removed.',
      task: () => profileApi.update(buildProfilePatch(profile.answers, nextEducation)),
    })
  }

  function savePrivateIdentifiers() {
    runProfileAction({
      errorPrefix: 'Could not save private identifiers',
      onSuccess: setSensitiveDetails,
      pendingMessage: 'Saving private identifiers...',
      scope: 'private-identifiers',
      successMessage: 'Private identifiers saved.',
      task: () =>
        profileApi.sensitive.update({
          birthDay: nullableInput(sensitiveDetails.birthDay),
          birthMonth: nullableInput(sensitiveDetails.birthMonth),
          birthYear: nullableInput(sensitiveDetails.birthYear),
          ssnLast4: nullableInput(sensitiveDetails.ssnLast4),
        }),
    })
  }

  function saveVoluntarySelfId() {
    runProfileAction({
      errorPrefix: 'Could not save voluntary self-ID',
      onSuccess: setSensitiveDetails,
      pendingMessage: 'Saving voluntary self-ID...',
      scope: 'voluntary-self-id',
      successMessage: 'Voluntary self-ID saved.',
      task: () =>
        profileApi.sensitive.update({
          disabilityStatus: nullableInput(sensitiveDetails.disabilityStatus),
          gender: nullableInput(sensitiveDetails.gender),
          hispanicLatino: nullableInput(sensitiveDetails.hispanicLatino),
          raceEthnicity: nullableInput(sensitiveDetails.raceEthnicity),
          veteranStatus: nullableInput(sensitiveDetails.veteranStatus),
        }),
    })
  }

  function saveAnswer() {
    const nextAnswer = normalizeProfileAnswerInput({
      answer: answerDraft.answer,
      category: null,
      includeInAgentContext: answerDraft.includeInAgentContext,
      label: answerDraft.label,
      questionPattern: answerDraft.questionPattern,
    })
    const nextAnswers = [
      ...profile.answers.filter((answer) => answer.key !== nextAnswer.key),
      nextAnswer,
    ]

    setProfile((current) => ({ ...current, answers: nextAnswers }))
    setAnswerDraft(answerDraftDefaults)
    setShowAnswerEditor(false)
    runProfileAction({
      errorPrefix: 'Could not save answer',
      onSuccess: setProfile,
      pendingMessage: 'Saving answer...',
      scope: 'answer',
      successMessage: 'Answer saved.',
      task: () => profileApi.update(buildProfilePatch(nextAnswers)),
    })
  }

  function cancelAnswer() {
    setAnswerDraft(answerDraftDefaults)
    setAnswerEditorMode('add')
    setShowAnswerEditor(false)
  }

  function openAddAnswer() {
    setAnswerDraft(answerDraftDefaults)
    setAnswerEditorMode('add')
    setShowAnswerEditor(true)
  }

  function openEditAnswer(answer: ProfileAnswer) {
    setAnswerDraft({
      answer: answer.answer,
      includeInAgentContext: answer.includeInAgentContext,
      label: answer.label,
      questionPattern: answer.questionPattern,
    })
    setAnswerEditorMode('edit')
    setShowAnswerEditor(true)
  }

  function removeAnswer(key: string) {
    const nextAnswers = profile.answers.filter((answer) => answer.key !== key)

    setProfile((current) => ({ ...current, answers: nextAnswers }))
    runProfileAction({
      errorPrefix: 'Could not remove answer',
      onSuccess: setProfile,
      pendingMessage: 'Removing answer...',
      scope: 'answer',
      successMessage: 'Answer removed.',
      task: () => profileApi.update(buildProfilePatch(nextAnswers)),
    })
  }

  function saveSecret() {
    runProfileAction({
      errorPrefix: 'Could not save secure value',
      onSuccess: (savedSecrets) => {
        setSecretDraft(secretDraftDefaults)
        setShowSecretEditor(false)
        setSecretSummaries(savedSecrets)
      },
      pendingMessage: 'Saving secure value...',
      scope: 'secret',
      successMessage: 'Secure value saved.',
      task: () => profileApi.secrets.upsert(secretDraft).then(() => profileApi.secrets.list()),
    })
  }

  function cancelSecret() {
    setSecretDraft(secretDraftDefaults)
    setSecretEditorMode('add')
    setShowSecretEditor(false)
  }

  function openAddSecret() {
    setSecretDraft(secretDraftDefaults)
    setSecretEditorMode('add')
    setShowSecretEditor(true)
  }

  function openEditSecret(secret: ProfileSecretSummary) {
    setSecretDraft({
      key: secret.key,
      kind: secret.kind,
      label: secret.label,
      value: '',
    })
    setSecretEditorMode('edit')
    setShowSecretEditor(true)
  }

  function removeSecret(key: string) {
    runProfileAction({
      errorPrefix: 'Could not remove secure value',
      onSuccess: () => {
        setSecretSummaries((current) => current.filter((secret) => secret.key !== key))
      },
      pendingMessage: 'Removing secure value...',
      scope: 'secret',
      successMessage: 'Secure value removed.',
      task: () => profileApi.secrets.delete(key),
    })
  }

  function runProfileAction<T>({
    errorPrefix,
    onSuccess,
    pendingMessage,
    scope,
    successMessage,
    task,
  }: {
    errorPrefix: string
    onSuccess: (value: T) => void
    pendingMessage: string
    scope: ProfileSaveScope
    successMessage: string
    task: () => Promise<T>
  }) {
    setSaveStatus({ kind: 'saving', message: pendingMessage, scope })
    void task()
      .then((value) => {
        onSuccess(value)
        setSaveStatus({ kind: 'success', message: successMessage, scope })
        toast({
          title: successMessage,
          variant: 'success',
        })
      })
      .catch((error: unknown) => {
        const message = `${errorPrefix}. ${formatProfileError(error)}`
        setSaveStatus({
          kind: 'error',
          message,
          scope,
        })
        toast({
          description: message,
          title: 'Profile update failed',
          variant: 'destructive',
        })
      })
  }

  function isSaving(scope: ProfileSaveScope) {
    return saveStatus?.scope === scope && saveStatus.kind === 'saving'
  }

  return (
    <section aria-labelledby="profile-settings-title" className="space-y-7">
      <div>
        <h2 id="profile-settings-title" className="text-xl font-semibold text-foreground">
          Profile
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Store application-ready facts, reusable answers, and local-only secure details.
        </p>
      </div>

      {isProfileLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <ProfileSection title="Profile Basics">
            <SettingsTextInput
              label="Full name"
              value={profile.fullName ?? ''}
              onChange={(value) => updateProfileField('fullName', value)}
            />
            <SettingsTextInput
              label="Preferred name"
              value={profile.preferredName ?? ''}
              onChange={(value) => updateProfileField('preferredName', value)}
            />
            <SettingsTextInput
              label="Email"
              value={profile.email ?? ''}
              onChange={(value) => updateProfileField('email', value)}
            />
            <SettingsTextInput
              label="Phone"
              value={profile.phone ?? ''}
              onChange={(value) => updateProfileField('phone', value)}
            />
            <SettingsTextInput
              label="Phone device type"
              value={profile.phoneDeviceType ?? ''}
              onChange={(value) => updateProfileField('phoneDeviceType', value)}
            />
            <SettingsTextInput
              label="Address line 1"
              value={profile.addressLine1 ?? ''}
              onChange={(value) => updateProfileField('addressLine1', value)}
            />
            <SettingsTextInput
              label="Address line 2"
              value={profile.addressLine2 ?? ''}
              onChange={(value) => updateProfileField('addressLine2', value)}
            />
            <SettingsTextInput
              label="City"
              value={profile.city ?? ''}
              onChange={(value) => updateProfileField('city', value)}
            />
            <SettingsTextInput
              label="Region"
              value={profile.region ?? ''}
              onChange={(value) => updateProfileField('region', value)}
            />
            <SettingsTextInput
              label="Country"
              value={profile.country ?? ''}
              onChange={(value) => updateProfileField('country', value)}
            />
            <SettingsTextInput
              label="Language"
              value={profile.language ?? ''}
              onChange={(value) => updateProfileField('language', value)}
            />
            <SettingsTextInput
              label="Website"
              value={profile.portfolioUrl ?? ''}
              onChange={(value) => updateProfileField('portfolioUrl', value)}
            />
            <SettingsTextInput
              label="GitHub"
              value={profile.githubUrl ?? ''}
              onChange={(value) => updateProfileField('githubUrl', value)}
            />
            <SettingsTextInput
              label="LinkedIn"
              value={profile.linkedinUrl ?? ''}
              onChange={(value) => updateProfileField('linkedinUrl', value)}
            />
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
              <Button type="button" disabled={isSaving('profile')} onClick={saveProfile}>
                {isSaving('profile') ? 'Saving...' : 'Save profile basics'}
              </Button>
            </div>
          </ProfileSection>

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
                  {profile.education.map((education) => (
                    <ProfileEducationRow
                      key={education.id}
                      education={education}
                      onEdit={openEditEducation}
                      onRemove={removeEducation}
                    />
                  ))}
                  {profile.education.length === 0 && !showEducationEditor ? (
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
              {!showEducationEditor ? (
                <Button type="button" onClick={openAddEducation}>
                  Add education
                </Button>
              ) : null}
            </div>
          </section>

          <ProfileSection title="Work Authorization">
            <SettingsTextInput
              label="Work authorization"
              value={profile.workAuthorization ?? ''}
              onChange={(value) => updateProfileField('workAuthorization', value)}
            />
            <SettingsTextInput
              label="Citizenship"
              value={profile.citizenship ?? ''}
              onChange={(value) => updateProfileField('citizenship', value)}
            />
            <SettingsTextInput
              label="Require sponsorship"
              value={profile.requireSponsorship ?? ''}
              onChange={(value) => updateProfileField('requireSponsorship', value)}
            />
            <SettingsTextInput
              label="Require future sponsorship"
              value={profile.requireSponsorshipFuture ?? ''}
              onChange={(value) => updateProfileField('requireSponsorshipFuture', value)}
            />
            <BooleanPreferenceControl
              label="Willing to relocate"
              value={profile.willingToRelocate}
              onChange={(value) =>
                setProfile((current) => ({ ...current, willingToRelocate: value }))
              }
            />
            <SettingsTextInput
              label="Relocation notes"
              value={profile.relocationNotes ?? ''}
              onChange={(value) => updateProfileField('relocationNotes', value)}
            />
            <BooleanPreferenceControl
              label="Willing to travel"
              value={profile.willingToTravel}
              onChange={(value) =>
                setProfile((current) => ({ ...current, willingToTravel: value }))
              }
            />
            <SettingsTextInput
              label="Travel notes"
              value={profile.travelNotes ?? ''}
              onChange={(value) => updateProfileField('travelNotes', value)}
            />
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
              <Button type="button" disabled={isSaving('profile')} onClick={saveProfile}>
                {isSaving('profile') ? 'Saving...' : 'Save work authorization'}
              </Button>
            </div>
          </ProfileSection>

          <ProfileSection title="Private Identifiers">
            <BirthDateSelectRow
              day={sensitiveDetails.birthDay ?? ''}
              month={sensitiveDetails.birthMonth ?? ''}
              year={sensitiveDetails.birthYear ?? ''}
              onDayChange={(value) => updateSensitiveField('birthDay', value)}
              onMonthChange={(value) => updateSensitiveField('birthMonth', value)}
              onYearChange={(value) => updateSensitiveField('birthYear', value)}
            />
            <SettingsTextInput
              label="Last 4 SSN"
              type="password"
              value={sensitiveDetails.ssnLast4 ?? ''}
              onChange={(value) => updateSensitiveField('ssnLast4', value)}
            />
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
              <Button
                type="button"
                disabled={isSaving('private-identifiers')}
                onClick={savePrivateIdentifiers}
              >
                {isSaving('private-identifiers') ? 'Saving...' : 'Save private identifiers'}
              </Button>
            </div>
          </ProfileSection>

          <ProfileSection title="Voluntary Self-ID">
            <SettingsSelectInput
              label="Race/ethnicity"
              options={raceEthnicityOptions}
              value={sensitiveDetails.raceEthnicity ?? ''}
              onChange={(value) => updateSensitiveField('raceEthnicity', value)}
            />
            <SettingsSelectInput
              label="Gender"
              options={genderOptions}
              value={sensitiveDetails.gender ?? ''}
              onChange={(value) => updateSensitiveField('gender', value)}
            />
            <SettingsSelectInput
              label="Disability status"
              options={yesNoSelfIdOptions}
              value={sensitiveDetails.disabilityStatus ?? ''}
              onChange={(value) => updateSensitiveField('disabilityStatus', value)}
            />
            <SettingsSelectInput
              label="Veteran status"
              options={veteranStatusOptions}
              value={sensitiveDetails.veteranStatus ?? ''}
              onChange={(value) => updateSensitiveField('veteranStatus', value)}
            />
            <SettingsSelectInput
              label="Hispanic/Latino"
              options={yesNoSelfIdOptions}
              value={sensitiveDetails.hispanicLatino ?? ''}
              onChange={(value) => updateSensitiveField('hispanicLatino', value)}
            />
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
              <Button
                type="button"
                disabled={isSaving('voluntary-self-id')}
                onClick={saveVoluntarySelfId}
              >
                {isSaving('voluntary-self-id') ? 'Saving...' : 'Save voluntary self-ID'}
              </Button>
            </div>
          </ProfileSection>

          <section className="space-y-3" aria-labelledby="reusable-answers-title">
            <SectionHeader title="Reusable Application Answers" id="reusable-answers-title" />
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table
                aria-label="Reusable Application Answers"
                className="w-full min-w-[760px] text-left text-sm"
              >
                <thead className="border-b border-border text-xs uppercase tracking-normal text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Question hint</th>
                    <th className="px-4 py-3 font-medium">Answer</th>
                    <th className="px-4 py-3 font-medium">Available to automation</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {profile.answers.map((answer) => (
                    <ProfileAnswerRow
                      key={answer.key}
                      answer={answer}
                      onEdit={openEditAnswer}
                      onRemove={removeAnswer}
                    />
                  ))}
                  {profile.answers.length === 0 && !showAnswerEditor ? (
                    <tr>
                      <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                        No reusable answers yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {!showAnswerEditor ? (
                <Button type="button" onClick={openAddAnswer}>
                  Add answer
                </Button>
              ) : null}
            </div>
          </section>

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
                  {secretSummaries.map((secret) => (
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
                          onClick={() => openEditSecret(secret)}
                        >
                          Edit
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => removeSecret(secret.key)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {secretSummaries.length === 0 && !showSecretEditor ? (
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
              {!showSecretEditor ? (
                <Button type="button" onClick={openAddSecret}>
                  Add secure value
                </Button>
              ) : null}
            </div>
          </section>
          {showEducationEditor ? (
            <ProfileRowModal
              title={educationEditorMode === 'add' ? 'Add education' : 'Edit education'}
              onClose={cancelEducation}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  <span>Education type</span>
                  <select
                    aria-label="Education type"
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                    value={educationDraft.educationType}
                    onChange={(event) =>
                      setEducationDraft((current) => ({
                        ...current,
                        educationType: event.target.value,
                      }))
                    }
                  >
                    {profileEducationTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                {educationDraft.educationType === 'Other' ? (
                  <CompactInput
                    label="Other education type"
                    value={educationDraft.otherEducationType}
                    onChange={(value) =>
                      setEducationDraft((current) => ({
                        ...current,
                        otherEducationType: value,
                      }))
                    }
                  />
                ) : null}
                <CompactInput
                  label="School name"
                  value={educationDraft.school}
                  onChange={(value) =>
                    setEducationDraft((current) => ({ ...current, school: value }))
                  }
                />
                {educationDraft.educationType !== 'High school' ? (
                  <>
                    <CompactInput
                      label="Degree"
                      value={educationDraft.degree}
                      onChange={(value) =>
                        setEducationDraft((current) => ({ ...current, degree: value }))
                      }
                    />
                    <CompactInput
                      label="Major"
                      value={educationDraft.major}
                      onChange={(value) =>
                        setEducationDraft((current) => ({ ...current, major: value }))
                      }
                    />
                  </>
                ) : null}
                <CompactInput
                  label="Graduation date"
                  value={educationDraft.graduationDate}
                  onChange={(value) =>
                    setEducationDraft((current) => ({ ...current, graduationDate: value }))
                  }
                />
                <CompactInput
                  label="Class standing"
                  value={educationDraft.classStanding}
                  onChange={(value) =>
                    setEducationDraft((current) => ({ ...current, classStanding: value }))
                  }
                />
                {educationDraft.educationType === 'High school' ? (
                  <CompactInput
                    label="SAT"
                    value={educationDraft.satScore}
                    onChange={(value) =>
                      setEducationDraft((current) => ({ ...current, satScore: value }))
                    }
                  />
                ) : null}
                <CompactInput
                  label="Transcript path"
                  value={educationDraft.transcriptPath}
                  onChange={(value) =>
                    setEducationDraft((current) => ({ ...current, transcriptPath: value }))
                  }
                />
                <CompactInput
                  label="Education notes"
                  value={educationDraft.notes}
                  onChange={(value) =>
                    setEducationDraft((current) => ({ ...current, notes: value }))
                  }
                />
              </div>
              <InlineEditorActions
                cancelLabel="Cancel education"
                saveLabel="Save education"
                onCancel={cancelEducation}
                onSave={saveEducation}
              />
            </ProfileRowModal>
          ) : null}
          {showAnswerEditor ? (
            <ProfileRowModal
              title={answerEditorMode === 'add' ? 'Add answer' : 'Edit answer'}
              onClose={cancelAnswer}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <CompactInput
                  label="Answer name"
                  value={answerDraft.label}
                  onChange={(value) =>
                    setAnswerDraft((current) => ({ ...current, label: value }))
                  }
                />
                <CompactInput
                  label="Question hint"
                  value={answerDraft.questionPattern}
                  onChange={(value) =>
                    setAnswerDraft((current) => ({ ...current, questionPattern: value }))
                  }
                />
                <CompactInput
                  label="Answer to use"
                  value={answerDraft.answer}
                  onChange={(value) =>
                    setAnswerDraft((current) => ({ ...current, answer: value }))
                  }
                />
                <label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
                  <input
                    aria-label="Available to automation"
                    checked={answerDraft.includeInAgentContext}
                    className="h-4 w-4 accent-primary"
                    type="checkbox"
                    onChange={(event) =>
                      setAnswerDraft((current) => ({
                        ...current,
                        includeInAgentContext: event.target.checked,
                      }))
                    }
                  />
                  <span>Allowed</span>
                </label>
              </div>
              <InlineEditorActions
                cancelLabel="Cancel answer"
                saveLabel="Save answer"
                onCancel={cancelAnswer}
                onSave={saveAnswer}
              />
            </ProfileRowModal>
          ) : null}
          {showSecretEditor ? (
            <ProfileRowModal
              title={secretEditorMode === 'add' ? 'Add secure value' : 'Edit secure value'}
              onClose={cancelSecret}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <CompactInput
                  label="Secure value name"
                  value={secretDraft.label}
                  onChange={(value) =>
                    setSecretDraft((current) => ({ ...current, label: value }))
                  }
                />
                <CompactInput
                  label="Secure value key"
                  value={secretDraft.key}
                  onChange={(value) =>
                    setSecretDraft((current) => ({ ...current, key: value }))
                  }
                />
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  <span>Type</span>
                  <select
                    aria-label="Secure value type"
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                    value={secretDraft.kind}
                    onChange={(event) =>
                      setSecretDraft((current) => ({
                        ...current,
                        kind: event.target.value as ProfileSecretKind,
                      }))
                    }
                  >
                    <option value="password">password</option>
                    <option value="token">token</option>
                    <option value="identity">identity</option>
                    <option value="other">other</option>
                  </select>
                </label>
                <CompactInput
                  label="Secure value"
                  type="password"
                  value={secretDraft.value}
                  onChange={(value) => setSecretDraft((current) => ({ ...current, value }))}
                />
              </div>
              <InlineEditorActions
                cancelLabel="Cancel secure value"
                saveLabel="Save secure value"
                onCancel={cancelSecret}
                onSave={saveSecret}
              />
            </ProfileRowModal>
          ) : null}
        </>
      )}
    </section>
  )
}

function ProfileRowModal({
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

function formatProfileError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return 'Please try again.'
}

function ProfileSection({
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

function SectionHeader({ id, title }: { id: string; title: string }) {
  return (
    <h3 id={id} className="text-sm font-semibold text-foreground">
      {title}
    </h3>
  )
}

function BirthDateSelectRow({
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
        <CompactSelect
          label="Birth year"
          options={birthYearOptions}
          placeholder="Year"
          value={year}
          onChange={onYearChange}
        />
      </div>
    </div>
  )
}

function SettingsSelectInput({
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
  return (
    <label className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center">
      <span>
        <span className="block font-medium">{label}</span>
      </span>
      <select
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select...</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function CompactSelect({
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
  return (
    <select
      aria-label={label}
      className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function InlineEditorActions({
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

function ProfileAnswerRow({
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

function ProfileEducationRow({
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

function BooleanPreferenceControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | null
  onChange: (value: boolean) => void
}) {
  return (
    <div
      aria-label={label}
      className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center"
      role="group"
    >
      <div className="font-medium">{label}</div>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3">
          <input
            aria-label={`${label} Yes`}
            checked={value === true}
            className="h-4 w-4 accent-primary"
            name={label}
            type="radio"
            onChange={() => onChange(true)}
          />
          <span>Yes</span>
        </label>
        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3">
          <input
            aria-label={`${label} No`}
            checked={value === false}
            className="h-4 w-4 accent-primary"
            name={label}
            type="radio"
            onChange={() => onChange(false)}
          />
          <span>No</span>
        </label>
      </div>
    </div>
  )
}

function CompactInput({
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
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <input
        aria-label={label}
        className="h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function nullableInput(value: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

export { ProfileSettingsPanel }
