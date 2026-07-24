import { type ActionQueueListQuery, type ValedictorianWorkspaceClient } from '@sparxie/sdk';
export { assertKnownOptions, readOption, readRequiredArgument, readRequiredOption, readRequiredText, } from './valedictorian-cli.parser-options.js';
export { parseConnectorConfiguration, parseConnectorObservationsList, parseConnectorRunsList, parseConnectorRunTrigger, type ConnectorObservationsListInput, type ConnectorRunsListInput, type ConnectorRunTriggerInput, } from './valedictorian-cli.connector-parsers.js';
export declare function parseActionQueueListQuery(argv: string[]): ActionQueueListQuery;
export declare function parseWorkflowRunsListQuery(argv: string[]): NonNullable<Parameters<ValedictorianWorkspaceClient['runs']['list']>[0]>;
export declare function parseRunStart(argv: string[]): Parameters<ValedictorianWorkspaceClient['runs']['start']>[0];
export declare function parseRunStep(workflowRunId: string, argv: string[]): Parameters<ValedictorianWorkspaceClient['runs']['step']>[0];
export declare function parseRunComplete(workflowRunId: string, argv: string[]): Parameters<ValedictorianWorkspaceClient['runs']['complete']>[0];
