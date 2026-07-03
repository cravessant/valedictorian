import { useEffect, useState } from 'react'
import type {
  WindowChromePreloadApi,
  WindowChromeState,
} from '../ipc/window-chrome.preload'

const defaultWindowChromeState: WindowChromeState = {
  isFullScreen: false,
}

function useWindowChromeState(
  chromeApi = readWindowChromeApi(),
): WindowChromeState {
  const [state, setState] = useState<WindowChromeState>(defaultWindowChromeState)

  useEffect(() => {
    if (!chromeApi) {
      return undefined
    }

    let isMounted = true

    void chromeApi.getState().then((nextState) => {
      if (isMounted) {
        setState(nextState)
      }
    }).catch(() => undefined)

    const unsubscribe = chromeApi.onStateChanged((nextState) => {
      if (isMounted) {
        setState(nextState)
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [chromeApi])

  return state
}

function readWindowChromeApi(): WindowChromePreloadApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.valedictorianWindowChrome
}

export { useWindowChromeState }
