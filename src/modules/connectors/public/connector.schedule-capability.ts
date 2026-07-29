import {
  unavailableConnectorSchedulingCapability,
  type ConnectorSchedulingCapability,
} from '@sparxie/sdk'
import { connectorSchedulingUnavailableError } from './connector.schedule-errors'

export type AvailableConnectorSchedulingCapability = Extract<
  ConnectorSchedulingCapability,
  { available: true }
>

/** The local desktop runtime is the only production host that owns schedule wake-ups. */
export const localDesktopConnectorSchedulingCapability: AvailableConnectorSchedulingCapability = {
  available: true,
  supportedCadences: ['interval', 'daily', 'weekly'],
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana',
  missedOccurrencePolicy: 'coalesce_one',
}

/** Explicit capability value shared by reporting and schedule enforcement. Not a global flag. */
export function resolveConnectorSchedulingCapability(
  capability: ConnectorSchedulingCapability = unavailableConnectorSchedulingCapability,
): ConnectorSchedulingCapability {
  return capability
}

export function requireAvailableConnectorScheduling(
  capability: ConnectorSchedulingCapability,
): AvailableConnectorSchedulingCapability {
  if (!capability.available) {
    throw connectorSchedulingUnavailableError()
  }

  return capability
}
