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
} from './capture-destination-work.js'
export {
  createNormalizationExecutor,
  createNormalizationWorkRepository,
  enqueueNormalizationWork,
  reconcileNormalizationWork,
} from './normalization-work.js'
export type { LocalScheduledWorkSource } from './scheduled-work.port.js'
export { retireProviderUrlResolutionWork } from './provider-url-resolution-retirement.js'
export { createScheduledWorkSource } from './scheduled-work.source.js'
