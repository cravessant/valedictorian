/**
 * Capture public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { createCaptureDestinationResolutionService } from './capture.destination-resolution.js'
export { createCaptureFieldOutcomeStore } from './capture.field-outcomes.js'
export { createManualCaptureCompletionService } from './capture.manual-completion.js'
export { createCaptureMaterializationService } from './capture.materialization.js'
export { createPgliteCaptureReadModel } from './capture.read-model.js'
export {
  createCaptureResolutionService,
  createCaptureResolutionV2Service,
} from './capture.resolution.js'
export { seedResolvedCaptureDestination } from './capture.resolution.seed.js'
export {
  createPgliteCaptureService,
  type AcceptCaptureInput,
  type CaptureActor,
  type CaptureFailure,
  type CorrectCaptureInput,
  type JsonValue,
} from './capture.service.js'
export { validateDestinationUrl } from './destination-url-safety.js'
