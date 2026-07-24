import type { WorkspaceListItem, WorkspaceListResult } from '@sparxie/sdk';
export declare function readLocalWorkspaceList(env: Record<string, string | undefined>): WorkspaceListResult | null;
export declare function isLocalApiUrl(rawApiUrl: string): boolean;
export declare function inferLastOpenWorkspace(items: WorkspaceListItem[]): WorkspaceListItem | undefined;
