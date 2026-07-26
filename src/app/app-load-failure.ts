import {
  ownedLoadFailure,
  presentLoadFailure,
  type ErrorPresentation,
} from './error-presentation'

/** The renderer's own canonical message when no workspace client is connected. */
export const workspaceClientUnavailableMessage = 'Workspace HTTP client is unavailable.'

/** Raised by workspace reads and commands when no workspace client is connected. */
export class WorkspaceClientUnavailableError extends Error {
  constructor() {
    super(workspaceClientUnavailableMessage)
    this.name = 'WorkspaceClientUnavailableError'
  }
}

/**
 * Present a scoped load failure without leaking upstream text.
 *
 * Only the renderer's own connection message passes through verbatim. Every
 * other rejection — transport, protocol, HTTP body, or an arbitrary thrown
 * value — is classified down to a fixed public message, so nothing a remote or
 * a defect puts in `Error.message` reaches the surface.
 */
export function scopedLoadFailure(
  error: unknown,
  fallbackMessage: string,
  hasStaleData: boolean,
): ErrorPresentation | null {
  if (error instanceof WorkspaceClientUnavailableError) {
    return {
      message: workspaceClientUnavailableMessage,
      retryable: true,
      surface: 'scoped_load',
      title: 'Load failed',
    }
  }
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage,
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function applicationDetailMissingFailure(): ErrorPresentation {
  return {
    message: 'Application detail could not be found.',
    retryable: false,
    surface: 'scoped_load',
    title: 'Load failed',
  }
}
