/**
 * Scheduling public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export {
  createCaptureDestinationWorkExecutor,
  createCaptureDestinationWorkRepository,
  enqueueCaptureDestinationWork,
  reconcileCaptureDestinationWork,
} from './capture-destination-work'
export {
  createNormalizationExecutor,
  createNormalizationWorkRepository,
  enqueueNormalizationWork,
  reconcileNormalizationWork,
} from './normalization-work'
export type { LocalScheduledWorkSource } from './scheduled-work.port'
export { retireProviderUrlResolutionWork } from './provider-url-resolution-retirement'
export { createScheduledWorkSource } from './scheduled-work.source'
