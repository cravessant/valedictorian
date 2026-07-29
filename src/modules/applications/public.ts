/**
 * Applications public surface (issue #327).
 *
 * The contracts production server and runtime composition consume, including the
 * owner-provided reads of Application state. Module internals stay private:
 * nothing here re-exports a table, a persistence DTO, or an API no consumer has.
 */
export { createPgliteApplicationAggregateService } from './application.aggregate.service'
export { createPgliteApplicationDependentQueries } from './application.dependents'
export { createPgliteApplicationReadModel } from './application.read-model'
