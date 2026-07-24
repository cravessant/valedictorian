import { type ValedictorianFailureKind, type ValedictorianRetryAfter } from '@sparxie/sdk';
export type CliFailureExitCode = 1 | 2 | 3 | 4 | 5 | 6;
export type CliFailureErrorObject = {
    readonly code: string;
    readonly kind: ValedictorianFailureKind | 'usage';
    readonly status?: number;
    readonly message?: string;
    readonly path?: ReadonlyArray<string | number>;
    readonly line?: number;
    readonly column?: number;
    readonly requestId?: string;
    readonly retryAfter?: ValedictorianRetryAfter;
};
export type ClassifiedCliFailure = {
    readonly exitCode: CliFailureExitCode;
    readonly error: CliFailureErrorObject;
    readonly guidance: string;
};
export declare class CliUsageError extends Error {
    readonly kind: 'usage';
    constructor(message: string);
}
export declare class CliOwnedFailure extends Error {
    readonly code: string;
    readonly kind: ValedictorianFailureKind;
    readonly status?: number;
    constructor({ code, kind, message, status, }: {
        code: string;
        kind: ValedictorianFailureKind;
        message: string;
        status?: number;
    });
}
export declare function classifyCliFailure(error: unknown): ClassifiedCliFailure;
export declare function presentCliFailure(error: unknown, options: {
    asJson: boolean;
    operation?: string;
}): {
    exitCode: CliFailureExitCode;
    text: string;
};
export declare function mapStricliExitCode(exitCode: number): number;
export declare function isStricliUsageExitCode(exitCode: number): boolean;
export declare function argvRequestsJson(argv: readonly string[]): boolean;
