/**
 * A composition-boundary transport error. The routes map it to an HTTP `{status, body}`; the
 * in-process client lets it propagate (matching the typed HTTP client's `ValedictorianHttpError`).
 * Bodies are fixed and generic so no internal detail leaks across the boundary.
 *
 * Lifecycle owns it because every aggregate that raises it is a lifecycle
 * conversation; keeping it out of the runtime shell lets a capability throw it
 * without depending on its own consumer (issue #327).
 */
export class LifecycleHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`lifecycle_http_error_${status}`)
    this.name = 'LifecycleHttpError'
  }
}
