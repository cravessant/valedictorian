import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ToastInput } from '@/components/ui/use-toast'
import { classifyErrorPresentation } from '../../app/error-presentation'
import {
  canStartProfileWrite,
  isModalFormSaveScope,
  type PendingDestructiveRemoval,
  type ProfileSaveScope,
  type ProfileSaveStatus,
} from './profile-settings-status'
import type { ProfilePreloadApi } from '../../ipc/profile.preload'

export function runOwnedProfileAction<T>({
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
}: {
  errorPrefix: string
  isMountedRef: MutableRefObject<boolean>
  mutationTargetEpochRef: MutableRefObject<number>
  onSuccess: (value: T) => void
  pendingMessage: string
  pendingRemoval: PendingDestructiveRemoval
  profileApiRef: MutableRefObject<ProfilePreloadApi>
  saveStatus: ProfileSaveStatus
  scope: ProfileSaveScope
  setRemovalError: Dispatch<SetStateAction<string | null>>
  setSaveStatus: Dispatch<SetStateAction<ProfileSaveStatus>>
  successMessage: string
  task: () => Promise<T>
  toast: (input: ToastInput) => void
}) {
  if (!canStartProfileWrite(saveStatus, scope)) {
    return
  }
  const epochAtStart = mutationTargetEpochRef.current
  const apiAtStart = profileApiRef.current
  setSaveStatus({ kind: 'saving', message: pendingMessage, scope })
  void task()
    .then((value) => {
      if (
        !isMountedRef.current
        || mutationTargetEpochRef.current !== epochAtStart
        || profileApiRef.current !== apiAtStart
      ) {
        return
      }
      onSuccess(value)
      setSaveStatus({ kind: 'success', message: successMessage, scope })
      toast({
        title: successMessage,
        variant: 'success',
      })
    })
    .catch((error: unknown) => {
      if (
        !isMountedRef.current
        || mutationTargetEpochRef.current !== epochAtStart
        || profileApiRef.current !== apiAtStart
      ) {
        return
      }
      const ownsFormSurface = pendingRemoval !== null || isModalFormSaveScope(scope)
      const presentation = classifyErrorPresentation(error, {
        operationId: pendingRemoval
          ? `profile-remove:${pendingRemoval.kind}:${pendingRemoval.targetId}`
          : `profile-save:${scope}`,
        scope: ownsFormSurface ? 'form' : 'page',
        trigger: ownsFormSurface ? 'save' : 'action',
      })
      const message = `${errorPrefix}. ${presentation.message}`
      setSaveStatus({
        kind: 'error',
        message,
        scope,
      })
      if (pendingRemoval) {
        setRemovalError(message)
        return
      }
      if (isModalFormSaveScope(scope)) {
        return
      }
      toast({
        description: message,
        operationId: presentation.operationId,
        title: 'Profile update failed',
        variant: 'destructive',
      })
    })
}
