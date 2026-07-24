import { type ValedictorianFailureKind } from '@sparxie/sdk';
/** Closed identity for generic request fallbacks; only declared specs are authoritative. */
export type CliErrorSurfaceId = 'workspace';
export type MatchedPublicEndpointError = {
    readonly code: string;
    readonly kind: ValedictorianFailureKind;
    readonly status: number;
    readonly message: string;
    readonly requestId?: string;
    readonly path?: ReadonlyArray<string | number>;
    readonly line?: number;
    readonly column?: number;
    readonly error: Error;
};
type MatchResult = {
    readonly ok: true;
    readonly matched: MatchedPublicEndpointError;
} | {
    readonly ok: false;
    readonly reason: 'none' | 'protocol';
};
export declare function matchPublicEndpointError(body: unknown, status: number, surface: CliErrorSurfaceId): MatchResult;
export declare function createFailClosedRequestError(status: number, responseBody: unknown, surface: CliErrorSurfaceId): Error;
export {};
