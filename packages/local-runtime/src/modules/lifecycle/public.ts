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
} from './application.orchestration.js'
export { createPgliteJobPromotion } from './capture-to-job.promotion.js'
export { createPgliteJobToOpportunityPromotion } from './job-to-opportunity.promotion.js'
export { createLifecycleJobOrchestration, type JobWriteFailure } from './job.orchestration.js'
export { toContractActor } from './lifecycle-audit.dto.js'
export { LifecycleHttpError } from './lifecycle-http.error.js'
export {
  classifyMutationFailure,
  toBlockedMutationResult,
  toSucceededMutationResult,
  type MutationBlocked,
} from './mutation.dto.js'
export { createPgliteOpportunityToApplicationPromotion } from './opportunity-to-application.promotion.js'
export {
  classifyPromotionFailure,
  toBlockedPromotionResult,
  toPromotedResult,
} from './promotion.dto.js'
export {
  classifyRemovalFailure,
  toBlockedRemovalResult,
  toBlockedRestoreResult,
  toRemovedResult,
  toRestoredResult,
} from './removal.dto.js'
export {
  createLifecycleRemovalOrchestration,
  type LifecycleActor,
  type RemoveLifecycleResult,
  type RestoreLifecycleResult,
} from './removal.orchestration.js'
