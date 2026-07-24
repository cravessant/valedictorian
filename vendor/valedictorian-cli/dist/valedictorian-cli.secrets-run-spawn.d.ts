import { type ChildProcess } from 'node:child_process';
export interface SecretsRunSpawnRequest {
    readonly executable: string;
    readonly argv: readonly string[];
    readonly env: NodeJS.ProcessEnv;
    readonly shell: false;
    stdin: 'ignore' | {
        value: string;
    };
    readonly fdValues: Map<number, string>;
    readonly signal?: AbortSignal;
}
export interface SecretsRunSpawnResult {
    readonly exitCode: number;
}
export type SecretsRunSpawnAdapter = (request: SecretsRunSpawnRequest) => Promise<SecretsRunSpawnResult>;
export declare const defaultSecretsRunSpawn: SecretsRunSpawnAdapter;
export declare function waitForSpawnedChild(child: ChildProcess, request: SecretsRunSpawnRequest): Promise<SecretsRunSpawnResult>;
