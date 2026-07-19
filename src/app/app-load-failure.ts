import {
  ownedLoadFailure,
  presentLoadFailure,
  type ErrorPresentation,
} from './error-presentation'

export function applicationsLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Applications could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function actionQueueLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Action Queue could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function connectorStatusLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Connector status could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function sourcingLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Opportunities could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function applicationDetailLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Application detail could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function applicationLinksLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Links could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function applicationEventsLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Events could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function applicationAttemptsLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Attempts could not be loaded.',
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
