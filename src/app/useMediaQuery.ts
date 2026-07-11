import { useEffect, useState } from 'react'

export function getMediaQueryMatches(query: string) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

export function isDocumentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => getMediaQueryMatches(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQueryList = window.matchMedia(query)
    const updateMatches = (event: MediaQueryListEvent) => setMatches(event.matches)

    setMatches(mediaQueryList.matches)
    mediaQueryList.addEventListener('change', updateMatches)

    return () => mediaQueryList.removeEventListener('change', updateMatches)
  }, [query])

  return matches
}
