import { type SecretReference } from '@sparxie/sdk';
import { type RawFlags, type ValedictorianCliContext } from './valedictorian-cli.command-runtime.js';
import { type SecretsRunSpawnAdapter } from './valedictorian-cli.secrets-run-spawn.js';
export interface SecretsRunEnvInjection {
    readonly kind: 'env';
    readonly name: string;
    readonly referenceUri: string;
    readonly reference: SecretReference;
}
export interface SecretsRunFdInjection {
    readonly kind: 'fd';
    readonly fd: number;
    readonly referenceUri: string;
    readonly reference: SecretReference;
}
export interface SecretsRunStdinInjection {
    readonly kind: 'stdin';
    readonly referenceUri: string;
    readonly reference: SecretReference;
}
export type SecretsRunInjection = SecretsRunEnvInjection | SecretsRunFdInjection | SecretsRunStdinInjection;
export interface SecretsRunPlan {
    readonly executable: string;
    readonly argv: readonly string[];
    readonly injections: readonly SecretsRunInjection[];
    readonly uniqueReferenceUris: readonly string[];
}
export declare function runSecretsRunCommand(context: ValedictorianCliContext, flags: RawFlags, commandArgv: readonly string[]): Promise<void>;
export declare function parseSecretsRunPlan(flags: RawFlags, commandArgv: readonly string[], options?: {
    argvEscapeSuffix?: readonly string[] | null;
}): SecretsRunPlan;
export type { SecretsRunSpawnAdapter };
