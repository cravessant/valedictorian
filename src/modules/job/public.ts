/**
 * Job public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { createPgliteJobDependentQueries } from './job.dependents'
export { createPgliteJobIdentityService } from './job.identity'
export { createPgliteJobReadModel } from './job.read-model'
export { createPgliteJobService, type InitialCompanyAssignmentPort } from './job.service'
