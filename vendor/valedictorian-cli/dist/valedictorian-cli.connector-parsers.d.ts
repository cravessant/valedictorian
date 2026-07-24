import { type ConnectorRunsListInput as ReleasedConnectorRunsListInput, type TriggerConnectorRunInput, type UpdateConnectorInstanceInput } from '@sparxie/sdk';
export declare function parseConnectorConfiguration(connectorInstanceId: string, argv: string[]): UpdateConnectorInstanceInput;
export type ConnectorRunTriggerInput = TriggerConnectorRunInput;
export type ConnectorRunsListInput = ReleasedConnectorRunsListInput;
export interface ConnectorObservationsListInput {
    connectorInstanceId: string;
    connectorRunId?: string;
    limit?: number;
    offset?: number;
}
export declare function parseConnectorRunTrigger(connectorInstanceId: string, argv: string[]): ConnectorRunTriggerInput;
export declare function parseConnectorRunsList(connectorInstanceId: string, argv: string[]): ConnectorRunsListInput;
export declare function parseConnectorObservationsList(connectorInstanceId: string, argv: string[]): ConnectorObservationsListInput;
