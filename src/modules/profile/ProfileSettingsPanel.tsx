import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { typography } from '@/components/ui/typography'
import {
  defaultUserProfile,
  normalizeProfileEducationInput,
  normalizeProfileAnswerInput,
  profileEducationTypeOptions,
  type ProfileAnswer,
  type ProfileEducation,
  type ProfileSecretSummary,
  type ProfileUpdateInput,
  type UserProfile,
} from 'sparxie'
import type { ProfilePreloadApi } from '../../ipc/profile.preload'
import { SettingsTextInput } from '../../settings/SettingsTextInput'
import {
  BirthDateSelectRow,
  BooleanPreferenceControl,
  CompactInput,
  formatProfileError,
  InlineEditorActions,
  ProfileAnswerRow,
  ProfileRowModal,
  ProfileSection,
  SectionHeader,
  SettingsSelectInput,
  genderOptions,
  raceEthnicityOptions,
  veteranStatusOptions,
  yesNoSelfIdOptions,
  answerDraftDefaults,
  educationDraftDefaults,
  secretDraftDefaults,
} from './ProfileSettingsControls'
import { ProfileEducationSection } from './ProfileEducationSection'
import { ProfileSecureValuesSection } from './ProfileSecureValuesSection'

type ProfileField = keyof Omit<UserProfile, 'answers' | 'education'>
type ProfileSaveScope =
  | 'answer'
  | 'date-of-birth'
  | 'education'
  | 'identity'
  | 'profile'
  | 'secret'
  | 'voluntary-self-id'
type ProfileSaveStatus = {
  kind: 'saving' | 'success' | 'error'
  message: string
  scope: ProfileSaveScope
} | null
type PendingDestructiveRemoval = {
  confirmLabel: string
  description: string
  kind: 'education' | 'answer' | 'secret'
  targetId: string
  title: string
} | null

