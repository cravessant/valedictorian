/**
 * Company public surface (issue #327).
 *
 * The contracts production server and runtime composition consume. Module
 * internals stay private: nothing here re-exports a table, a persistence DTO, or
 * an API no consumer has.
 */
export {
  createInitialCompanyAssignment,
  createPgliteCompanyAssignmentService,
} from './company.assignment.service.js'
export { createPgliteCompanyService } from './company.service.js'
