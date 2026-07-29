/**
 * Compile-time proof that a source-execution owner operation only accepts the
 * caller's open transaction (issue #491). Test files are excluded from
 * `tsconfig.json`, so these assertions live in typechecked source: each constant only
 * compiles if the stated assignability holds, and `pnpm typecheck` fails if the unit
 * of work is ever widened back to something a root database satisfies.
 */
import type { PgliteDatabase } from '../../db/pglite'
import type {
  SourceExecutionTransaction,
  SourceExecutionUnitOfWork,
} from './source-execution.persistence'

type Assignable<From, To> = [From] extends [To] ? true : false
type HasKey<Of, Key extends string> = Key extends keyof Of ? true : false

/** A root database has no `rollback`, so it cannot stand in for a transaction. */
export const rootDatabaseIntoUnitOfWork: Assignable<PgliteDatabase, SourceExecutionUnitOfWork> = false
export const callbackTransactionIntoUnitOfWork: Assignable<SourceExecutionTransaction, SourceExecutionUnitOfWork> = true
/** An owner operation cannot open a nested transaction of its own. */
export const unitOfWorkOpensTransaction: HasKey<SourceExecutionUnitOfWork, 'transaction'> = false
export const unitOfWorkKeepsRollback: HasKey<SourceExecutionUnitOfWork, 'rollback'> = true
