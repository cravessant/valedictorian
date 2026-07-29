/**
 * Secrets public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { createConnectorSecretResolver } from './connector-secret-resolver'
export {
  createLocalSecretResolutionService,
  rejectUnsupportedLocalSecretResolution,
  toLocalSecretResolutionHttpFailure,
  type LocalSecretResolutionService,
} from './local-secret-resolution'
export { isSecretCodecAvailable, type SecretCodec } from './secret.codec'
export { createPgliteSecretService } from './secret.composition'
export { isReservedIdentitySecretKey } from './secret.identity'
export { createWorkspaceSecretScope } from './secret.scope'
export type { SecretService } from './secret.service'
