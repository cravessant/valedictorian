/**
 * Lifecycle public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export {
  createLifecycleApplicationOrchestration,
  type ApplicationWriteFailure,
} from './application.orchestration'
export { createPgliteJobPromotion } from './capture-to-job.promotion'
export { createPgliteJobToOpportunityPromotion } from './job-to-opportunity.promotion'
export { createLifecycleJobOrchestration, type JobWriteFailure } from './job.orchestration'
export { toContractActor } from './lifecycle-audit.dto'
export { LifecycleHttpError } from './lifecycle-http.error'
export {
  classifyMutationFailure,
  toBlockedMutationResult,
  toSucceededMutationResult,
  type MutationBlocked,
} from './mutation.dto'
export { createPgliteOpportunityToApplicationPromotion } from './opportunity-to-application.promotion'
export {
  classifyPromotionFailure,
  toBlockedPromotionResult,
  toPromotedResult,
} from './promotion.dto'
export {
  classifyRemovalFailure,
  toBlockedRemovalResult,
  toBlockedRestoreResult,
  toRemovedResult,
  toRestoredResult,
} from './removal.dto'
export {
  createLifecycleRemovalOrchestration,
  type LifecycleActor,
  type RemoveLifecycleResult,
  type RestoreLifecycleResult,
} from './removal.orchestration'
