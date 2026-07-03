import { useCallback, useEffect, useState } from 'react'
import type { UpdatesPreloadApi, UpdateState } from '../ipc/updates.preload'

function useAppUpdates(updatesApi: UpdatesPreloadApi) {
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let isMounted = true
    const unsubscribe = updatesApi.onStateChanged((state) => {
      setUpdateState(state)
    })

    void updatesApi.getState().then((state) => {
      if (isMounted) {
        setUpdateState(state)
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [updatesApi])

  const checkForUpdates = useCallback(async () => {
    const state = await updatesApi.check()
    setUpdateState(state)
    return state
  }, [updatesApi])

  return {
    checkForUpdates,
    installUpdate: updatesApi.install,
    updateState,
  }
}

export { useAppUpdates }
