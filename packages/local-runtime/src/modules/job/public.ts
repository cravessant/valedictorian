/**
 * Job public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { createPgliteJobDependentQueries } from './job.dependents.js'
export { createPgliteJobIdentityService } from './job.identity.js'
export { createPgliteJobReadModel } from './job.read-model.js'
export { createPgliteJobService, type InitialCompanyAssignmentPort } from './job.service.js'
export { jobFactsTiming } from './job.timing.js'
