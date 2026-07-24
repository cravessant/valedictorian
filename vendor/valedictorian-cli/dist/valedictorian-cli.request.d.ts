import { createFailClosedRequestError, type CliErrorSurfaceId } from './valedictorian-cli.endpoint-errors.js';
export declare function requestValedictorianJson({ apiBaseUrl, apiToken, path, body, method, errorSurface, }: {
    apiBaseUrl: string;
    apiToken?: string;
    path: string;
    body?: unknown;
    method?: 'GET' | 'POST';
    errorSurface: CliErrorSurfaceId;
}): Promise<unknown>;
export type { CliErrorSurfaceId };
export { createFailClosedRequestError };
