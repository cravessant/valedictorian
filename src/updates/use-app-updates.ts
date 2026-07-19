import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdatesPreloadApi, UpdateState } from '../ipc/updates.preload'

const SAFE_UPDATE_ERROR_MESSAGE = 'Update check failed'

function toSafeUpdateError(currentVersion: string): UpdateState {
  return {
    currentVersion,
    message: SAFE_UPDATE_ERROR_MESSAGE,
    status: 'error',
  }
}

function useAppUpdates(updatesApi: UpdatesPreloadApi) {
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const updateStateRef = useRef(updateState)
  const stateEpochRef = useRef(0)
  const isMountedRef = useRef(true)
  updateStateRef.current = updateState

  useEffect(() => {
    isMountedRef.current = true
    let supersededByEvent = false
    const unsubscribe = updatesApi.onStateChanged((state) => {
      supersededByEvent = true
      stateEpochRef.current += 1
      setUpdateState(state)
    })

    const epochAtStart = stateEpochRef.current
    void updatesApi.getState()
      .then((state) => {
        if (!isMountedRef.current || supersededByEvent || stateEpochRef.current !== epochAtStart) {
          return
        }
        stateEpochRef.current += 1
        setUpdateState(state)
      })
      .catch(() => {
        if (!isMountedRef.current || supersededByEvent || stateEpochRef.current !== epochAtStart) {
          return
        }
        stateEpochRef.current += 1
        setUpdateState(
          toSafeUpdateError(updateStateRef.current?.currentVersion ?? ''),
        )
      })

    return () => {
      isMountedRef.current = false
      // Invalidate in-flight getState/check/install from the previous API target.
      stateEpochRef.current += 1
      unsubscribe()
    }
  }, [updatesApi])

  const checkForUpdates = useCallback(async () => {
    const epochAtStart = stateEpochRef.current
    try {
      const state = await updatesApi.check()
      if (!isMountedRef.current || stateEpochRef.current !== epochAtStart) {
        return updateStateRef.current ?? state
      }
      stateEpochRef.current += 1
      setUpdateState(state)
      return state
    } catch {
      const fallback = toSafeUpdateError(updateStateRef.current?.currentVersion ?? '')
      if (!isMountedRef.current || stateEpochRef.current !== epochAtStart) {
        return updateStateRef.current ?? fallback
      }
      stateEpochRef.current += 1
      setUpdateState(fallback)
      return fallback
    }
  }, [updatesApi])

  const installUpdate = useCallback(async () => {
    const epochAtStart = stateEpochRef.current
    try {
      await updatesApi.install()
    } catch {
      if (!isMountedRef.current || stateEpochRef.current !== epochAtStart) {
        return
      }
      stateEpochRef.current += 1
      setUpdateState(
        toSafeUpdateError(updateStateRef.current?.currentVersion ?? ''),
      )
    }
  }, [updatesApi])

  return {
    checkForUpdates,
    installUpdate,
    updateState,
  }
}

export { useAppUpdates }
