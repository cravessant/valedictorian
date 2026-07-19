import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { actionFailureToastInput } from './error-presentation'
import type { ApplicationDetail, ApplicationListItem } from '../modules/applications/application.types'
import type { ApplicationDetailSeed } from './types'
import type {
  PromoteSourcingFindingInput,
  SourcingFinding,
  SourcingFindingsListResult,
} from 'sparxie'

export function useOpportunityAndActionQueueMutations({
  applicationDetailLoader,
  isAppMountedRef,
  promoteSourcingFinding,
  reloadActionQueueIfLoaded,
  reloadApplications,
  setEditingApplication,
  setSourcingResult,
}: {
  applicationDetailLoader: (applicationId: string) => Promise<ApplicationDetail | null>
  isAppMountedRef: { current: boolean }
  promoteSourcingFinding: (input: PromoteSourcingFindingInput) => Promise<SourcingFinding>
  reloadActionQueueIfLoaded: () => void
  reloadApplications: () => void
  setEditingApplication: Dispatch<SetStateAction<ApplicationListItem | null>>
  setSourcingResult: Dispatch<SetStateAction<SourcingFindingsListResult>>
}) {
  const { toast } = useToast()
  const [promotingFindingIds, setPromotingFindingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const promotingFindingIdsRef = useRef(promotingFindingIds)
  promotingFindingIdsRef.current = promotingFindingIds
  const applicationDetailLoaderRef = useRef(applicationDetailLoader)
  applicationDetailLoaderRef.current = applicationDetailLoader
  const promoteSourcingFindingRef = useRef(promoteSourcingFinding)
  const actionQueueDetailRequestRef = useRef(0)

  // Invalidate the API target synchronously at render so a settlement that
  // races between commit and effects already sees the replacement as stale.
  if (promoteSourcingFindingRef.current !== promoteSourcingFinding) {
    promoteSourcingFindingRef.current = promoteSourcingFinding
  }

  useEffect(() => {
    if (promotingFindingIdsRef.current.size === 0) {
      return
    }
    promotingFindingIdsRef.current = new Set()
    setPromotingFindingIds(new Set())
  }, [promoteSourcingFinding])

  function promoteFinding(findingId: string) {
    if (promotingFindingIdsRef.current.has(findingId)) {
      return
    }
    const promoteApi = promoteSourcingFindingRef.current
    const nextPending = new Set(promotingFindingIdsRef.current).add(findingId)
    promotingFindingIdsRef.current = nextPending
    setPromotingFindingIds(nextPending)

    void promoteApi({ findingId })
      .then((promotedFinding) => {
        if (
          !isAppMountedRef.current
          || promoteSourcingFindingRef.current !== promoteApi
        ) {
          return
        }
        setSourcingResult((current) => ({
          ...current,
          items: current.items.map((item) =>
            item.id === promotedFinding.id ? promotedFinding : item,
          ),
        }))
        reloadApplications()
        reloadActionQueueIfLoaded()
      })
      .catch((error: unknown) => {
        if (
          !isAppMountedRef.current
          || promoteSourcingFindingRef.current !== promoteApi
        ) {
          return
        }
        toast(actionFailureToastInput(error, {
          fallbackMessage: 'Opportunity could not be promoted.',
          operationId: `promote:${findingId}`,
        }))
      })
      .finally(() => {
        if (
          !isAppMountedRef.current
          || promoteSourcingFindingRef.current !== promoteApi
        ) {
          return
        }
        setPromotingFindingIds((current) => {
          if (!current.has(findingId)) {
            return current
          }
          const next = new Set(current)
          next.delete(findingId)
          promotingFindingIdsRef.current = next
          return next
        })
      })
  }

  function openActionQueueApplicationEditor(application: ApplicationDetailSeed) {
    const requestId = actionQueueDetailRequestRef.current + 1
    actionQueueDetailRequestRef.current = requestId
    const loader = applicationDetailLoaderRef.current
    void loader(application.id)
      .then((detail) => {
        if (
          !isAppMountedRef.current
          || requestId !== actionQueueDetailRequestRef.current
          || applicationDetailLoaderRef.current !== loader
        ) {
          return
        }
        if (detail) {
          setEditingApplication(detail)
          return
        }
        toast({
          description: 'Application detail could not be found.',
          operationId: `action-queue-detail:${application.id}`,
          title: 'Action failed',
          variant: 'destructive',
        })
      })
      .catch((error: unknown) => {
        if (
          !isAppMountedRef.current
          || requestId !== actionQueueDetailRequestRef.current
          || applicationDetailLoaderRef.current !== loader
        ) {
          return
        }
        toast(actionFailureToastInput(error, {
          fallbackMessage: 'Application detail could not be loaded.',
          operationId: `action-queue-detail:${application.id}`,
        }))
      })
  }

  return {
    openActionQueueApplicationEditor,
    promoteFinding,
    promotingFindingIds,
  }
}
