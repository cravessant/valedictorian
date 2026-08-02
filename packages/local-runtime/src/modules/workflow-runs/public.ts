/**
 * Workflow-runs public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export { createPgliteWorkflowRunRepository } from './workflow-run.repository.js'
