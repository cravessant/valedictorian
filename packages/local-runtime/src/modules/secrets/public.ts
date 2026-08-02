/**
 * Secrets public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { createConnectorSecretResolver } from './connector-secret-resolver.js'
export {
  createLocalSecretResolutionService,
  rejectUnsupportedLocalSecretResolution,
  toLocalSecretResolutionHttpFailure,
  type LocalSecretResolutionService,
} from './local-secret-resolution.js'
export {
  createWorkspaceSecretScope,
  isSecretCodecAvailable,
  type SecretCodec,
} from '../../protected-secrets.js'
export { createPgliteSecretService } from './secret.composition.js'
export { isReservedIdentitySecretKey } from './secret.identity.js'
export type { SecretService } from './secret.service.js'
