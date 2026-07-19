import { useEffect, useRef, useState } from 'react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { ownedLoadFailure, presentLoadFailure, type ErrorPresentation } from '../../app/error-presentation'
import { FormFailureAlert } from '@/components/ui/error-primitives'
import { LoadFailureView } from '@/components/ui/load-failure-view'
import { SettingsTextInput } from '../../settings/SettingsTextInput'
import {
  BirthDateSelectRow,
  BooleanPreferenceControl,
  CompactInput,
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
import {
  canStartProfileWrite,
  canonicalBirthDate,
  isProfileScopeSaving,
  isProfileWriteDisabled,
  presentProfileClientValidationMessage,
  splitDateOfBirth,
  type PendingDestructiveRemoval,
  type ProfileSaveScope,
  type ProfileSaveStatus,
} from './profile-settings-status'
import { runOwnedProfileAction } from './profile-settings-run-action'

type ProfileField = keyof Omit<UserProfile, 'answers' | 'education'>

function ProfileSettingsPanel({ profileApi }: { profileApi: ProfilePreloadApi }) {
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile)
  const [birthDateDraft, setBirthDateDraft] = useState({ day: '', month: '', year: '' })
  const [identityConfigured, setIdentityConfigured] = useState(false)
  const [identityDraft, setIdentityDraft] = useState('')
  const [isProfileLoading, setIsProfileLoading] = useState(true)
  const [hasLoadedProfile, setHasLoadedProfile] = useState(false)
  const hasLoadedProfileRef = useRef(false)
  const isMountedRef = useRef(true)
  const profileApiRef = useRef(profileApi)
  const mutationTargetEpochRef = useRef(0)
  const [profileLoadError, setProfileLoadError] = useState<ErrorPresentation | null>(null)
  const [profileReloadKey, setProfileReloadKey] = useState(0)
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
    isMountedRef.current = true
    profileApiRef.current = profileApi
    mutationTargetEpochRef.current += 1
    return () => {
      isMountedRef.current = false
      mutationTargetEpochRef.current += 1
    }
  }, [profileApi])

  useEffect(() => {
    let active = true

    setIsProfileLoading(true)
    setProfileLoadError(null)
    void Promise.all([profileApi.get(), profileApi.identity.status(), profileApi.secrets.list()])
      .then(([savedProfile, savedIdentityStatus, savedSecrets]) => {
        if (!active) {
          return
        }

        setProfile(savedProfile)
        setBirthDateDraft(splitDateOfBirth(savedProfile.dateOfBirth))
        setIdentityConfigured(savedIdentityStatus)
        setSecretSummaries(savedSecrets)
        setHasLoadedProfile(true)
        hasLoadedProfileRef.current = true
        setProfileLoadError(null)
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return
        }
        const hasStaleData = hasLoadedProfileRef.current
        setProfileLoadError(ownedLoadFailure(presentLoadFailure(loadError, {
          hasStaleData,
          scope: 'page',
          trigger: hasStaleData ? 'refresh' : 'load',
        })))
      })
      .finally(() => {
        if (active) {
          setIsProfileLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [profileApi, profileReloadKey])

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
    let nextEducationItem
    try {
      nextEducationItem = normalizeProfileEducationInput({
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
    } catch (error: unknown) {
      ownProfileClientValidation('education', error)
      return
    }
    const nextEducation = [
      ...profile.education.filter((item) => item.id !== nextEducationItem.id),
      nextEducationItem,
    ]

    runProfileAction({
      errorPrefix: 'Could not save education',
      onSuccess: (value) => {
        setProfile(value)
        setEducationDraft(educationDraftDefaults)
        setEducationEditorMode('add')
        setShowEducationEditor(false)
      },
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
    clearModalSaveError('education')
  }

  function openAddEducation() {
    setEducationDraft(educationDraftDefaults)
    setEducationEditorMode('add')
    setShowEducationEditor(true)
    clearModalSaveError('education')
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
    clearModalSaveError('education')
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
    let nextAnswer
    try {
      nextAnswer = normalizeProfileAnswerInput({
        answer: answerDraft.answer,
        category: null,
        includeInAgentContext: answerDraft.includeInAgentContext,
        label: answerDraft.label,
        questionPattern: answerDraft.questionPattern,
      })
    } catch (error: unknown) {
      ownProfileClientValidation('answer', error)
      return
    }
    const nextAnswers = [
      ...profile.answers.filter((answer) => answer.key !== nextAnswer.key),
      nextAnswer,
    ]

    runProfileAction({
      errorPrefix: 'Could not save answer',
      onSuccess: (value) => {
        setProfile(value)
        setAnswerDraft(answerDraftDefaults)
        setAnswerEditorMode('add')
        setShowAnswerEditor(false)
      },
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
    clearModalSaveError('answer')
  }

  function openAddAnswer() {
    setAnswerDraft(answerDraftDefaults)
    setAnswerEditorMode('add')
    setShowAnswerEditor(true)
    clearModalSaveError('answer')
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
    clearModalSaveError('answer')
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
    clearModalSaveError('secret')
  }

  function openAddSecret() {
    setSecretDraft(secretDraftDefaults)
    setSecretEditorMode('add')
    setShowSecretEditor(true)
    clearModalSaveError('secret')
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
    clearModalSaveError('secret')
  }

  function ownProfileClientValidation(scope: 'answer' | 'education', error: unknown) {
    if (!canStartProfileWrite(saveStatus, scope)) {
      return
    }
    setSaveStatus({
      kind: 'error',
      message: presentProfileClientValidationMessage(error, scope),
      scope,
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
    runOwnedProfileAction({
      errorPrefix,
      isMountedRef,
      mutationTargetEpochRef,
      onSuccess,
      pendingMessage,
      pendingRemoval,
      profileApiRef,
      saveStatus,
      scope,
      setRemovalError,
      setSaveStatus,
      successMessage,
      task,
      toast,
    })
  }

  function isSaving(scope: ProfileSaveScope) {
    return isProfileScopeSaving(saveStatus, scope)
  }

  function isWriteDisabled(scope: ProfileSaveScope) {
    return isProfileWriteDisabled(saveStatus, scope)
  }

  function modalFormError(scope: 'answer' | 'education' | 'secret') {
    return saveStatus?.kind === 'error' && saveStatus.scope === scope
      ? saveStatus.message
      : null
  }

  function clearModalSaveError(scope: 'answer' | 'education' | 'secret') {
    setSaveStatus((current) => (
      current?.kind === 'error' && current.scope === scope ? null : current
    ))
  }

  const answerFormError = modalFormError('answer')
  const educationFormError = modalFormError('education')
  const secretFormError = modalFormError('secret')

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

      {isProfileLoading && !hasLoadedProfile ? (
        <div role="status" aria-label="Profile loading">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}

      {profileLoadError ? (
        <LoadFailureView
          failure={profileLoadError}
          onRetry={() => setProfileReloadKey((key) => key + 1)}
        />
      ) : null}

      {hasLoadedProfile || (!isProfileLoading && !profileLoadError) ? (
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
              <Button type="button" disabled={isWriteDisabled('profile')} onClick={saveProfile}>
                {isSaving('profile') ? 'Saving...' : 'Save profile basics'}
              </Button>
            </div>
          </ProfileSection>

          <ProfileEducationSection
            draft={educationDraft}
            editorMode={educationEditorMode}
            education={profile.education}
            formError={educationFormError}
            isEditorOpen={showEducationEditor}
            saveDisabled={isWriteDisabled('education')}
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
              <Button type="button" disabled={isWriteDisabled('profile')} onClick={saveProfile}>
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
                disabled={isWriteDisabled('date-of-birth')}
                onClick={saveDateOfBirth}
              >
                {isSaving('date-of-birth') ? 'Saving...' : 'Save date of birth'}
              </Button>
              <Button
                type="button"
                disabled={isWriteDisabled('identity') || !/^\d{4}$/.test(identityDraft)}
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
                disabled={isWriteDisabled('voluntary-self-id')}
                onClick={saveVoluntarySelfId}
              >
                {isSaving('voluntary-self-id') ? 'Saving...' : 'Save voluntary self-ID'}
              </Button>
            </div>
          </ProfileSection>

          <section className="space-y-3" aria-labelledby="reusable-answers-title">
            <SectionHeader title="Reusable Application Answers" id="reusable-answers-title" />
            <div className="rounded-md border border-border bg-card">
              <Table aria-label="Reusable Application Answers" className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Question hint</TableHead>
                    <TableHead>Answer</TableHead>
                    <TableHead>Available to automation</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.answers.map((answer) => (
                    <ProfileAnswerRow
                      key={answer.key}
                      answer={answer}
                      onEdit={openEditAnswer}
                      onRemove={requestRemoveAnswer}
                    />
                  ))}
                  {profile.answers.length === 0 && !showAnswerEditor ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground" colSpan={5}>
                        No reusable answers yet.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
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
            formError={secretFormError}
            isEditorOpen={showSecretEditor}
            saveDisabled={isWriteDisabled('secret')}
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
              {answerFormError ? <FormFailureAlert message={answerFormError} /> : null}
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
                disabled={isWriteDisabled('answer')}
                saveLabel="Save answer"
                onCancel={cancelAnswer}
                onSave={saveAnswer}
              />
            </ProfileRowModal>
          ) : null}
        </>
      ) : null}

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (isRemoving) {
            return
          }
          if (!open) {
            if (pendingRemoval) {
              clearModalSaveError(pendingRemoval.kind)
            }
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
            <FormFailureAlert message={removalError} title="Removal failed" />
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

export { ProfileSettingsPanel }
