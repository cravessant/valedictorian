import {
  unavailableConnectorSchedulingCapability,
  type ConnectorSchedulingCapability,
} from 'sparxie'
import { connectorSchedulingUnavailableError } from './connector-schedule.errors'

export type AvailableConnectorSchedulingCapability = Extract<
  ConnectorSchedulingCapability,
  { available: true }
>

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
