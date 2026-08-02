/**
 * The scheduled-work port (issue #327).
 *
 * The conversation a coordinator holds with one operation's due work: what is due
 * next, drain it cooperatively, and wake on demand. Scheduling owns the shape
 * because scheduling owns the conversation; `createLocalScheduler` in the runtime
 * is one coordinator that speaks it, and the port carries no dependency on that
 * coordinator so a source can be reused by another deployment.
 */
export interface LocalScheduledWorkSource {
  id: string
  nextDueAt(): Promise<string | null> | string | null
  runDue(signal?: AbortSignal): Promise<void>
  onSignal?(): void
}
