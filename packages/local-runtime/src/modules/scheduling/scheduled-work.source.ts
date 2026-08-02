/**
 * Generic scheduled-work source for the app-wide local scheduler (issue #303).
 *
 * Adapts any operation's `ScheduledWorkRepository` into a `LocalScheduledWorkSource`
 * that `createLocalScheduler` (packages/local-runtime/src/runtime/local-scheduler.ts) registers alongside
 * every other operation. The scheduler owns wakeups, the next-due instant, and the
 * app-open lifecycle timer; this source owns due discovery (`nextDueAt`) and
 * cooperative draining (`runDue` claims and executes one due record at a time,
 * stopping on shutdown cancellation). Because each operation registers its OWN source
 * over its OWN table, one operation's backlog never blocks another's dispatch.
 *
 * Startup recovery: call `repository.recoverClaimed()` once at app start (before
 * registering the source) so claims orphaned by a crash return to `scheduled` and are
 * re-dispatched exactly once — the stale token can no longer complete the re-claimed
 * record.
 */
import type { LocalScheduledWorkSource } from './scheduled-work.port.js'
import type { ClaimedScheduledWork, ScheduledWorkRepository } from './scheduled-work.js'

export interface ScheduledWorkSourceOptions<Claim> {
  readonly id: string
  readonly repository: Pick<ScheduledWorkRepository<never, Claim>, 'claimDue' | 'nextDueAt'>
  readonly execute: (work: ClaimedScheduledWork<Claim>, signal?: AbortSignal) => Promise<void>
  readonly now: () => Date
}

export function createScheduledWorkSource<Claim>(
  options: ScheduledWorkSourceOptions<Claim>,
): LocalScheduledWorkSource {
  const { id, repository, execute, now } = options
  return {
    id,
    nextDueAt: () => repository.nextDueAt(),
    async runDue(signal) {
      while (!signal?.aborted) {
        const work = await repository.claimDue(now().toISOString())
        if (!work) return
        await execute(work, signal)
      }
    },
  }
}
