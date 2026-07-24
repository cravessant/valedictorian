import { type ValedictorianCapabilities, type WorkspaceListItem } from '@sparxie/sdk';
import { type ProjectConfigDiscoveryResult } from './valedictorian-cli.project-config.js';
type DoctorClassification = 'local' | 'staging' | 'production' | 'invalid';
type DoctorCheckStatus = 'pass' | 'fail' | 'skip';
type WorkspaceResolutionStatus = 'ambiguous' | 'not_found' | 'not_requested' | 'resolved' | 'skipped';
export interface DoctorCheck {
    readonly name: string;
    readonly status: DoctorCheckStatus;
    readonly message: string;
    readonly details?: Record<string, unknown>;
}
export interface DoctorReport {
    readonly ok: boolean;
    readonly cliVersion: string;
    readonly nodeVersion: string;
    readonly target: {
        readonly apiUrl: string;
        readonly classification: DoctorClassification;
        readonly tokenPresent: boolean;
    };
    readonly workspace: DoctorWorkspaceContext;
    readonly projectConfig: ProjectConfigDiscoveryResult;
    readonly capabilities?: Partial<ValedictorianCapabilities> & Record<string, unknown>;
    readonly checks: DoctorCheck[];
}
export interface DoctorWorkspaceContext {
    readonly selector?: string;
    readonly resolution: WorkspaceResolutionStatus;
    readonly id?: string;
    readonly name?: string;
    readonly open?: boolean;
    readonly path?: string;
    readonly source?: string;
    readonly openWorkspaces?: Array<Pick<WorkspaceListItem, 'id' | 'name' | 'open' | 'source'>>;
}
export interface CliContextReport {
    readonly target: DoctorReport['target'];
    readonly projectConfig: ProjectConfigDiscoveryResult;
    readonly workspace: DoctorWorkspaceContext & {
        readonly note: string;
    };
    readonly capabilities?: DoctorReport['capabilities'];
}
export declare function runDoctor({ cliVersion, env, cwd, skipNetwork, timeoutMs, workspaceSelector, }: {
    cliVersion: string;
    cwd: string;
    env: Record<string, string | undefined>;
    skipNetwork: boolean;
    timeoutMs: number;
    workspaceSelector?: string;
}): Promise<DoctorReport>;
export declare function runContext({ cwd, env, skipNetwork, timeoutMs, workspaceSelector, }: {
    cwd: string;
    env: Record<string, string | undefined>;
    skipNetwork: boolean;
    timeoutMs: number;
    workspaceSelector?: string;
}): Promise<CliContextReport>;
export declare function formatDoctorText(report: DoctorReport): string;
export {};
