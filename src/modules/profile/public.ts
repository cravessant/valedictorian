/**
 * Profile public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export {
  createJsonProfileService,
  prepareWorkspaceProfileCapabilities,
  type PreparedWorkspaceProfileCapabilities,
} from './profile.composition'
export type { ProfileService } from './profile.service'
