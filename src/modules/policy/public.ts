/**
 * Policy public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { policyConfigPatchViolation } from './policy.patch'
export { createPglitePolicyRepository } from './policy.repository'
