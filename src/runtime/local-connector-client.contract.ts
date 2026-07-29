import type {
  ConnectorSchedulingCapability,
  ValedictorianWorkspaceClient,
  ValedictorianWorkspaceClientV2,
} from '@sparxie/sdk'
export type {
  LocalConnectorAuthGrantSummary,
  LocalConnectorAuthSummary,
  LocalConnectorClient,
  LocalConnectorExecutionIntent,
  LocalConnectorInstanceSummary,
  LocalConnectorInternalRunTriggerInput,
  LocalConnectorObservationListInput,
  LocalConnectorReconnectActionResult,
  LocalConnectorRunSummary,
  LocalConnectorSkipActionInput,
  LocalConnectorSkipActionResult,
  LocalConnectorStatusActionInput,
  LocalConnectorStatusSummary,
} from '../modules/connectors/public'
import type { LocalConnectorClient } from '../modules/connectors/public'

/** The SDK workspace client as the App implements and serves it. */
export type LocalWorkspaceClient = ValedictorianWorkspaceClient

/** The V2 workspace client as the App implements, serves, and renders it. */
export type LocalWorkspaceClientV2 = ValedictorianWorkspaceClientV2

export type LocalValedictorianClient = LocalWorkspaceClientV2 & {
  /** Bound workspace identity used only by the local HTTP adapter. */
  workspaceId: string
  connectors: LocalConnectorClient
  /** Authoritative scheduling capability for reporting and schedule enforcement. */
  connectorScheduling: ConnectorSchedulingCapability
}