function ProfileSettingsPanel({ profileApi }: { profileApi: ProfilePreloadApi }) {
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile)
  const [birthDateDraft, setBirthDateDraft] = useState({ day: '', month: '', year: '' })
  const [identityConfigured, setIdentityConfigured] = useState(false)
  const [identityDraft, setIdentityDraft] = useState('')
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
  const [pendingRemoval, setPendingRemoval] = useState<PendingDestructiveRemoval>(null)
  const [removalError, setRemovalError] = useState<string | null>(null)
  const { toast } = useToast()
  const isRemoving =
    saveStatus?.kind === 'saving' &&
    pendingRemoval !== null &&
    ((pendingRemoval.kind === 'education' && saveStatus.scope === 'education') ||
      (pendingRemoval.kind === 'answer' && saveStatus.scope === 'answer') ||
      (pendingRemoval.kind === 'secret' && saveStatus.scope === 'secret'))

  useEffect(() => {
    let active = true

    void Promise.all([profileApi.get(), profileApi.identity.status(), profileApi.secrets.list()])
      .then(([savedProfile, savedIdentityStatus, savedSecrets]) => {
        if (!active) {
          return
        }

        setProfile(savedProfile)
        setBirthDateDraft(splitDateOfBirth(savedProfile.dateOfBirth))
        setIdentityConfigured(savedIdentityStatus)
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
      'dateOfBirth',
      'disabilityStatus',
      'email',
      'fullName',
      'gender',
      'githubUrl',
      'hispanicLatino',
      'language',
      'linkedinUrl',
      'phone',
      'phoneDeviceType',
      'portfolioUrl',
      'preferredName',
      'raceEthnicity',
      'region',
      'relocationNotes',
      'requireSponsorship',
      'requireSponsorshipFuture',
      'travelNotes',
      'veteranStatus',
      'willingToRelocate',
      'willingToTravel',
      'workAuthorization',
    ]

    for (const field of fields) {
      const value = profile[field]
      Object.assign(patch, {
        [field]: value === '' || value === undefined ? null : value,
      })
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

  function requestRemoveEducation(id: string) {
    const education = profile.education.find((item) => item.id === id)
    if (!education) {
      return
    }

    setRemovalError(null)
    setPendingRemoval({
      confirmLabel: 'Remove education',
      description: `This permanently removes ${education.school} from your profile.`,
      kind: 'education',
      targetId: id,
      title: `Remove education ${education.school}?`,
    })
  }

  function requestRemoveAnswer(key: string) {
    const answer = profile.answers.find((item) => item.key === key)
    if (!answer) {
      return
    }

    setRemovalError(null)
    setPendingRemoval({
      confirmLabel: 'Remove answer',
      description: `This permanently removes “${answer.label}” from reusable answers.`,
      kind: 'answer',
      targetId: key,
      title: `Remove answer ${answer.label}?`,
    })
  }

  function requestRemoveSecret(key: string) {
    const secret = secretSummaries.find((item) => item.key === key)
    if (!secret) {
      return
    }

    setRemovalError(null)
    setPendingRemoval({
      confirmLabel: 'Remove secure value',
      description: `This permanently deletes “${secret.label}” from local secure storage.`,
      kind: 'secret',
      targetId: key,
      title: `Remove secure value ${secret.label}?`,
    })
  }

  function removeEducation(id: string) {
    const nextEducation = profile.education.filter((item) => item.id !== id)

    setProfile((current) => ({ ...current, education: nextEducation }))
    runProfileAction({
      errorPrefix: 'Could not remove education',
      onSuccess: (value) => {
        setProfile(value)
        setPendingRemoval(null)
        setRemovalError(null)
      },
      pendingMessage: 'Removing education...',
      scope: 'education',
      successMessage: 'Education removed.',
      task: () => profileApi.update(buildProfilePatch(profile.answers, nextEducation)),
    })
  }

  function removeAnswer(key: string) {
    const nextAnswers = profile.answers.filter((answer) => answer.key !== key)

    setProfile((current) => ({ ...current, answers: nextAnswers }))
    runProfileAction({
      errorPrefix: 'Could not remove answer',
      onSuccess: (value) => {
        setProfile(value)
        setPendingRemoval(null)
        setRemovalError(null)
      },
      pendingMessage: 'Removing answer...',
      scope: 'answer',
      successMessage: 'Answer removed.',
      task: () => profileApi.update(buildProfilePatch(nextAnswers)),
    })
  }

  function removeSecret(key: string) {
    runProfileAction({
      errorPrefix: 'Could not remove secure value',
      onSuccess: () => {
        setSecretSummaries((current) => current.filter((secret) => secret.key !== key))
        setPendingRemoval(null)
        setRemovalError(null)
      },
      pendingMessage: 'Removing secure value...',
      scope: 'secret',
      successMessage: 'Secure value removed.',
      task: () => profileApi.secrets.delete(key),
    })
  }

  function confirmPendingRemoval() {
    if (!pendingRemoval) {
      return
    }

    setRemovalError(null)
    if (pendingRemoval.kind === 'education') {
      removeEducation(pendingRemoval.targetId)
      return
    }
    if (pendingRemoval.kind === 'answer') {
      removeAnswer(pendingRemoval.targetId)
      return
    }
    removeSecret(pendingRemoval.targetId)
  }

  function saveDateOfBirth() {
    runProfileAction({
      errorPrefix: 'Could not save date of birth',
      onSuccess: (saved) => setProfile((current) => ({
        ...current,
        dateOfBirth: saved.dateOfBirth,
      })),
      pendingMessage: 'Saving date of birth...',
      scope: 'date-of-birth',
      successMessage: 'Date of birth saved.',
      task: () => profileApi.update({ dateOfBirth: canonicalBirthDate(birthDateDraft) }),
    })
  }

  function saveIdentity() {
    runProfileAction({
      errorPrefix: 'Could not save SSN last four',
      onSuccess: () => {
        setIdentityConfigured(true)
        setIdentityDraft('')
      },
      pendingMessage: 'Saving SSN last four...',
      scope: 'identity',
      successMessage: 'SSN last four saved.',
      task: () => profileApi.identity.set(identityDraft),
    })
  }

  function saveVoluntarySelfId() {
    runProfileAction({
      errorPrefix: 'Could not save voluntary self-ID',
      onSuccess: (saved) => setProfile((current) => ({
        ...current,
        disabilityStatus: saved.disabilityStatus,
        gender: saved.gender,
        hispanicLatino: saved.hispanicLatino,
        raceEthnicity: saved.raceEthnicity,
        veteranStatus: saved.veteranStatus,
      })),
      pendingMessage: 'Saving voluntary self-ID...',
      scope: 'voluntary-self-id',
      successMessage: 'Voluntary self-ID saved.',
      task: () => profileApi.update({
        disabilityStatus: profile.disabilityStatus || null,
        gender: profile.gender || null,
        hispanicLatino: profile.hispanicLatino || null,
        raceEthnicity: profile.raceEthnicity || null,
        veteranStatus: profile.veteranStatus || null,
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
        if (pendingRemoval) {
          setRemovalError(message)
        }
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
        <h2 id="profile-settings-title" className={typography.sectionTitle}>
          Profile
        </h2>
        <p className={typography.sectionDescription}>
          Store application-ready facts, reusable answers, and local-only secure details.
        </p>
      </div>

      {isProfileLoading ? (
        <div role="status" aria-label="Profile loading">
          <Skeleton className="h-32 w-full" />
        </div>
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

          <ProfileEducationSection
            draft={educationDraft}
            editorMode={educationEditorMode}
            education={profile.education}
            isEditorOpen={showEducationEditor}
            onAdd={openAddEducation}
            onCancel={cancelEducation}
            onDraftChange={setEducationDraft}
            onEdit={openEditEducation}
            onRemove={requestRemoveEducation}
            onSave={saveEducation}
          />

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
              day={birthDateDraft.day}
              month={birthDateDraft.month}
              year={birthDateDraft.year}
              onDayChange={(day) => setBirthDateDraft((current) => ({ ...current, day }))}
              onMonthChange={(month) => setBirthDateDraft((current) => ({ ...current, month }))}
              onYearChange={(year) => setBirthDateDraft((current) => ({ ...current, year }))}
            />
            <SettingsTextInput
              label="Last 4 SSN"
              type="password"
              value={identityDraft}
              onChange={setIdentityDraft}
            />
            <div className="px-4 py-3 text-sm text-muted-foreground">
              SSN last four: {identityConfigured ? 'Configured' : 'Not configured'}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
              <Button
                type="button"
                disabled={isSaving('date-of-birth')}
                onClick={saveDateOfBirth}
              >
                {isSaving('date-of-birth') ? 'Saving...' : 'Save date of birth'}
              </Button>
              <Button
                type="button"
                disabled={isSaving('identity') || !/^\d{4}$/.test(identityDraft)}
                onClick={saveIdentity}
              >
                {isSaving('identity') ? 'Saving...' : 'Set or replace SSN last four'}
              </Button>
            </div>
          </ProfileSection>

          <ProfileSection title="Voluntary Self-ID">
            <SettingsSelectInput
              label="Race/ethnicity"
              options={raceEthnicityOptions}
              value={profile.raceEthnicity ?? ''}
              onChange={(value) => updateProfileField('raceEthnicity', value)}
            />
            <SettingsSelectInput
              label="Gender"
              options={genderOptions}
              value={profile.gender ?? ''}
              onChange={(value) => updateProfileField('gender', value)}
            />
            <SettingsSelectInput
              label="Disability status"
              options={yesNoSelfIdOptions}
              value={profile.disabilityStatus ?? ''}
              onChange={(value) => updateProfileField('disabilityStatus', value)}
            />
            <SettingsSelectInput
              label="Veteran status"
              options={veteranStatusOptions}
              value={profile.veteranStatus ?? ''}
              onChange={(value) => updateProfileField('veteranStatus', value)}
            />
            <SettingsSelectInput
              label="Hispanic/Latino"
              options={yesNoSelfIdOptions}
              value={profile.hispanicLatino ?? ''}
              onChange={(value) => updateProfileField('hispanicLatino', value)}
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
                      onRemove={requestRemoveAnswer}
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

          <ProfileSecureValuesSection
            draft={secretDraft}
            editorMode={secretEditorMode}
            isEditorOpen={showSecretEditor}
            onAdd={openAddSecret}
            onCancel={cancelSecret}
            onDraftChange={setSecretDraft}
            onEdit={openEditSecret}
            onRemove={requestRemoveSecret}
            onSave={saveSecret}
            secrets={secretSummaries}
          />
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
                <Label className="flex min-h-9 items-center gap-2 text-sm text-foreground" htmlFor="profile-answer-agent-context">
                  <Checkbox
                    aria-label="Available to automation"
                    checked={answerDraft.includeInAgentContext}
                    id="profile-answer-agent-context"
                    onCheckedChange={(value) =>
                      setAnswerDraft((current) => ({
                        ...current,
                        includeInAgentContext: value === true,
                      }))
                    }
                  />
                  <span>Allowed</span>
                </Label>
              </div>
              <InlineEditorActions
                cancelLabel="Cancel answer"
                saveLabel="Save answer"
                onCancel={cancelAnswer}
                onSave={saveAnswer}
              />
            </ProfileRowModal>
          ) : null}
        </>
      )}

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (isRemoving) {
            return
          }
          if (!open) {
            setPendingRemoval(null)
            setRemovalError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingRemoval?.title ?? 'Remove item?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoval?.description ?? 'This permanently removes the selected item.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removalError ? (
            <p className="text-sm text-destructive" role="alert">
              {removalError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={isRemoving}
              onClick={confirmPendingRemoval}
            >
              {isRemoving ? 'Removing...' : (pendingRemoval?.confirmLabel ?? 'Remove')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function splitDateOfBirth(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match
    ? { day: match[3], month: match[2], year: match[1] }
    : { day: '', month: '', year: '' }
}

function canonicalBirthDate(value: { day: string; month: string; year: string }) {
  if (!value.day && !value.month && !value.year) return null
  return `${value.year}-${value.month}-${value.day}`
}

export { ProfileSettingsPanel }
