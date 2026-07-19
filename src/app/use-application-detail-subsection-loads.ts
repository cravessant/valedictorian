import { useEffect, useRef, useState } from 'react'
import type { ErrorPresentation } from './error-presentation'
import {
  applicationAttemptsLoadFailure,
  applicationDetailLoadFailure,
  applicationDetailMissingFailure,
  applicationEventsLoadFailure,
  applicationLinksLoadFailure,
} from './app-load-failure'
import {
  emptyApplicationEventsResult,
  emptyApplicationLinksResult,
  emptyAttemptResult,
} from './loaders'
import type { ApplicationDetailSeed } from './types'
import type {
  ApplicationAttemptsListResult,
  ApplicationDetail,
  ApplicationEventsListInput,
  ApplicationEventsListResult,
  ApplicationLinksListInput,
  ApplicationLinksListResult,
} from '../modules/applications/application.types'

export interface ApplicationDetailSubsectionLoaders {
  applicationDetailLoader: (applicationId: string) => Promise<ApplicationDetail | null>
  applicationLinksLoader: (input: ApplicationLinksListInput) => Promise<ApplicationLinksListResult>
  applicationEventsLoader: (input: ApplicationEventsListInput) => Promise<ApplicationEventsListResult>
  attemptLoader: (applicationId: string) => Promise<ApplicationAttemptsListResult>
}

export function useApplicationDetailSubsectionLoads({
  applicationDetailLoader,
  applicationLinksLoader,
  applicationEventsLoader,
  attemptLoader,
}: ApplicationDetailSubsectionLoaders) {
  const [selectedApplication, setSelectedApplication] = useState<ApplicationDetailSeed | null>(null)
  const [applicationDetail, setApplicationDetail] = useState<ApplicationDetail | null>(null)
  const [applicationLinksResult, setApplicationLinksResult] =
    useState<ApplicationLinksListResult>(emptyApplicationLinksResult)
  const [applicationEventsResult, setApplicationEventsResult] =
    useState<ApplicationEventsListResult>(emptyApplicationEventsResult)
  const [isApplicationDetailLoading, setIsApplicationDetailLoading] = useState(false)
  const [isApplicationLinksLoading, setIsApplicationLinksLoading] = useState(false)
  const [isApplicationEventsLoading, setIsApplicationEventsLoading] = useState(false)
  const [applicationDetailError, setApplicationDetailError] =
    useState<ErrorPresentation | null>(null)
  const [applicationLinksError, setApplicationLinksError] =
    useState<ErrorPresentation | null>(null)
  const [applicationEventsError, setApplicationEventsError] =
    useState<ErrorPresentation | null>(null)
  const [applicationDetailReloadKey, setApplicationDetailReloadKey] = useState(0)
  const [attemptResult, setAttemptResult] =
    useState<ApplicationAttemptsListResult>(emptyAttemptResult)
  const [isAttemptLoading, setIsAttemptLoading] = useState(false)
  const [attemptError, setAttemptError] = useState<ErrorPresentation | null>(null)
  const hasApplicationDetailRef = useRef(false)
  const hasApplicationLinksRef = useRef(false)
  const hasApplicationEventsRef = useRef(false)
  const hasApplicationAttemptsRef = useRef(false)
  const lastOpenedApplicationIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true

    setIsAttemptLoading(true)
    attemptLoader(selectedApplication.id)
      .then((nextResult) => {
        if (isMounted) {
          setAttemptResult(nextResult)
          hasApplicationAttemptsRef.current = true
          setAttemptError(null)
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setAttemptError(applicationAttemptsLoadFailure(
            loadError,
            hasApplicationAttemptsRef.current,
          ))
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsAttemptLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationDetailReloadKey, attemptLoader, selectedApplication])

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true
    const applicationId = selectedApplication.id

    setIsApplicationDetailLoading(true)
    applicationDetailLoader(applicationId)
      .then((nextDetail) => {
        if (isMounted) {
          setApplicationDetail(nextDetail)
          if (nextDetail) {
            hasApplicationDetailRef.current = true
            setApplicationDetailError(null)
          } else {
            setApplicationDetailError(applicationDetailMissingFailure())
          }
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setApplicationDetailError(applicationDetailLoadFailure(
            loadError,
            hasApplicationDetailRef.current,
          ))
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsApplicationDetailLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationDetailLoader, applicationDetailReloadKey, selectedApplication])

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true

    setIsApplicationLinksLoading(true)
    applicationLinksLoader({ applicationId: selectedApplication.id })
      .then((nextResult) => {
        if (isMounted) {
          setApplicationLinksResult(nextResult)
          hasApplicationLinksRef.current = true
          setApplicationLinksError(null)
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setApplicationLinksError(applicationLinksLoadFailure(
            loadError,
            hasApplicationLinksRef.current,
          ))
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsApplicationLinksLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationDetailReloadKey, applicationLinksLoader, selectedApplication])

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true

    setIsApplicationEventsLoading(true)
    applicationEventsLoader({ applicationId: selectedApplication.id })
      .then((nextResult) => {
        if (isMounted) {
          setApplicationEventsResult(nextResult)
          hasApplicationEventsRef.current = true
          setApplicationEventsError(null)
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setApplicationEventsError(applicationEventsLoadFailure(
            loadError,
            hasApplicationEventsRef.current,
          ))
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsApplicationEventsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationDetailReloadKey, applicationEventsLoader, selectedApplication])

  function reloadApplicationDetail() {
    setApplicationDetailReloadKey((current) => current + 1)
  }

  function openApplicationDetail(application: ApplicationDetailSeed) {
    const switching = lastOpenedApplicationIdRef.current !== application.id
    if (switching) {
      setApplicationDetail(null)
      setApplicationLinksResult(emptyApplicationLinksResult)
      setApplicationEventsResult(emptyApplicationEventsResult)
      setAttemptResult(emptyAttemptResult)
      hasApplicationDetailRef.current = false
      hasApplicationLinksRef.current = false
      hasApplicationEventsRef.current = false
      hasApplicationAttemptsRef.current = false
    }
    lastOpenedApplicationIdRef.current = application.id
    setSelectedApplication(application)
    setApplicationDetailError(null)
    setApplicationLinksError(null)
    setApplicationEventsError(null)
    setAttemptError(null)
  }

  return {
    attemptError,
    attemptResult,
    applicationDetail,
    applicationDetailError,
    applicationEventsError,
    applicationEventsResult,
    applicationLinksError,
    applicationLinksResult,
    isApplicationDetailLoading,
    isApplicationEventsLoading,
    isApplicationLinksLoading,
    isAttemptLoading,
    openApplicationDetail,
    reloadApplicationDetail,
    selectedApplication,
    setSelectedApplication,
  }
}
