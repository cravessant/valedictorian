import { classifyErrorPresentation } from '../../app/error-presentation'

export type ProfileSaveScope =
  | 'answer'
  | 'date-of-birth'
  | 'education'
  | 'identity'
  | 'profile'
  | 'secret'
  | 'voluntary-self-id'

export type ProfileSaveStatus = {
  kind: 'saving' | 'success' | 'error'
  message: string
  scope: ProfileSaveScope
} | null

export type PendingDestructiveRemoval = {
  confirmLabel: string
  description: string
  kind: 'education' | 'answer' | 'secret'
  targetId: string
  title: string
} | null

export function isModalFormSaveScope(scope: ProfileSaveScope) {
  return scope === 'education' || scope === 'answer' || scope === 'secret'
}

export function isProfileScopeSaving(
  saveStatus: ProfileSaveStatus,
  scope: ProfileSaveScope,
) {
  return saveStatus?.scope === scope && saveStatus.kind === 'saving'
}

export function isProfileWriteDisabled(
  saveStatus: ProfileSaveStatus,
  scope: ProfileSaveScope,
) {
  if (saveStatus?.kind === 'saving') {
    return true
  }
  if (saveStatus?.kind === 'error') {
    return saveStatus.scope !== scope
  }
  return false
}

export function canStartProfileWrite(
  saveStatus: ProfileSaveStatus,
  scope: ProfileSaveScope,
) {
  if (saveStatus?.kind === 'saving') {
    return false
  }
  if (saveStatus?.kind === 'error' && saveStatus.scope !== scope) {
    return false
  }
  return true
}

export function presentProfileClientValidationMessage(
  error: unknown,
  scope: 'answer' | 'education',
) {
  return classifyErrorPresentation(error, {
    operationId: `profile-save:${scope}`,
    scope: 'form',
    trigger: 'client_validation',
  }).message
}

export function splitDateOfBirth(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match
    ? { day: match[3], month: match[2], year: match[1] }
    : { day: '', month: '', year: '' }
}

export function canonicalBirthDate(value: { day: string; month: string; year: string }) {
  if (!value.day && !value.month && !value.year) return null
  return `${value.year}-${value.month}-${value.day}`
}
