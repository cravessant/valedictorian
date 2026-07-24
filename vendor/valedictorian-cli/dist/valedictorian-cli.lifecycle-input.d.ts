import type { RawFlags } from './valedictorian-cli.command-runtime.js';
type ContractSchema<T> = {
    safeParse(value: unknown): {
        success: true;
        data: T;
    } | {
        success: false;
    };
};
export declare function parseContractInput<T>(flags: RawFlags, schema: ContractSchema<T>, options?: {
    id?: readonly [string, string];
    ids?: readonly (readonly [string, string])[];
    optional?: boolean;
    workspaceId?: string;
}): T;
export declare function parseRemovalInput<T>(flags: RawFlags, schema: ContractSchema<T>, id: string): T;
export declare function parseRestoreInput<T>(flags: RawFlags, schema: ContractSchema<T>, id: string): T;
export declare function parsePromotionInput<T>(flags: RawFlags, schema: ContractSchema<T>, identity: readonly [string, string]): T;
export declare function parseCaptureCreateInput<T>(flags: RawFlags, schema: ContractSchema<T>): T;
export declare const inputJsonFlags: string[];
export declare const listInputFlags: string[];
export declare const historyInputFlags: string[];
export declare const removalRequiredFlags: string[];
export declare const restoreRequiredFlags: string[];
export declare const actorOptionalFlags: string[];
export declare const promotionOptionalFlags: string[];
export {};
