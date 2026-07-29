/**
 * Capture public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { createCaptureDestinationResolutionService } from './capture.destination-resolution'
export { createCaptureFieldOutcomeStore } from './capture.field-outcomes'
export { createManualCaptureCompletionService } from './capture.manual-completion'
export { createCaptureMaterializationService } from './capture.materialization'
export { createPgliteCaptureReadModel } from './capture.read-model'
export {
  createCaptureResolutionService,
  createCaptureResolutionV2Service,
} from './capture.resolution'
export { seedResolvedCaptureDestination } from './capture.resolution.seed'
export {
  createPgliteCaptureService,
  type AcceptCaptureInput,
  type CaptureActor,
  type CaptureFailure,
  type CorrectCaptureInput,
  type JsonValue,
} from './capture.service'
export { validateDestinationUrl } from './destination-url-safety'
