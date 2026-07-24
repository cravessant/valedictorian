import { type CommandContext, type StricliProcess } from '@stricli/core';
import { type ProfileSecretKind, type ValedictorianClient, type ValedictorianWorkspaceClient } from '@sparxie/sdk';
import { type HumanOutputOptions } from './valedictorian-cli.output.js';
import type { SecretsRunSpawnAdapter } from './valedictorian-cli.secrets-run-spawn.js';
export { mapStricliExitCode } from './valedictorian-cli.failures.js';
export interface ValedictorianCliContext extends CommandContext {
    readonly apiBaseUrl: string;
    readonly apiToken?: string;
    /**
     * Exact argv tokens after the first `--` in the normalized invocation, or `null`
     * when the escape marker is absent.
     */
    readonly argvEscapeSuffix: readonly string[] | null;
    readonly client: ValedictorianClient;
    readonly cwd: string;
    readonly env: Record<string, string | undefined>;
    outputJson?: boolean;
    readonly process: StricliProcess;
    readonly secretsRunSpawn?: SecretsRunSpawnAdapter;
}
type RawFlagValue = string | boolean | readonly string[] | undefined;
export type RawFlags = Readonly<Record<string, RawFlagValue>>;
type CommandRunner = (context: ValedictorianCliContext, flags: RawFlags, ...args: string[]) => Promise<void> | void;
export declare function makeCommand({ docs, flags, positionalCount, run, }: {
    docs: {
        brief: string;
        fullDescription?: string;
    };
    flags?: Record<string, unknown>;
    positionalCount?: number | {
        minimum: number;
        maximum?: number;
    };
    run: CommandRunner;
}): import("@stricli/core").Command<ValedictorianCliContext>;
export declare function optionFlags(optional?: string[], required?: string[]): Record<string, unknown>;
export declare function booleanFlags(names: string[]): Record<string, unknown>;
export declare function toArgvWithoutWorkspace(flags: RawFlags): string[];
export declare function workspaceClient(context: ValedictorianCliContext, flags: RawFlags): Promise<ValedictorianWorkspaceClient>;
export declare function workspaceClientWithId(context: ValedictorianCliContext, flags: RawFlags): Promise<{
    client: ValedictorianWorkspaceClient;
    workspaceId: string;
}>;
export declare function workspaceConnectorClient(context: ValedictorianCliContext, flags: RawFlags): Promise<ValedictorianWorkspaceClient['connectors']>;
export declare function listWorkspaces(context: ValedictorianCliContext): Promise<import("@sparxie/sdk").WorkspaceListResult>;
export declare function openWorkspace(context: ValedictorianCliContext, path: string, rekey: boolean): Promise<import("@sparxie/sdk").WorkspaceListItem>;
export declare function createWorkspace(context: ValedictorianCliContext, path: string): Promise<import("@sparxie/sdk").WorkspaceListItem>;
export declare function optionValue(flags: RawFlags, name: string): string | undefined;
export declare function requiredOption(flags: RawFlags, name: string, label: string): string;
export declare function parseProfileSecretKind(value: string): ProfileSecretKind;
export declare function readJsonObjectFile<T extends object>(path: string, label: string): T;
export declare function writeJson(context: ValedictorianCliContext, value: unknown, pretty?: boolean, humanOutputOptions?: HumanOutputOptions): void;
export declare function normalizeArgv(argv: string[]): string[];
/** Exact tokens after the first `--`, or `null` when the marker is absent. */
export declare function readArgvEscapeSuffix(argv: readonly string[]): readonly string[] | null;
export declare function parseTimeoutMs(value: string | undefined): number;
export declare function definedEnv(env: Record<string, string | undefined>): Record<string, string>;
export declare function readPackageVersion(): Promise<string>;
