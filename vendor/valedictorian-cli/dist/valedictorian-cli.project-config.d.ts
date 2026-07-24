export interface ValedictorianProjectConfig {
    version: 1;
    workspace: {
        name?: string;
    };
}
export type ProjectConfigDiscoveryResult = {
    config: ValedictorianProjectConfig;
    path: string;
    status: 'found';
} | {
    status: 'not_found';
} | {
    message: string;
    path?: string;
    status: 'invalid';
};
export declare function loadValedictorianProjectConfig(cwd: string): ProjectConfigDiscoveryResult;
